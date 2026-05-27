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

function getChannelGroup(source: string, medium: string): string {
  const src = source.toLowerCase();
  const med = medium.toLowerCase();
  
  if (med.includes('cpc') || med.includes('ppc') || med.includes('paid')) return 'CPC';
  if (med.includes('organic')) return 'Organic';
  if (src.includes('direct') || med.includes('none') || med.includes('direct')) return 'Direct';
  if (med.includes('referral')) return 'Referral';
  if (med.includes('email')) return 'Email';
  if (med.includes('tv') || src.includes('tv')) return 'TV';
  if (med.includes('social') || med.includes('sm') || src.includes('facebook') || src.includes('instagram')) return 'Social';
  return 'Other';
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

  const rows = channelData.map((ch) => {
    const sessions = ch._sum.sessions ?? 0;
    const conversions = ch._sum.conversions ?? 0;
    const source = ch.source;
    const medium = ch.medium;
    return {
      sourceMedium: `${source} / ${medium}`,
      channel: getChannelGroup(source, medium),
      sessions,
      users: ch._sum.users ?? 0,
      bounceRate: Math.round((ch._avg.bounceRate ?? 0) * 10000) / 100,
      engagementRate: Math.round((ch._avg.engagementRate ?? 0) * 10000) / 100,
      conversions,
      conversionRate: sessions > 0 ? Math.round((conversions / sessions) * 10000) / 100 : 0,
    };
  });

  const data = { rows };

  await setCache(cacheKey, data, 60);

  return NextResponse.json(data);
}
