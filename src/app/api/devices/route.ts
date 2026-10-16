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

  const cacheKey = `devices:${period}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const startDate = getStartDate(period);
  const now = getWarsawNow();

  const [deviceData, supplement] = await Promise.all([
    prisma.trafficByDevice.groupBy({
      by: ['deviceCategory'],
      where: { capturedAt: { gte: startDate, lte: now } },
      _sum: { sessions: true, users: true },
      _avg: { bounceRate: true },
    }),
    getTodayIntradaySupplement(),
  ]);

  const merged = new Map<
    string,
    { device: string; sessions: number; users: number; bounceWeighted: number }
  >();

  for (const d of deviceData) {
    const key = d.deviceCategory.toLowerCase();
    const sessions = d._sum.sessions ?? 0;
    const bounce = d._avg.bounceRate ?? 0;
    merged.set(key, {
      device: d.deviceCategory,
      sessions,
      users: d._sum.users ?? 0,
      bounceWeighted: sessions * bounce,
    });
  }

  for (const rtDev of supplement.devices) {
    const key = rtDev.deviceCategory.toLowerCase();
    const existing = merged.get(key);
    if (existing) {
      existing.sessions += rtDev.sessions;
      existing.users += rtDev.users;
      existing.bounceWeighted += rtDev.sessions * rtDev.bounceRate;
    } else {
      merged.set(key, {
        device: rtDev.deviceCategory,
        sessions: rtDev.sessions,
        users: rtDev.users,
        bounceWeighted: rtDev.sessions * rtDev.bounceRate,
      });
    }
  }

  const rows = Array.from(merged.values())
    .map((d) => ({
      device: d.device,
      sessions: d.sessions,
      users: d.users,
      bounceRate:
        d.sessions > 0 ? Math.round((d.bounceWeighted / d.sessions) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  const data = { rows };

  await setCache(cacheKey, data, 120);

  return NextResponse.json(data);
}
