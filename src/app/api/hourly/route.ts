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

  const points = [];
  for (let h = 0; h < 24; h++) {
    const hourStr = h.toString().padStart(2, '0');
    const today = todayMap.get(hourStr);
    const yesterday = yesterdayMap.get(hourStr);
    const weekAgo = weekAgoMap.get(hourStr);

    points.push({
      hour: h,
      sessions: today?.sessions ?? 0,
      conversions: today?.conversions ?? 0,
      sessionsYesterday: yesterday?.sessions ?? 0,
      sessionsWeekAgo: weekAgo?.sessions ?? 0,
    });
  }

  // 4. Heatmap aggregation (last 30 days)
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const heatmapRaw = await prisma.trafficByHour.findMany({
    where: { capturedAt: { gte: thirtyDaysAgo } },
  });

  const deduplicated = new Map<string, typeof heatmapRaw[0]>();
  for (const row of heatmapRaw) {
    const existing = deduplicated.get(row.dateHour);
    if (!existing || row.id > existing.id) {
      deduplicated.set(row.dateHour, row);
    }
  }

  const heatmapSum = Array.from({ length: 7 }, () => Array(24).fill(0));
  const heatmapCount = Array.from({ length: 7 }, () => Array(24).fill(0));

  for (const row of deduplicated.values()) {
    const dh = row.dateHour; // "YYYYMMDDHH"
    if (dh.length !== 10) continue;
    const year = parseInt(dh.slice(0, 4));
    const month = parseInt(dh.slice(4, 6)) - 1;
    const day = parseInt(dh.slice(6, 8));
    const hour = parseInt(dh.slice(8, 10));

    const dateObj = new Date(year, month, day);
    if (isNaN(dateObj.getTime())) continue;

    const jsDay = dateObj.getDay(); // 0 = Sunday, 1 = Monday...
    const dayIndex = jsDay === 0 ? 6 : jsDay - 1; // 0 = Monday, ..., 6 = Sunday

    heatmapSum[dayIndex][hour] += row.sessions;
    heatmapCount[dayIndex][hour] += 1;
  }

  const heatmap = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const sum = heatmapSum[d][h];
      const count = heatmapCount[d][h];
      const avg = count > 0 ? Math.round(sum / count) : 0;
      heatmap.push({
        day: d,
        hour: h,
        sessions: avg,
      });
    }
  }

  const data = { points, heatmap, date: dateStr };

  await setCache(cacheKey, data, 60);

  return NextResponse.json(data);
}
