import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCache, setCache } from '@/lib/redis';

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const dateStr = searchParams.get('date') || new Date().toISOString().slice(0, 10);

  const cacheKey = `tv-overlay:${dateStr}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const dayStart = new Date(dateStr + 'T00:00:00');
  const dayEnd = new Date(dateStr + 'T23:59:59.999');

  const schedule = await prisma.tvSchedule.findMany({
    where: {
      airDate: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { airDate: 'asc' },
  });

  const spots = schedule.map((s) => ({
    time: s.airDate.toISOString().slice(11, 16),
    station: s.station,
    program: s.program,
    spotLength: s.spotLength,
    pasmo: s.pasmo,
    spotVersion: s.spotVersion,
    zlecenie: s.zlecenie,
  }));

  const data = { spots };

  await setCache(cacheKey, data, 300);

  return NextResponse.json(data);
}
