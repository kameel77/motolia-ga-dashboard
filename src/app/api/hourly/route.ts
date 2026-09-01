import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCache, setCache } from '@/lib/redis';
import { getWarsawDateString, getWarsawNow } from '@/lib/utils';

function toWarsawTimeZoneDate(date: Date): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(date);
  const val = (name: string) => parseInt(parts.find(p => p.type === name)?.value || '0');
  
  const hour = val('hour');
  return new Date(Date.UTC(
    val('year'),
    val('month') - 1,
    val('day'),
    hour === 24 ? 0 : hour,
    val('minute'),
    val('second')
  ));
}

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
  const dateStr = searchParams.get('date') || getWarsawDateString();

  const cacheKey = `hourly:${dateStr}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const todayPrefix = dateStr.replace(/-/g, '');

  const [year, month, day] = dateStr.split('-').map(Number);
  const tempStartUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const tempEndUtc = new Date(tempStartUtc.getTime() + 24 * 60 * 60 * 1000);

  // Calculate the timezone offset in Warsaw local time for this day
  const warsawStartUtc = toWarsawTimeZoneDate(tempStartUtc);
  const offsetMs = warsawStartUtc.getTime() - tempStartUtc.getTime();

  // Standard UTC boundaries for query (representing local Warsaw day)
  const todayStart = new Date(tempStartUtc.getTime() - offsetMs);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const yesterdayDate = new Date(tempStartUtc.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayPrefix = getWarsawDateString(yesterdayDate).replace(/-/g, '');

  const weekAgoDate = new Date(tempStartUtc.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoPrefix = getWarsawDateString(weekAgoDate).replace(/-/g, '');

  const [todayData, yesterdayData, weekAgoData, realtimeSnapshots, crmCalls, crmLeads] = await Promise.all([
    prisma.trafficByHour.findMany({
      where: { dateHour: { startsWith: todayPrefix } },
      orderBy: { capturedAt: 'desc' },
      distinct: ['dateHour'],
    }),
    prisma.trafficByHour.findMany({
      where: { dateHour: { startsWith: yesterdayPrefix } },
      orderBy: { capturedAt: 'desc' },
      distinct: ['dateHour'],
    }),
    prisma.trafficByHour.findMany({
      where: { dateHour: { startsWith: weekAgoPrefix } },
      orderBy: { capturedAt: 'desc' },
      distinct: ['dateHour'],
    }),
    prisma.realtimeSnapshot.findMany({
      where: {
        capturedAt: {
          gte: tempStartUtc,
          lt: tempEndUtc,
        },
      },
      orderBy: { capturedAt: 'asc' },
    }),
    prisma.crmCall.findMany({
      where: {
        timestamp: {
          gte: todayStart,
          lt: todayEnd,
        },
        disposition: 'ANSWERED',
      },
    }),
    prisma.crmLead.findMany({
      where: {
        thuliumCreatedAt: {
          gte: todayStart,
          lt: todayEnd,
        },
      },
    }),
  ]);

  const getHourMinuteKey = (dh: string) => {
    if (dh.length === 10) return dh.slice(-2) + '00';
    return dh.slice(-4); // "HHMM"
  };

  const todayMap = new Map<string, (typeof todayData)[0]>();
  for (const row of todayData) {
    const key = getHourMinuteKey(row.dateHour);
    if (!todayMap.has(key)) todayMap.set(key, row);
  }

  const yesterdayMap = new Map<string, (typeof yesterdayData)[0]>();
  for (const row of yesterdayData) {
    const key = getHourMinuteKey(row.dateHour);
    if (!yesterdayMap.has(key)) yesterdayMap.set(key, row);
  }

  const weekAgoMap = new Map<string, (typeof weekAgoData)[0]>();
  for (const row of weekAgoData) {
    const key = getHourMinuteKey(row.dateHour);
    if (!weekAgoMap.has(key)) weekAgoMap.set(key, row);
  }

  const getSnapshotIntervalKey = (date: Date) => {
    const h = date.getUTCHours();
    const m = date.getUTCMinutes();
    const roundedM = m < 30 ? '00' : '30';
    return `${h.toString().padStart(2, '0')}${roundedM}`;
  };

  const realtimeMap = new Map<string, { activeUsers: number; keyEvents: number }>();
  for (const snap of realtimeSnapshots) {
    const key = getSnapshotIntervalKey(snap.capturedAt);
    realtimeMap.set(key, {
      activeUsers: snap.activeUsers,
      keyEvents: snap.keyEvents,
    });
  }

  const warsawNow = getWarsawNow();
  const currentHour = warsawNow.getUTCHours();
  const currentMinute = warsawNow.getUTCMinutes();
  const isToday = dateStr === getWarsawDateString();

  const points = [];
  for (let i = 0; i < 48; i++) {
    const h = Math.floor(i / 2);
    const m = (i % 2) * 30;
    const hourStr = h.toString().padStart(2, '0');
    const minuteStr = m.toString().padStart(2, '0');
    const key = `${hourStr}${minuteStr}`;
    const label = `${hourStr}:${minuteStr}`;

    const todayReport = todayMap.get(key);
    const yesterday = yesterdayMap.get(key);
    const weekAgo = weekAgoMap.get(key);

    const isFuture = isToday && (h > currentHour || (h === currentHour && m > currentMinute));
    const isRecent = isToday && (currentHour * 60 + currentMinute - (h * 60 + m) <= 180);

    let sessions: number | null = null;
    let users: number | null = null;
    let conversions: number | null = null;

    if (!isFuture) {
      if (todayReport && todayReport.sessions > 0) {
        sessions = todayReport.sessions;
        users = todayReport.users;
        conversions = todayReport.conversions;
      } else if (isRecent) {
        const rt = realtimeMap.get(key);
        if (rt) {
          sessions = rt.activeUsers;
          users = rt.activeUsers;
          conversions = rt.keyEvents;
        } else {
          sessions = 0;
          users = 0;
          conversions = 0;
        }
      } else {
        sessions = 0;
        users = 0;
        conversions = 0;
      }
    }

    const crmCallsCount = crmCalls.filter(c => {
      const callTime = new Date(c.timestamp.getTime() + offsetMs);
      const ch = callTime.getUTCHours();
      const cm = callTime.getUTCMinutes();
      return ch === h && cm >= m && cm < m + 30;
    }).length;

    const crmLeadsCount = crmLeads.filter(l => {
      const leadTime = new Date(l.thuliumCreatedAt.getTime() + offsetMs);
      const lh = leadTime.getUTCHours();
      const lm = leadTime.getUTCMinutes();
      return lh === h && lm >= m && lm < m + 30;
    }).length;

    points.push({
      hour: h,
      minute: m,
      label,
      sessions,
      users,
      conversions,
      sessionsYesterday: yesterday?.sessions ?? 0,
      sessionsWeekAgo: weekAgo?.sessions ?? 0,
      usersYesterday: yesterday?.users ?? 0,
      usersWeekAgo: weekAgo?.users ?? 0,
      crmCalls: crmCallsCount,
      crmLeads: crmLeadsCount,
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
    const dh = row.dateHour; // "YYYYMMDDHH" or "YYYYMMDDHHMM"
    if (dh.length !== 10 && dh.length !== 12) continue;
    const year = parseInt(dh.slice(0, 4));
    const month = parseInt(dh.slice(4, 6)) - 1;
    const day = parseInt(dh.slice(6, 8));
    const hour = parseInt(dh.slice(8, 10));

    const dateObj = new Date(Date.UTC(year, month, day));
    if (isNaN(dateObj.getTime())) continue;

    const jsDay = dateObj.getUTCDay(); // 0 = Sunday, 1 = Monday...
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
