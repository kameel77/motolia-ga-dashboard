import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCache, setCache } from '@/lib/redis';
import { getWarsawNow, getWarsawDateString } from '@/lib/utils';

type Period = 'today' | '7d' | '30d' | '90d';

function toWarsawTimeZoneDate(date: Date): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(date);
  const val = (name: string) => parseInt(parts.find(p => p.type === name)?.value || '0');
  
  const hour = val('hour');
  return new Date(Date.UTC(
    val('year'),
    val('month') - 1,
    val('day'),
    hour === 24 ? 0 : hour,
    val('minute'),
    val('second')
  ));
}

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

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') || '7d') as Period;

  const cacheKey = `conversions:${period}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const startDate = getStartDate(period);
  const now = getWarsawNow();
  const days = period === 'today' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const prevStartDate = new Date(startDate.getTime() - days * 24 * 60 * 60 * 1000);

  // Timezone offset calculations to get real UTC bounds for CRM queries
  const tempStartUtc = new Date(startDate);
  const warsawStartUtc = toWarsawTimeZoneDate(tempStartUtc);
  const offsetMs = warsawStartUtc.getTime() - tempStartUtc.getTime();

  const realUtcStartDate = new Date(startDate.getTime() - offsetMs);
  const realUtcNow = new Date(now.getTime() - offsetMs);
  const realUtcPrevStartDate = new Date(prevStartDate.getTime() - offsetMs);

  // 1. Current Period aggregations
  const byEventName = await prisma.conversionEvent.groupBy({
    by: ['eventName'],
    where: { capturedAt: { gte: realUtcStartDate, lte: realUtcNow } },
    _sum: { count: true },
    orderBy: { _sum: { count: 'desc' } },
  });

  const detailedEvents = await prisma.conversionEvent.groupBy({
    by: ['eventName', 'source', 'medium'],
    where: { capturedAt: { gte: realUtcStartDate, lte: realUtcNow } },
    _sum: { count: true },
    orderBy: { _sum: { count: 'desc' } },
  });

  const events = byEventName.map((ev) => {
    const sources = detailedEvents
      .filter((d) => d.eventName === ev.eventName)
      .map((d) => ({
        source: d.source ?? 'Direct',
        medium: d.medium ?? '(none)',
        count: d._sum.count ?? 0,
      }));

    const topSrc = sources.reduce(
      (max, s) => (s.count > max.count ? s : max),
      { source: 'Direct', medium: '(none)', count: -1 }
    );

    return {
      eventName: ev.eventName,
      count: ev._sum.count ?? 0,
      topSource: `${topSrc.source} / ${topSrc.medium}`,
    };
  });

  const formSubmissions = byEventName
    .filter((e) => e.eventName === 'form_submission')
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const phoneCalls = byEventName
    .filter((e) => e.eventName === 'phone_call')
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const total = formSubmissions + phoneCalls;

  const trafficAgg = await prisma.trafficBySource.aggregate({
    where: { capturedAt: { gte: realUtcStartDate, lte: realUtcNow } },
    _sum: { sessions: true },
  });
  const totalSessions = trafficAgg._sum.sessions ?? 0;
  const conversionRate = totalSessions > 0 ? Math.round((total / totalSessions) * 10000) / 100 : 0;

  // 2. Previous Period aggregations
  const prevConversionEvents = await prisma.conversionEvent.groupBy({
    by: ['eventName'],
    where: { capturedAt: { gte: realUtcPrevStartDate, lt: realUtcStartDate } },
    _sum: { count: true },
  });

  const prevFormSubmissions = prevConversionEvents
    .filter((e) => e.eventName === 'form_submission')
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const prevPhoneCalls = prevConversionEvents
    .filter((e) => e.eventName === 'phone_call')
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const prevTotal = prevFormSubmissions + prevPhoneCalls;

  const prevTrafficAgg = await prisma.trafficBySource.aggregate({
    where: { capturedAt: { gte: realUtcPrevStartDate, lt: realUtcStartDate } },
    _sum: { sessions: true },
  });
  const prevTotalSessions = prevTrafficAgg._sum.sessions ?? 0;
  const prevConversionRate = prevTotalSessions > 0 ? Math.round((prevTotal / prevTotalSessions) * 10000) / 100 : 0;

  // 3. Daily snapshot data with real CRM event breakdown
  const trendData = await prisma.dailySnapshot.findMany({
    where: { date: { gte: startDate, lte: now } },
    orderBy: { date: 'asc' },
  });

  // Fetch actual CRM conversion events and group by date
  const crmEvents = await prisma.conversionEvent.findMany({
    where: { capturedAt: { gte: realUtcStartDate, lte: realUtcNow } },
    select: { capturedAt: true, eventName: true, count: true },
  });

  const crmByDate = new Map<string, { crmForms: number; crmPhones: number }>();
  for (const ev of crmEvents) {
    const dateKey = getWarsawDateString(ev.capturedAt);
    if (!crmByDate.has(dateKey)) {
      crmByDate.set(dateKey, { crmForms: 0, crmPhones: 0 });
    }
    const entry = crmByDate.get(dateKey)!;
    if (ev.eventName === 'form_submission') {
      entry.crmForms += ev.count;
    } else if (ev.eventName === 'phone_call') {
      entry.crmPhones += ev.count;
    }
  }

  const daily = trendData.map((d) => {
    const dateStr = d.date.toISOString().split('T')[0];
    const crm = crmByDate.get(dateStr) ?? { crmForms: 0, crmPhones: 0 };
    return {
      date: dateStr,
      sessions: d.sessions,
      users: d.users,
      crmForms: crm.crmForms,
      crmPhones: crm.crmPhones,
    };
  });

  const data = {
    formSubmissions: {
      value: formSubmissions,
      previousValue: prevFormSubmissions,
    },
    phoneClicks: {
      value: phoneCalls,
      previousValue: prevPhoneCalls,
    },
    totalConversions: {
      value: total,
      previousValue: prevTotal,
    },
    conversionRate: {
      value: conversionRate,
      previousValue: prevConversionRate,
    },
    daily,
    events,
    funnel: [
      { label: 'Sesje', value: totalSessions },
      { label: 'Zaangażowani', value: Math.round(totalSessions * 0.65) },
      { label: 'Konwersje', value: total },
    ],
  };

  await setCache(cacheKey, data, 60);

  return NextResponse.json(data);
}

