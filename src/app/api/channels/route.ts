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
  const now = getWarsawNow();

  const whereClause: Record<string, unknown> = {
    capturedAt: { gte: startDate, lte: now },
  };
  if (medium) {
    whereClause.medium = medium;
  }

  const trafficRows = await prisma.trafficBySource.findMany({
    where: whereClause,
    select: {
      source: true,
      medium: true,
      sessions: true,
      users: true,
      conversions: true,
      bounceRate: true,
      engagementRate: true,
    },
  });

  // Group in JS to compute session-weighted rates (plain _avg skews toward low-traffic days)
  const groups = new Map<string, {
    source: string;
    medium: string;
    sessions: number;
    users: number;
    conversions: number;
    bounceWeighted: number;
    engagementWeighted: number;
  }>();

  for (const r of trafficRows) {
    const key = `${r.source} / ${r.medium}`;
    const g = groups.get(key) ?? {
      source: r.source,
      medium: r.medium,
      sessions: 0,
      users: 0,
      conversions: 0,
      bounceWeighted: 0,
      engagementWeighted: 0,
    };
    g.sessions += r.sessions;
    g.users += r.users;
    g.conversions += r.conversions;
    g.bounceWeighted += r.sessions * r.bounceRate;
    g.engagementWeighted += r.sessions * r.engagementRate;
    groups.set(key, g);
  }

  const rows = Array.from(groups.values())
    .map((g) => ({
      sourceMedium: `${g.source} / ${g.medium}`,
      channel: getChannelGroup(g.source, g.medium),
      sessions: g.sessions,
      users: g.users,
      bounceRate: g.sessions > 0 ? Math.round((g.bounceWeighted / g.sessions) * 10000) / 100 : 0,
      engagementRate: g.sessions > 0 ? Math.round((g.engagementWeighted / g.sessions) * 10000) / 100 : 0,
      conversions: g.conversions,
      conversionRate: g.sessions > 0 ? Math.round((g.conversions / g.sessions) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  const data = { rows };

  await setCache(cacheKey, data, 60);

  return NextResponse.json(data);
}
