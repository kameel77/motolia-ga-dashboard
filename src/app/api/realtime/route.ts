import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCache, setCache } from '@/lib/redis';

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

  const data = {
    activeUsers: current?.activeUsers ?? 0,
    minutes,
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
