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

  const cacheKey = `geography:${period}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const startDate = getStartDate(period);
  const now = new Date();

  const geoData = await prisma.trafficByGeo.groupBy({
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
    take: 50,
  });

  const locations = geoData.map((loc) => {
    const sessions = loc._sum.sessions ?? 0;
    const conversions = loc._sum.conversions ?? 0;
    return {
      country: loc.country,
      region: loc.region,
      city: loc.city,
      sessions,
      users: loc._sum.users ?? 0,
      conversions,
      conversionRate: sessions > 0 ? Math.round((conversions / sessions) * 10000) / 100 : 0,
    };
  });

  const data = { locations };

  await setCache(cacheKey, data, 120);

  return NextResponse.json(data);
}
