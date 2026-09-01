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

  // dateHour is "YYYYMMDDHH" for rows collected with the hourly GA4 dimension
  // and "YYYYMMDDHHMM" for legacy 30-minute rows. Both key on the same hour;
  // the two halves of a legacy hour are added together.
  const groupByHour = (rows: typeof todayData) => {
    const map = new Map<number, { sessions: number; users: number; conversions: number }>();
    for (const row of rows) {
      const hour = parseInt(row.dateHour.slice(8, 10), 10);
      if (isNaN(hour)) continue;
      const acc = map.get(hour);
      if (acc) {
        acc.sessions += row.sessions;
        acc.users += row.users;
        acc.conversions += row.conversions;
      } else {
        map.set(hour, {
          sessions: row.sessions,
          users: row.users,
          conversions: row.conversions,
        });
      }
    }
    return map;
  };

  const todayMap = groupByHour(todayData);
  const yesterdayMap = groupByHour(yesterdayData);
  const weekAgoMap = groupByHour(weekAgoData);

  // An hour spans many realtime snapshots. Used only as a stand-in while GA4
  // still lags on the current hour, so take the busiest snapshot rather than
  // whichever one happened to land last.
  const realtimeMap = new Map<number, { activeUsers: number; keyEvents: number }>();
  for (const snap of realtimeSnapshots) {
    const hour = snap.capturedAt.getUTCHours();
    const prev = realtimeMap.get(hour);
    realtimeMap.set(hour, {
      activeUsers: Math.max(prev?.activeUsers ?? 0, snap.activeUsers),
      keyEvents: Math.max(prev?.keyEvents ?? 0, snap.keyEvents),
    });
  }

  const warsawNow = getWarsawNow();
  const currentHour = warsawNow.getUTCHours();
  const isToday = dateStr === getWarsawDateString();

  const points = [];
  for (let h = 0; h < 24; h++) {
    const label = `${h.toString().padStart(2, '0')}:00`;

    const todayReport = todayMap.get(h);
    const yesterday = yesterdayMap.get(h);
    const weekAgo = weekAgoMap.get(h);

    const isFuture = isToday && h > currentHour;
    const isRecent = isToday && currentHour - h <= 3;

    let sessions: number | null = null;
    let users: number | null = null;
    let conversions: number | null = null;

    if (!isFuture) {
      if (todayReport && todayReport.sessions > 0) {
        sessions = todayReport.sessions;
        users = todayReport.users;
        conversions = todayReport.conversions;
      } else if (isRecent) {
        const rt = realtimeMap.get(h);
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
      return callTime.getUTCHours() === h;
    }).length;

    const crmLeadsCount = crmLeads.filter(l => {
      const leadTime = new Date(l.thuliumCreatedAt.getTime() + offsetMs);
      return leadTime.getUTCHours() === h;
    }).length;

    points.push({
      hour: h,
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

  // Collapse to one value per (calendar day, hour) before averaging. Legacy
  // rows are half-hourly, so an hour can be spread over two of them — counting
  // those as two observations would halve every legacy hour in the average.
  const perDayHour = new Map<string, number>();
  for (const row of deduplicated.values()) {
    const dh = row.dateHour; // "YYYYMMDDHH" or "YYYYMMDDHHMM"
    if (dh.length !== 10 && dh.length !== 12) continue;
    const hour = parseInt(dh.slice(8, 10));
    if (isNaN(hour)) continue;
    const key = `${dh.slice(0, 8)}-${hour}`;
    perDayHour.set(key, (perDayHour.get(key) ?? 0) + row.sessions);
  }

  for (const [key, sessions] of perDayHour) {
    const dayKey = key.slice(0, 8);
    const hour = parseInt(key.slice(9));

    const dateObj = new Date(
      Date.UTC(
        parseInt(dayKey.slice(0, 4)),
        parseInt(dayKey.slice(4, 6)) - 1,
        parseInt(dayKey.slice(6, 8))
      )
    );
    if (isNaN(dateObj.getTime())) continue;

    const jsDay = dateObj.getUTCDay(); // 0 = Sunday, 1 = Monday...
    const dayIndex = jsDay === 0 ? 6 : jsDay - 1; // 0 = Monday, ..., 6 = Sunday

    heatmapSum[dayIndex][hour] += sessions;
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
