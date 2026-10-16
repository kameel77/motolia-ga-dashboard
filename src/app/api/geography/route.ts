import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCache, setCache } from '@/lib/redis';
import { getWarsawNow, type Period } from '@/lib/utils';
import { getTodayIntradaySupplement } from '@/lib/intraday';

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

  const cacheKey = `geography:${period}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const startDate = getStartDate(period);
  const now = getWarsawNow();

  const [geoData, supplement] = await Promise.all([
    prisma.trafficByGeo.groupBy({
      by: ['country', 'region', 'city'],
      where: { capturedAt: { gte: startDate, lte: now } },
      _sum: {
        sessions: true,
        users: true,
        conversions: true,
      },
      orderBy: {
        _sum: { sessions: 'desc' },
      },
      take: 100,
    }),
    getTodayIntradaySupplement(),
  ]);

  const merged = new Map<
    string,
    { country: string; region: string; city: string; sessions: number; users: number; conversions: number }
  >();

  for (const loc of geoData) {
    const key = `${loc.country}|${loc.city}`;
    const existing = merged.get(key);
    if (existing) {
      existing.sessions += loc._sum.sessions ?? 0;
      existing.users += loc._sum.users ?? 0;
      existing.conversions += loc._sum.conversions ?? 0;
      if (!existing.region && loc.region) existing.region = loc.region;
    } else {
      merged.set(key, {
        country: loc.country,
        region: loc.region,
        city: loc.city,
        sessions: loc._sum.sessions ?? 0,
        users: loc._sum.users ?? 0,
        conversions: loc._sum.conversions ?? 0,
      });
    }
  }

  for (const rtLoc of supplement.cities) {
    const key = `${rtLoc.country}|${rtLoc.city}`;
    const existing = merged.get(key);
    if (existing) {
      existing.sessions += rtLoc.sessions;
      existing.users += rtLoc.users;
      existing.conversions += rtLoc.conversions;
    } else {
      merged.set(key, { ...rtLoc });
    }
  }

  const locations = Array.from(merged.values())
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 50)
    .map((loc) => ({
      country: loc.country,
      region: loc.region,
      city: loc.city,
      sessions: loc.sessions,
      users: loc.users,
      conversions: loc.conversions,
      conversionRate:
        loc.sessions > 0 ? Math.round((loc.conversions / loc.sessions) * 10000) / 100 : 0,
    }));

  const data = { rows: locations };

  await setCache(cacheKey, data, 120);

  return NextResponse.json(data);
}
