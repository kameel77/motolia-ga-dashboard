import { prisma } from './prisma';
import { getWarsawNow, getWarsawDateString } from './utils';
import { GA4_FORM_EVENTS, GA4_PHONE_EVENTS, GA4_CONVERSION_EVENTS } from './ga4-client';

export interface HourRealtimeStats {
  hour: number;
  sessions: number;
  users: number;
  conversions: number;
  formSubmissions: number;
  phoneClicks: number;
  firstVisits: number;
  eventsByName: Map<string, number>;
  cities: Map<string, { country: string; city: string; sessions: number; users: number }>;
  devices: Map<string, { deviceCategory: string; sessions: number; users: number }>;
  hasExplicitDevices: boolean;
}

export interface TodayIntradaySupplement {
  todayDate: Date;
  todayDateStr: string;
  finalizedHoursCount: number;
  sessions: number;
  users: number;
  newUsers: number;
  bounceRate: number;
  conversions: number;
  formSubmissions: number;
  phoneClicks: number;
  eventsByName: Map<string, number>;
  cities: Array<{ country: string; region: string; city: string; sessions: number; users: number; conversions: number }>;
  devices: Array<{ deviceCategory: string; sessions: number; users: number; bounceRate: number }>;
  byHour: Map<number, HourRealtimeStats>;
}

interface RawEventItem {
  eventName?: string;
  eventCount?: number;
}

interface RawCityItem {
  country?: string;
  city?: string;
  activeUsers?: number;
}

interface RawDeviceItem {
  deviceCategory?: string;
  activeUsers?: number;
}

function parseEvents(json: unknown): RawEventItem[] {
  return Array.isArray(json) ? (json as RawEventItem[]) : [];
}

function parseCities(json: unknown): RawCityItem[] {
  return Array.isArray(json) ? (json as RawCityItem[]) : [];
}

function parseDevices(json: unknown): RawDeviceItem[] {
  return Array.isArray(json) ? (json as RawDeviceItem[]) : [];
}

/**
 * Computes intraday traffic & conversions from RealtimeSnapshot rows for hours
 * of today that GA4's standard Data API (`runReport` / `TrafficByHour`) has not
 * yet finalized.
 *
 * Each GA4 Realtime snapshot covers a rolling 30-minute window (`minutesAgo`
 * 0..29) and is collected every 5 minutes. Partitioning each hour into its two
 * half-hour slots (`00..29` and `30..59`) and taking the latest snapshot in
 * each slot yields non-overlapping 30-minute windows across the day (with
 * proportional weighting when the second slot is <25 minutes after the first).
 */
export async function getTodayIntradaySupplement(): Promise<TodayIntradaySupplement> {
  const warsawNow = getWarsawNow();
  const currentHour = warsawNow.getUTCHours();
  const todayDateStr = getWarsawDateString();
  const todayPrefix = todayDateStr.replace(/-/g, '');

  const todayStart = new Date(warsawNow);
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [todayHourly, realtimeSnapshots, baseline7d, deviceBaselineRows] = await Promise.all([
    prisma.trafficByHour.findMany({
      where: { dateHour: { startsWith: todayPrefix } },
      orderBy: { capturedAt: 'desc' },
      distinct: ['dateHour'],
    }),
    prisma.realtimeSnapshot.findMany({
      where: { capturedAt: { gte: todayStart, lt: todayEnd } },
      orderBy: { capturedAt: 'asc' },
    }),
    prisma.periodSummary.findUnique({
      where: { period_windowOffset: { period: '7d', windowOffset: 0 } },
    }),
    prisma.trafficByDevice.groupBy({
      by: ['deviceCategory'],
      where: { capturedAt: { gte: sevenDaysAgo, lt: todayStart } },
      _sum: { sessions: true, users: true },
      _avg: { bounceRate: true },
    }),
  ]);

  const finalizedHours = new Set<number>();
  for (const row of todayHourly) {
    const h = parseInt(row.dateHour.slice(8, 10), 10);
    if (!isNaN(h) && (row.sessions > 0 || row.users > 0)) {
      finalizedHours.add(h);
    }
  }

  type SnapRow = (typeof realtimeSnapshots)[number];
  const hourBuckets = new Map<
    number,
    { maxActiveUsers: number; maxKeyEvents: number; h1: SnapRow | null; h2: SnapRow | null }
  >();

  for (const snap of realtimeSnapshots) {
    const h = snap.capturedAt.getUTCHours();
    const m = snap.capturedAt.getUTCMinutes();
    let b = hourBuckets.get(h);
    if (!b) {
      b = { maxActiveUsers: 0, maxKeyEvents: 0, h1: null, h2: null };
      hourBuckets.set(h, b);
    }
    b.maxActiveUsers = Math.max(b.maxActiveUsers, snap.activeUsers);
    b.maxKeyEvents = Math.max(b.maxKeyEvents, snap.keyEvents);
    if (m < 30) {
      b.h1 = snap;
    } else {
      b.h2 = snap;
    }
  }

  const byHour = new Map<number, HourRealtimeStats>();

  for (const [h, b] of hourBuckets.entries()) {
    const eventsByName = new Map<string, number>();
    const cities = new Map<string, { country: string; city: string; sessions: number; users: number }>();
    const devices = new Map<string, { deviceCategory: string; sessions: number; users: number }>();
    let sessions = 0;
    let keyEvents = 0;
    let hasExplicitDevices = false;

    const addCities = (snap: SnapRow, weight: number) => {
      for (const c of parseCities(snap.topCities)) {
        const country = (c.country || 'Poland').trim();
        const city = (c.city || '(not set)').trim();
        const val = Math.round((c.activeUsers ?? 0) * weight);
        if (val <= 0) continue;
        const key = `${country}|${city}`;
        const prev = cities.get(key) ?? { country, city, sessions: 0, users: 0 };
        prev.sessions += val;
        prev.users = Math.max(prev.users, c.activeUsers ?? 0);
        cities.set(key, prev);
      }
    };

    const addDevices = (snap: SnapRow, weight: number) => {
      const rawDevs = parseDevices((snap as Record<string, unknown>).topDevices);
      if (rawDevs.length === 0) return;
      hasExplicitDevices = true;
      for (const d of rawDevs) {
        const cat = (d.deviceCategory || 'desktop').toLowerCase();
        const val = Math.round((d.activeUsers ?? 0) * weight);
        if (val <= 0) continue;
        const prev = devices.get(cat) ?? { deviceCategory: cat, sessions: 0, users: 0 };
        prev.sessions += val;
        prev.users = Math.max(prev.users, d.activeUsers ?? 0);
        devices.set(cat, prev);
      }
    };

    if (b.h1 && b.h2) {
      const diffMin = (b.h2.capturedAt.getTime() - b.h1.capturedAt.getTime()) / 60000;
      const disjoint = diffMin >= 25;
      const w2 = disjoint ? 1 : Math.max(0, diffMin / 30);

      sessions = b.h1.activeUsers + Math.round(b.h2.activeUsers * w2);
      keyEvents = disjoint ? b.h1.keyEvents + b.h2.keyEvents : Math.max(b.h1.keyEvents, b.h2.keyEvents);

      const ev1 = new Map<string, number>();
      for (const e of parseEvents(b.h1.topSources)) {
        if (e.eventName) ev1.set(e.eventName, (ev1.get(e.eventName) ?? 0) + (e.eventCount ?? 0));
      }
      const ev2 = new Map<string, number>();
      for (const e of parseEvents(b.h2.topSources)) {
        if (e.eventName) ev2.set(e.eventName, (ev2.get(e.eventName) ?? 0) + (e.eventCount ?? 0));
      }
      const allEventNames = new Set([...ev1.keys(), ...ev2.keys()]);
      for (const name of allEventNames) {
        const c1 = ev1.get(name) ?? 0;
        const c2 = ev2.get(name) ?? 0;
        eventsByName.set(name, disjoint ? c1 + c2 : Math.max(c1, c2));
      }

      addCities(b.h1, 1);
      addCities(b.h2, w2);
      addDevices(b.h1, 1);
      addDevices(b.h2, w2);
    } else {
      const s = (b.h1 || b.h2)!;
      sessions = s.activeUsers;
      keyEvents = s.keyEvents;
      for (const e of parseEvents(s.topSources)) {
        if (e.eventName) {
          eventsByName.set(e.eventName, (eventsByName.get(e.eventName) ?? 0) + (e.eventCount ?? 0));
        }
      }
      addCities(s, 1);
      addDevices(s, 1);
    }

    const users = Math.min(sessions, b.maxActiveUsers);
    const formSubmissions = GA4_FORM_EVENTS.reduce((sum, n) => sum + (eventsByName.get(n) ?? 0), 0);
    const phoneClicks = GA4_PHONE_EVENTS.reduce((sum, n) => sum + (eventsByName.get(n) ?? 0), 0);
    const conversions = Math.max(keyEvents, formSubmissions + phoneClicks);
    const firstVisits = eventsByName.get('first_visit') ?? 0;

    byHour.set(h, {
      hour: h,
      sessions,
      users,
      conversions,
      formSubmissions,
      phoneClicks,
      firstVisits,
      eventsByName,
      cities,
      devices,
      hasExplicitDevices,
    });
  }

  // Aggregate across unfinalized hours of today (h <= currentHour and not in finalizedHours)
  let totalSessions = 0;
  let totalUsers = 0;
  let totalConversions = 0;
  let totalFormSubmissions = 0;
  let totalPhoneClicks = 0;
  let totalFirstVisits = 0;
  let unattributedDeviceSessions = 0;
  let unattributedDeviceUsers = 0;

  const totalEventsByName = new Map<string, number>();
  const totalCities = new Map<string, { country: string; city: string; sessions: number; users: number }>();
  const totalDevices = new Map<string, { deviceCategory: string; sessions: number; users: number }>();

  for (let h = 0; h <= currentHour; h++) {
    if (finalizedHours.has(h)) continue;
    const hr = byHour.get(h);
    if (!hr) continue;

    totalSessions += hr.sessions;
    totalUsers += hr.users;
    totalConversions += hr.conversions;
    totalFormSubmissions += hr.formSubmissions;
    totalPhoneClicks += hr.phoneClicks;
    totalFirstVisits += hr.firstVisits;

    for (const [name, cnt] of hr.eventsByName.entries()) {
      if (GA4_CONVERSION_EVENTS.includes(name)) {
        totalEventsByName.set(name, (totalEventsByName.get(name) ?? 0) + cnt);
      }
    }

    for (const [key, c] of hr.cities.entries()) {
      const prev = totalCities.get(key) ?? { country: c.country, city: c.city, sessions: 0, users: 0 };
      prev.sessions += c.sessions;
      prev.users += c.users;
      totalCities.set(key, prev);
    }

    if (hr.hasExplicitDevices) {
      for (const [cat, d] of hr.devices.entries()) {
        const prev = totalDevices.get(cat) ?? { deviceCategory: cat, sessions: 0, users: 0 };
        prev.sessions += d.sessions;
        prev.users += d.users;
        totalDevices.set(cat, prev);
      }
    } else {
      unattributedDeviceSessions += hr.sessions;
      unattributedDeviceUsers += hr.users;
    }
  }

  const newUsersRatio =
    baseline7d && baseline7d.users > 0
      ? Math.min(1, Math.max(0.1, baseline7d.newUsers / baseline7d.users))
      : 0.65;

  const totalNewUsers =
    totalUsers > 0
      ? Math.max(totalFirstVisits, Math.min(totalUsers, Math.round(totalUsers * newUsersRatio)))
      : 0;

  const bounceRate = baseline7d?.bounceRate ?? 0;

  // Distribute any snapshots from earlier today that lacked `topDevices` using 7-day device shares
  if (unattributedDeviceSessions > 0 && deviceBaselineRows.length > 0) {
    const baseTotalSessions = deviceBaselineRows.reduce((s, d) => s + (d._sum.sessions ?? 0), 0);
    const baseTotalUsers = deviceBaselineRows.reduce((s, d) => s + (d._sum.users ?? 0), 0);
    if (baseTotalSessions > 0) {
      let remSessions = unattributedDeviceSessions;
      let remUsers = unattributedDeviceUsers;
      deviceBaselineRows.forEach((d, idx) => {
        const cat = d.deviceCategory;
        const isLast = idx === deviceBaselineRows.length - 1;
        const sShare = (d._sum.sessions ?? 0) / baseTotalSessions;
        const uShare = baseTotalUsers > 0 ? (d._sum.users ?? 0) / baseTotalUsers : sShare;
        const allocS = isLast ? remSessions : Math.round(unattributedDeviceSessions * sShare);
        const allocU = isLast ? remUsers : Math.round(unattributedDeviceUsers * uShare);
        remSessions = Math.max(0, remSessions - allocS);
        remUsers = Math.max(0, remUsers - allocU);
        const prev = totalDevices.get(cat) ?? { deviceCategory: cat, sessions: 0, users: 0 };
        prev.sessions += allocS;
        prev.users += allocU;
        totalDevices.set(cat, prev);
      });
    }
  }

  const deviceBounceMap = new Map<string, number>();
  for (const d of deviceBaselineRows) {
    deviceBounceMap.set(d.deviceCategory.toLowerCase(), d._avg.bounceRate ?? bounceRate);
  }

  const citiesList = Array.from(totalCities.values())
    .map((c) => ({
      country: c.country,
      region: '',
      city: c.city,
      sessions: c.sessions,
      users: Math.min(c.sessions, c.users),
      conversions: 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  const devicesList = Array.from(totalDevices.values())
    .filter((d) => d.sessions > 0)
    .map((d) => ({
      deviceCategory: d.deviceCategory,
      sessions: d.sessions,
      users: Math.min(d.sessions, d.users),
      bounceRate: deviceBounceMap.get(d.deviceCategory.toLowerCase()) ?? bounceRate,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  return {
    todayDate: todayStart,
    todayDateStr,
    finalizedHoursCount: finalizedHours.size,
    sessions: totalSessions,
    users: totalUsers,
    newUsers: totalNewUsers,
    bounceRate,
    conversions: totalConversions,
    formSubmissions: totalFormSubmissions,
    phoneClicks: totalPhoneClicks,
    eventsByName: totalEventsByName,
    cities: citiesList,
    devices: devicesList,
    byHour,
  };
}
