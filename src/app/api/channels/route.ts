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
  const medium = searchParams.get('medium') || undefined;

  const cacheKey = `channels:${period}:${medium ?? 'all'}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const startDate = getStartDate(period);
  const now = new Date();

  const whereClause: Record<string, unknown> = {
    capturedAt: { gte: startDate, lte: now },
  };
  if (medium) {
    whereClause.medium = medium;
  }

  const channelData = await prisma.trafficBySource.groupBy({
    by: ['source', 'medium'],
    where: whereClause,
    _sum: {
      sessions: true,
      users: true,
      newUsers: true,
      conversions: true,
    },
    _avg: {
      bounceRate: true,
      engagementRate: true,
    },
    orderBy: {
      _sum: { sessions: 'desc' },
    },
  });

  const channels = channelData.map((ch) => {
    const sessions = ch._sum.sessions ?? 0;
    const conversions = ch._sum.conversions ?? 0;
    return {
      source: ch.source,
      medium: ch.medium,
      sessions,
      users: ch._sum.users ?? 0,
      newUsers: ch._sum.newUsers ?? 0,
      bounceRate: Math.round((ch._avg.bounceRate ?? 0) * 100) / 100,
      engagementRate: Math.round((ch._avg.engagementRate ?? 0) * 100) / 100,
      conversions,
      conversionRate: sessions > 0 ? Math.round((conversions / sessions) * 10000) / 100 : 0,
    };
  });

  const data = { channels };

  await setCache(cacheKey, data, 60);

  return NextResponse.json(data);
}
