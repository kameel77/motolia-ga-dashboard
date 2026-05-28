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

  const cacheKey = 'realtime:latest';
  const cached = await getCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const current = await prisma.realtimeSnapshot.findFirst({
    orderBy: { capturedAt: 'desc' },
  });

  const history = await prisma.realtimeSnapshot.findMany({
    orderBy: { capturedAt: 'desc' },
    take: 30,
  });

  const now = new Date();
  const minutes = history.map((snap) => {
    const diffMs = now.getTime() - new Date(snap.capturedAt).getTime();
    const minutesAgo = Math.max(0, Math.floor(diffMs / 60000));
    return {
      minutesAgo,
      activeUsers: snap.activeUsers,
    };
  });

  // Query spots in the last 30 minutes relative to server time
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
  const activeSpots = await prisma.tvSchedule.findMany({
    where: {
      airDate: {
        gte: thirtyMinutesAgo,
        lte: now,
      },
    },
    orderBy: { airDate: 'asc' },
  });

  const spots = activeSpots.map((spot) => {
    const diffMs = now.getTime() - new Date(spot.airDate).getTime();
    const minutesAgo = Math.max(0, Math.floor(diffMs / 60000));
    const pasmoKey = spot.pasmo?.toLowerCase().trim() || '';
    const color = PASMO_COLORS[pasmoKey] || '#3b82f6';
    return {
      minutesAgo,
      station: spot.station,
      program: spot.program,
      spotLength: spot.spotLength,
      spotVersion: spot.spotVersion,
      pasmo: spot.pasmo,
      color,
    };
  });

  const data = {
    activeUsers: current?.activeUsers ?? 0,
    minutes,
    spots,
    topSources: ((current?.topSources as any[]) ?? []).map((s: any) => ({
      name: s.eventName ?? '',
      value: s.eventCount ?? 0,
    })),
    topPages: ((current?.topPages as any[]) ?? []).map((p: any) => ({
      name: p.pagePath ?? '',
      value: p.activeUsers ?? 0,
    })),
    topCities: ((current?.topCities as any[]) ?? []).map((c: any) => ({
      name: c.city ? `${c.city}, ${c.country}` : (c.country ?? 'Inne'),
      value: c.activeUsers ?? 0,
    })),
  };

  await setCache(cacheKey, data, 10);

  return NextResponse.json(data);
}
