import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCache, setCache } from '@/lib/redis';
import { getWarsawDateString } from '@/lib/utils';

const PASMO_COLORS: Record<string, string> = {
  day: '#fbbf24',
  prime: '#ef4444',
  'early fringe': '#8b5cf6',
  morning: '#06b6d4',
};

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const dateStr = searchParams.get('date') || getWarsawDateString();

  const cacheKey = `tv-overlay:${dateStr}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  const dayStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

  const schedule = await prisma.tvSchedule.findMany({
    where: {
      airDate: { gte: dayStart, lte: dayEnd },
    },
    orderBy: { airDate: 'asc' },
  });

  const spots = schedule.map((s) => {
    const hour = s.airDate.getUTCHours();
    const minute = s.airDate.getUTCMinutes();
    const pasmoKey = s.pasmo?.toLowerCase().trim() || '';
    const color = PASMO_COLORS[pasmoKey] || '#3b82f6';
    
    return {
      hour,
      minute,
      station: s.station,
      pasmo: s.pasmo,
      color,
      program: s.program,
      spotLength: s.spotLength,
      spotVersion: s.spotVersion,
      zlecenie: s.zlecenie,
    };
  });

  const data = { spots };

  await setCache(cacheKey, data, 300);

  return NextResponse.json(data);
}
