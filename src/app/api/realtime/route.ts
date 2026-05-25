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
    distinct: ['capturedAt'],
  });

  const data = {
    current: current ?? null,
    history: history.reverse(),
  };

  await setCache(cacheKey, data, 30);

  return NextResponse.json(data);
}
