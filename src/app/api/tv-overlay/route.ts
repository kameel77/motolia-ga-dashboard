import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCache, setCache } from '@/lib/redis';

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

  const spots = schedule.map((s) => {
    const hour = s.airDate.getHours();
    const minute = s.airDate.getMinutes();
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
