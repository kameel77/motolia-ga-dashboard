import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCache, setCache } from '@/lib/redis';
import { getWarsawNow } from '@/lib/utils';

type Period = 'today' | '7d' | '30d' | '90d';

function getStartDate(period: Period): Date {
  const now = getWarsawNow();
  now.setUTCHours(0, 0, 0, 0);
  switch (period) {
    case 'today':
      return now;
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '90d':
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
}

function getPeriodDays(period: Period): number {
  switch (period) {
    case 'today': return 1;
    case '7d': return 7;
    case '30d': return 30;
    case '90d': return 90;
    default: return 7;
  }
}

function calcDelta(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

// GA4-sourced event names only. CRM events (crm_lead_form, crm_lead_phone)
// describe the same leads and must not be added on top of GA4 counts.
const GA4_FORM_EVENTS = ['form_submission', 'generate_lead'];
const GA4_PHONE_EVENTS = ['phone_call_click'];

interface TrafficRow {
  sessions: number;
  users: number;
  newUsers: number;
  conversions: number;
  bounceRate: number;
  engagementRate: number;
}

// Sums plus session-weighted rates (plain _avg would skew toward tiny sources)
function summarizeTraffic(rows: TrafficRow[]) {
  const sessions = rows.reduce((s, r) => s + r.sessions, 0);
  return {
    sessions,
    users: rows.reduce((s, r) => s + r.users, 0),
    newUsers: rows.reduce((s, r) => s + r.newUsers, 0),
    conversions: rows.reduce((s, r) => s + r.conversions, 0),
    bounceRate: sessions > 0 ? rows.reduce((s, r) => s + r.sessions * r.bounceRate, 0) / sessions : 0,
    engagementRate: sessions > 0 ? rows.reduce((s, r) => s + r.sessions * r.engagementRate, 0) / sessions : 0,
  };
}

const trafficSelect = {
  sessions: true,
  users: true,
  newUsers: true,
  conversions: true,
  bounceRate: true,
  engagementRate: true,
} as const;

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

  const now = getWarsawNow();
  const startDate = getStartDate(period);
  const days = getPeriodDays(period);
  const prevStartDate = new Date(startDate.getTime() - days * 24 * 60 * 60 * 1000);

  // 1. Current Period aggregations
  const currentTraffic = summarizeTraffic(
    await prisma.trafficBySource.findMany({
      where: { capturedAt: { gte: startDate, lte: now } },
      select: trafficSelect,
    })
  );

  const currentConversionEvents = await prisma.conversionEvent.groupBy({
    by: ['eventName'],
    where: { capturedAt: { gte: startDate, lte: now } },
    _sum: { count: true },
  });

  const formSubmissions = currentConversionEvents
    .filter((e) => GA4_FORM_EVENTS.includes(e.eventName))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const phoneCalls = currentConversionEvents
    .filter((e) => GA4_PHONE_EVENTS.includes(e.eventName))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  // 2. Previous Period aggregations
  const prevTraffic = summarizeTraffic(
    await prisma.trafficBySource.findMany({
      where: { capturedAt: { gte: prevStartDate, lt: startDate } },
      select: trafficSelect,
    })
  );

  const prevConversionEvents = await prisma.conversionEvent.groupBy({
    by: ['eventName'],
    where: { capturedAt: { gte: prevStartDate, lt: startDate } },
    _sum: { count: true },
  });

  const prevFormSubmissions = prevConversionEvents
    .filter((e) => GA4_FORM_EVENTS.includes(e.eventName))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const prevPhoneCalls = prevConversionEvents
    .filter((e) => GA4_PHONE_EVENTS.includes(e.eventName))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  // 3. Trend from DailySnapshot
  const trend = await prisma.dailySnapshot.findMany({
    where: { date: { gte: startDate, lte: now } },
    orderBy: { date: 'asc' },
  });

  // Calculate current KPIs
  const sessions = currentTraffic.sessions;
  const users = currentTraffic.users;
  const newUsers = currentTraffic.newUsers;
  const conversions = currentTraffic.conversions;
  const bounceRate = Math.round(currentTraffic.bounceRate * 10000) / 100;
  const engagementRate = Math.round(currentTraffic.engagementRate * 10000) / 100;
  const conversionRate = sessions > 0 ? Math.round((conversions / sessions) * 10000) / 100 : 0;

  // Calculate previous KPIs
  const prevSessions = prevTraffic.sessions;
  const prevUsers = prevTraffic.users;
  const prevNewUsers = prevTraffic.newUsers;
  const prevConversions = prevTraffic.conversions;
  const prevBounceRate = Math.round(prevTraffic.bounceRate * 10000) / 100;
  const prevEngagementRate = Math.round(prevTraffic.engagementRate * 10000) / 100;
  const prevConversionRate = prevSessions > 0 ? Math.round((prevConversions / prevSessions) * 10000) / 100 : 0;

  // Map to the format frontend expects
  const data = {
    sessions: {
      value: sessions,
      previousValue: prevSessions,
      sparkline: trend.map((t) => t.sessions),
    },
    users: {
      value: users,
      previousValue: prevUsers,
      sparkline: trend.map((t) => t.users),
    },
    newUsers: {
      value: newUsers,
      previousValue: prevNewUsers,
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
      value: conversions,
      previousValue: prevConversions,
      sparkline: trend.map((t) => t.conversions),
    },
    conversionRate: {
      value: conversionRate,
      previousValue: prevConversionRate,
      sparkline: trend.map((t) => (t.sessions > 0 ? Math.round((t.conversions / t.sessions) * 10000) / 100 : 0)),
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
