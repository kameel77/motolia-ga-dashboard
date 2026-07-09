import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCache, setCache } from '@/lib/redis';
import { getWarsawNow } from '@/lib/utils';
import { fetchRealtimeData } from '@/lib/ga4-client';

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

  // Fetch current live data from GA Realtime API
  const gaData = await fetchRealtimeData();
  const now = getWarsawNow();

  // Map GA4 Realtime data into a minute-by-minute map (0 to 29)
  const minuteMap = new Map<number, number>();
  gaData.activeUsersByMinute.forEach((item) => {
    const min = parseInt(item.minutesAgo, 10);
    if (!isNaN(min)) {
      minuteMap.set(min, item.activeUsers);
    }
  });

  // Construct continuous minutes array from 0 to 29
  const minutes = [];
  for (let i = 0; i < 30; i++) {
    minutes.push({
      minutesAgo: i,
      activeUsers: minuteMap.get(i) ?? 0,
    });
  }

  // Query spots for the last 30 minutes (matching the chart range)
  const oldestTime = new Date(now.getTime() - 30 * 60 * 1000);
  const activeSpots = await prisma.tvSchedule.findMany({
    where: {
      airDate: {
        gte: oldestTime,
        lte: now,
      },
    },
    orderBy: { airDate: 'asc' },
  });

  const spots = activeSpots.map((spot) => {
    const spotTime = new Date(spot.airDate);
    const diffMs = now.getTime() - spotTime.getTime();
    
    // Aligns exactly to the minute bucket (0 to 29)
    const minutesAgo = Math.max(0, Math.min(29, Math.floor(diffMs / 60000)));

    const hh = String(spotTime.getUTCHours()).padStart(2, '0');
    const mm = String(spotTime.getUTCMinutes()).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;

    const pasmoKey = spot.pasmo?.toLowerCase().trim() || '';
    const color = PASMO_COLORS[pasmoKey] || '#3b82f6';
    
    return {
      minutesAgo,
      time: timeStr,
      station: spot.station,
      program: spot.program,
      spotLength: spot.spotLength,
      spotVersion: spot.spotVersion,
      pasmo: spot.pasmo,
      color,
    };
  });

  const data = {
    activeUsers: gaData.totalActiveUsers,
    minutes,
    spots,
    topSources: gaData.events.slice(0, 10).map((s) => ({
      name: s.eventName ?? '',
      value: s.eventCount ?? 0,
    })),
    topPages: gaData.pages.slice(0, 10).map((p) => ({
      name: p.pagePath ?? '',
      value: p.activeUsers ?? 0,
    })),
    topCities: gaData.geo.slice(0, 10).map((c) => ({
      name: c.city ? `${c.city}, ${c.country}` : (c.country ?? 'Inne'),
      value: c.activeUsers ?? 0,
    })),
  };

  // Cache for 10 seconds to limit GA4 API quota consumption
  await setCache(cacheKey, data, 10);

  return NextResponse.json(data);
}
