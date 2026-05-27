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

  // 1. Current Period aggregations
  const currentTraffic = await prisma.trafficBySource.aggregate({
    where: { capturedAt: { gte: startDate, lte: now } },
    _sum: { sessions: true, users: true, newUsers: true, conversions: true },
    _avg: { bounceRate: true, engagementRate: true },
  });

  const currentConversionEvents = await prisma.conversionEvent.groupBy({
    by: ['eventName'],
    where: { capturedAt: { gte: startDate, lte: now } },
    _sum: { count: true },
  });

  const formSubmissions = currentConversionEvents
    .filter((e) => e.eventName.toLowerCase().includes('form'))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const phoneCalls = currentConversionEvents
    .filter((e) => e.eventName.toLowerCase().includes('phone') || e.eventName.toLowerCase().includes('call'))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  // 2. Previous Period aggregations
  const prevTraffic = await prisma.trafficBySource.aggregate({
    where: { capturedAt: { gte: prevStartDate, lt: startDate } },
    _sum: { sessions: true, users: true, newUsers: true, conversions: true },
    _avg: { bounceRate: true, engagementRate: true },
  });

  const prevConversionEvents = await prisma.conversionEvent.groupBy({
    by: ['eventName'],
    where: { capturedAt: { gte: prevStartDate, lt: startDate } },
    _sum: { count: true },
  });

  const prevFormSubmissions = prevConversionEvents
    .filter((e) => e.eventName.toLowerCase().includes('form'))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const prevPhoneCalls = prevConversionEvents
    .filter((e) => e.eventName.toLowerCase().includes('phone') || e.eventName.toLowerCase().includes('call'))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  // 3. Trend from DailySnapshot
  const trend = await prisma.dailySnapshot.findMany({
    where: { date: { gte: startDate, lte: now } },
    orderBy: { date: 'asc' },
  });

  // Calculate current KPIs
  const sessions = currentTraffic._sum.sessions ?? 0;
  const users = currentTraffic._sum.users ?? 0;
  const newUsers = currentTraffic._sum.newUsers ?? 0;
  const conversions = currentTraffic._sum.conversions ?? 0;
  const bounceRate = Math.round((currentTraffic._avg.bounceRate ?? 0) * 10000) / 100;
  const engagementRate = Math.round((currentTraffic._avg.engagementRate ?? 0) * 10000) / 100;
  const conversionRate = sessions > 0 ? Math.round((conversions / sessions) * 10000) / 100 : 0;

  // Calculate previous KPIs
  const prevSessions = prevTraffic._sum.sessions ?? 0;
  const prevUsers = prevTraffic._sum.users ?? 0;
  const prevNewUsers = prevTraffic._sum.newUsers ?? 0;
  const prevConversions = prevTraffic._sum.conversions ?? 0;
  const prevBounceRate = Math.round((prevTraffic._avg.bounceRate ?? 0) * 10000) / 100;
  const prevEngagementRate = Math.round((prevTraffic._avg.engagementRate ?? 0) * 10000) / 100;
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
