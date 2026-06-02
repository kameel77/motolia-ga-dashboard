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

  const deviceData = await prisma.trafficByDevice.groupBy({
    by: ['deviceCategory'],
    where: { capturedAt: { gte: startDate, lte: now } },
    _sum: { sessions: true, users: true },
    _avg: { bounceRate: true },
  });

  const totalSessions = deviceData.reduce((sum, d) => sum + (d._sum.sessions ?? 0), 0);

  const rows = deviceData.map((d) => {
    const sessions = d._sum.sessions ?? 0;
    return {
      device: d.deviceCategory,
      sessions,
      users: d._sum.users ?? 0,
      bounceRate: Math.round((d._avg.bounceRate ?? 0) * 10000) / 100,
    };
  });

  rows.sort((a, b) => b.sessions - a.sessions);

  const data = { rows };

  await setCache(cacheKey, data, 120);

  return NextResponse.json(data);
}
