import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCache, setCache } from '@/lib/redis';
import { getPeriodRange, type Period } from '@/lib/utils';

const DAY_MS = 24 * 60 * 60 * 1000;

// GA4-sourced event names only. CRM events (crm_lead_form, crm_lead_phone)
// describe the same leads and must not be added on top of GA4 counts.
const GA4_FORM_EVENTS = ['form_submission', 'generate_lead'];
const GA4_PHONE_EVENTS = ['phone_call_click'];

interface Totals {
  sessions: number;
  users: number;
  newUsers: number;
  bounceRate: number;
  conversions: number;
}

/**
 * Stand-in used only until the worker has written the PeriodSummary row for a
 * window (at most one collection cycle after a deploy). Sessions, new users and
 * conversions add up correctly across days; `users` does not — a visitor who
 * returns on three days is counted three times — so this is a placeholder, not
 * a second source of truth.
 */
async function fallbackTotals(startDate: Date, endDate: Date): Promise<Totals> {
  const rows = await prisma.dailySnapshot.findMany({
    where: { date: { gte: startDate, lte: endDate } },
    select: { sessions: true, users: true, newUsers: true, bounceRate: true, conversions: true },
  });

  const sessions = rows.reduce((s, r) => s + r.sessions, 0);

  return {
    sessions,
    users: rows.reduce((s, r) => s + r.users, 0),
    newUsers: rows.reduce((s, r) => s + r.newUsers, 0),
    // Session-weighted: a plain average would let a quiet day count as much as a busy one.
    bounceRate: sessions > 0 ? rows.reduce((s, r) => s + r.sessions * r.bounceRate, 0) / sessions : 0,
    conversions: rows.reduce((s, r) => s + r.conversions, 0),
  };
}

async function getTotals(
  period: Period,
  windowOffset: number,
  startDate: Date,
  endDate: Date
): Promise<Totals> {
  const summary = await prisma.periodSummary.findUnique({
    where: { period_windowOffset: { period, windowOffset } },
  });

  if (!summary) {
    return fallbackTotals(startDate, endDate);
  }

  return {
    sessions: summary.sessions,
    users: summary.users,
    newUsers: summary.newUsers,
    bounceRate: summary.bounceRate,
    conversions: summary.conversions,
  };
}

async function countConversionEvents(
  startDate: Date,
  endDate: Date,
  eventNames: string[]
): Promise<number> {
  const rows = await prisma.conversionEvent.groupBy({
    by: ['eventName'],
    where: {
      capturedAt: { gte: startDate, lt: new Date(endDate.getTime() + DAY_MS) },
      eventName: { in: eventNames },
    },
    _sum: { count: true },
  });

  return rows.reduce((sum, e) => sum + (e._sum.count ?? 0), 0);
}

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') || '7d') as Period;

  const cacheKey = `overview:${period}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const current = getPeriodRange(period, 0);
  const previous = getPeriodRange(period, 1);

  // KPI totals come from GA4 reports run over the whole window, cached by the
  // worker in PeriodSummary. They are deliberately NOT summed from
  // TrafficBySource: GA4's source breakdown adds overlapping "(not set)" and
  // "(data not available)" rows and counts a user once per source, which
  // inflated these cards by 57-71%.
  const [totals, prevTotals] = await Promise.all([
    getTotals(period, 0, current.startDate, current.endDate),
    getTotals(period, 1, previous.startDate, previous.endDate),
  ]);

  const [formSubmissions, phoneCalls, prevFormSubmissions, prevPhoneCalls, trend] =
    await Promise.all([
      countConversionEvents(current.startDate, current.endDate, GA4_FORM_EVENTS),
      countConversionEvents(current.startDate, current.endDate, GA4_PHONE_EVENTS),
      countConversionEvents(previous.startDate, previous.endDate, GA4_FORM_EVENTS),
      countConversionEvents(previous.startDate, previous.endDate, GA4_PHONE_EVENTS),
      prisma.dailySnapshot.findMany({
        where: { date: { gte: current.startDate, lte: current.endDate } },
        orderBy: { date: 'asc' },
      }),
    ]);

  const bounceRate = Math.round(totals.bounceRate * 10000) / 100;
  const prevBounceRate = Math.round(prevTotals.bounceRate * 10000) / 100;

  const conversionRate =
    totals.sessions > 0
      ? Math.round((totals.conversions / totals.sessions) * 10000) / 100
      : 0;
  const prevConversionRate =
    prevTotals.sessions > 0
      ? Math.round((prevTotals.conversions / prevTotals.sessions) * 10000) / 100
      : 0;

  const data = {
    sessions: {
      value: totals.sessions,
      previousValue: prevTotals.sessions,
      sparkline: trend.map((t) => t.sessions),
    },
    users: {
      value: totals.users,
      previousValue: prevTotals.users,
      sparkline: trend.map((t) => t.users),
    },
    newUsers: {
      value: totals.newUsers,
      previousValue: prevTotals.newUsers,
      sparkline: trend.map((t) => t.newUsers),
    },
    bounceRate: {
      value: bounceRate,
      previousValue: prevBounceRate,
      sparkline: trend.map((t) => Math.round(t.bounceRate * 10000) / 100),
    },
    formSubmissions: {
      value: formSubmissions,
      previousValue: prevFormSubmissions,
      sparkline: [],
    },
    phoneClicks: {
      value: phoneCalls,
      previousValue: prevPhoneCalls,
      sparkline: [],
    },
    totalConversions: {
      value: totals.conversions,
      previousValue: prevTotals.conversions,
      sparkline: trend.map((t) => t.conversions),
    },
    conversionRate: {
      value: conversionRate,
      previousValue: prevConversionRate,
      sparkline: trend.map((t) =>
        t.sessions > 0 ? Math.round((t.conversions / t.sessions) * 10000) / 100 : 0
      ),
    },
    daily: trend.map((t) => ({
      date: t.date.toISOString().split('T')[0],
      sessions: t.sessions,
      users: t.users,
    })),
  };

  await setCache(cacheKey, data, 60);

  return NextResponse.json(data);
}
