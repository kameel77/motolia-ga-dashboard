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

  const now = new Date();
  const startDate = getStartDate(period);
  const days = getPeriodDays(period);
  const prevStartDate = new Date(startDate.getTime() - days * 24 * 60 * 60 * 1000);

  const currentTraffic = await prisma.trafficBySource.aggregate({
    where: { capturedAt: { gte: startDate, lte: now } },
    _sum: { sessions: true, users: true, newUsers: true, conversions: true },
    _avg: { bounceRate: true, engagementRate: true },
  });

  const prevTraffic = await prisma.trafficBySource.aggregate({
    where: { capturedAt: { gte: prevStartDate, lt: startDate } },
    _sum: { sessions: true, users: true, newUsers: true, conversions: true },
    _avg: { bounceRate: true, engagementRate: true },
  });

  const conversionEvents = await prisma.conversionEvent.groupBy({
    by: ['eventName'],
    where: { capturedAt: { gte: startDate, lte: now } },
    _sum: { count: true },
  });

  const formSubmissions = conversionEvents
    .filter((e) => e.eventName.toLowerCase().includes('form'))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const phoneCalls = conversionEvents
    .filter((e) => e.eventName.toLowerCase().includes('phone') || e.eventName.toLowerCase().includes('call'))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const trend = await prisma.dailySnapshot.findMany({
    where: { date: { gte: startDate, lte: now } },
    orderBy: { date: 'asc' },
  });

  const sessions = currentTraffic._sum.sessions ?? 0;
  const users = currentTraffic._sum.users ?? 0;
  const newUsers = currentTraffic._sum.newUsers ?? 0;
  const conversions = currentTraffic._sum.conversions ?? 0;
  const bounceRate = Math.round((currentTraffic._avg.bounceRate ?? 0) * 100) / 100;
  const engagementRate = Math.round((currentTraffic._avg.engagementRate ?? 0) * 100) / 100;
  const conversionRate = sessions > 0 ? Math.round((conversions / sessions) * 10000) / 100 : 0;

  const prevSessions = prevTraffic._sum.sessions ?? 0;
  const prevUsers = prevTraffic._sum.users ?? 0;
  const prevNewUsers = prevTraffic._sum.newUsers ?? 0;
  const prevConversions = prevTraffic._sum.conversions ?? 0;
  const prevBounceRate = prevTraffic._avg.bounceRate ?? 0;
  const prevEngagementRate = prevTraffic._avg.engagementRate ?? 0;

  const data = {
    kpis: {
      sessions,
      users,
      newUsers,
      bounceRate,
      engagementRate,
      conversions,
      formSubmissions,
      phoneCalls,
      conversionRate,
    },
    trend: {
      sessions: trend.map((d) => ({ date: d.date, value: d.sessions })),
      users: trend.map((d) => ({ date: d.date, value: d.users })),
    },
    comparison: {
      sessionsDelta: calcDelta(sessions, prevSessions),
      usersDelta: calcDelta(users, prevUsers),
      newUsersDelta: calcDelta(newUsers, prevNewUsers),
      bounceRateDelta: calcDelta(bounceRate, prevBounceRate),
      engagementRateDelta: calcDelta(engagementRate, prevEngagementRate),
      conversionsDelta: calcDelta(conversions, prevConversions),
    },
  };

  await setCache(cacheKey, data, 60);

  return NextResponse.json(data);
}
