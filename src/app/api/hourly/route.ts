import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCache, setCache } from '@/lib/redis';

function getDayRange(dateStr: string): { start: Date; end: Date } {
  const d = new Date(dateStr + 'T00:00:00');
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return { start, end };
}

interface HourlyEntry {
  hour: string;
  sessions: number;
  users: number;
  conversions: number;
  sessionsYesterday: number;
  sessionsWeekAgo: number;
}

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const dateStr = searchParams.get('date') || new Date().toISOString().slice(0, 10);

  const cacheKey = `hourly:${dateStr}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const { start: todayStart, end: todayEnd } = getDayRange(dateStr);

  const yesterdayDate = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);
  const { start: yesterdayStart, end: yesterdayEnd } = getDayRange(yesterdayStr);

  const weekAgoDate = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoStr = weekAgoDate.toISOString().slice(0, 10);
  const { start: weekAgoStart, end: weekAgoEnd } = getDayRange(weekAgoStr);

  const [todayData, yesterdayData, weekAgoData] = await Promise.all([
    prisma.trafficByHour.findMany({
      where: { capturedAt: { gte: todayStart, lt: todayEnd } },
      orderBy: { capturedAt: 'desc' },
      distinct: ['dateHour'],
    }),
    prisma.trafficByHour.findMany({
      where: { capturedAt: { gte: yesterdayStart, lt: yesterdayEnd } },
      orderBy: { capturedAt: 'desc' },
      distinct: ['dateHour'],
    }),
    prisma.trafficByHour.findMany({
      where: { capturedAt: { gte: weekAgoStart, lt: weekAgoEnd } },
      orderBy: { capturedAt: 'desc' },
      distinct: ['dateHour'],
    }),
  ]);

  const extractHour = (dateHour: string) => dateHour.slice(-2);

  const todayMap = new Map<string, (typeof todayData)[0]>();
  for (const row of todayData) {
    const hour = extractHour(row.dateHour);
    if (!todayMap.has(hour)) todayMap.set(hour, row);
  }

  const yesterdayMap = new Map<string, (typeof yesterdayData)[0]>();
  for (const row of yesterdayData) {
    const hour = extractHour(row.dateHour);
    if (!yesterdayMap.has(hour)) yesterdayMap.set(hour, row);
  }

  const weekAgoMap = new Map<string, (typeof weekAgoData)[0]>();
  for (const row of weekAgoData) {
    const hour = extractHour(row.dateHour);
    if (!weekAgoMap.has(hour)) weekAgoMap.set(hour, row);
  }

  const hourly: HourlyEntry[] = [];
  for (let h = 0; h < 24; h++) {
    const hour = h.toString().padStart(2, '0');
    const today = todayMap.get(hour);
    const yesterday = yesterdayMap.get(hour);
    const weekAgo = weekAgoMap.get(hour);

    hourly.push({
      hour,
      sessions: today?.sessions ?? 0,
      users: today?.users ?? 0,
      conversions: today?.conversions ?? 0,
      sessionsYesterday: yesterday?.sessions ?? 0,
      sessionsWeekAgo: weekAgo?.sessions ?? 0,
    });
  }

  const data = { hourly, date: dateStr };

  await setCache(cacheKey, data, 60);

  return NextResponse.json(data);
}
