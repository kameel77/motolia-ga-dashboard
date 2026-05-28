import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCache, setCache } from '@/lib/redis';

type Period = 'today' | '7d' | '30d' | '90d';

function getStartDate(period: Period): Date {
  const now = new Date();
  switch (period) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
  const now = new Date();
  const days = period === 'today' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const prevStartDate = new Date(startDate.getTime() - days * 24 * 60 * 60 * 1000);

  // 1. Current Period aggregations
  const byEventName = await prisma.conversionEvent.groupBy({
    by: ['eventName'],
    where: { capturedAt: { gte: startDate, lte: now } },
    _sum: { count: true },
    orderBy: { _sum: { count: 'desc' } },
  });

  const detailedEvents = await prisma.conversionEvent.groupBy({
    by: ['eventName', 'source', 'medium'],
    where: { capturedAt: { gte: startDate, lte: now } },
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

  const total = byEventName.reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const formSubmissions = byEventName
    .filter((e) => e.eventName.toLowerCase().includes('form') || e.eventName.toLowerCase().includes('lead'))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const phoneCalls = byEventName
    .filter((e) => e.eventName.toLowerCase().includes('phone') || e.eventName.toLowerCase().includes('call'))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const trafficAgg = await prisma.trafficBySource.aggregate({
    where: { capturedAt: { gte: startDate, lte: now } },
    _sum: { sessions: true },
  });
  const totalSessions = trafficAgg._sum.sessions ?? 0;
  const conversionRate = totalSessions > 0 ? Math.round((total / totalSessions) * 10000) / 100 : 0;

  // 2. Previous Period aggregations
  const prevConversionEvents = await prisma.conversionEvent.groupBy({
    by: ['eventName'],
    where: { capturedAt: { gte: prevStartDate, lt: startDate } },
    _sum: { count: true },
  });

  const prevTotal = prevConversionEvents.reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const prevFormSubmissions = prevConversionEvents
    .filter((e) => e.eventName.toLowerCase().includes('form') || e.eventName.toLowerCase().includes('lead'))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const prevPhoneCalls = prevConversionEvents
    .filter((e) => e.eventName.toLowerCase().includes('phone') || e.eventName.toLowerCase().includes('call'))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const prevTrafficAgg = await prisma.trafficBySource.aggregate({
    where: { capturedAt: { gte: prevStartDate, lt: startDate } },
    _sum: { sessions: true },
  });
  const prevTotalSessions = prevTrafficAgg._sum.sessions ?? 0;
  const prevConversionRate = prevTotalSessions > 0 ? Math.round((prevTotal / prevTotalSessions) * 10000) / 100 : 0;

  // 3. Daily snapshot data
  const trendData = await prisma.dailySnapshot.findMany({
    where: { date: { gte: startDate, lte: now } },
    orderBy: { date: 'asc' },
    select: { date: true, conversions: true },
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
    daily: trendData.map((d) => ({
      date: d.date.toISOString().split('T')[0],
      formSubmissions: Math.round(d.conversions * 0.6),
      phoneClicks: Math.round(d.conversions * 0.4),
      total: d.conversions,
    })),
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
