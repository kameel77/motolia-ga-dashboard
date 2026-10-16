import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCache, setCache } from '@/lib/redis';
import { getWarsawNow, getWarsawDateString, getPeriodRange, type Period } from '@/lib/utils';
import { GA4_FORM_EVENTS, GA4_PHONE_EVENTS } from '@/lib/ga4-client';
import { getTodayIntradaySupplement } from '@/lib/intraday';

const DAY_MS = 24 * 60 * 60 * 1000;

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
  const val = (name: string) => parseInt(parts.find((p) => p.type === name)?.value || '0');

  const hour = val('hour');
  return new Date(
    Date.UTC(
      val('year'),
      val('month') - 1,
      val('day'),
      hour === 24 ? 0 : hour,
      val('minute'),
      val('second')
    )
  );
}

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') || '7d') as Period;

  const cacheKey = `conversions:${period}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const current = getPeriodRange(period, 0);
  const previous = getPeriodRange(period, 1);
  const currentEndExclusive = new Date(current.endDate.getTime() + DAY_MS);
  const previousEndExclusive = new Date(previous.endDate.getTime() + DAY_MS);

  const now = getWarsawNow();
  const tempStartUtc = new Date(current.startDate);
  const warsawStartUtc = toWarsawTimeZoneDate(tempStartUtc);
  const offsetMs = warsawStartUtc.getTime() - tempStartUtc.getTime();
  const realUtcStartDate = new Date(current.startDate.getTime() - offsetMs);
  const realUtcNow = new Date(now.getTime() - offsetMs);

  const [
    byEventName,
    detailedEvents,
    trafficRows,
    periodSummary,
    prevConversionEvents,
    prevPeriodSummary,
    rawTrendData,
    crmCalls,
    crmLeads,
    supplement,
  ] = await Promise.all([
    prisma.conversionEvent.groupBy({
      by: ['eventName'],
      where: {
        capturedAt: { gte: current.startDate, lt: currentEndExclusive },
        eventName: { notIn: ['crm_lead_form', 'crm_lead_phone'] },
      },
      _sum: { count: true },
      orderBy: { _sum: { count: 'desc' } },
    }),
    prisma.conversionEvent.groupBy({
      by: ['eventName', 'source', 'medium'],
      where: {
        capturedAt: { gte: current.startDate, lt: currentEndExclusive },
        eventName: { notIn: ['crm_lead_form', 'crm_lead_phone'] },
      },
      _sum: { count: true },
      orderBy: { _sum: { count: 'desc' } },
    }),
    prisma.trafficBySource.findMany({
      where: { capturedAt: { gte: current.startDate, lt: currentEndExclusive } },
      select: { sessions: true, engagementRate: true },
    }),
    prisma.periodSummary.findUnique({
      where: { period_windowOffset: { period, windowOffset: 0 } },
    }),
    prisma.conversionEvent.groupBy({
      by: ['eventName'],
      where: {
        capturedAt: { gte: previous.startDate, lt: previousEndExclusive },
        eventName: { notIn: ['crm_lead_form', 'crm_lead_phone'] },
      },
      _sum: { count: true },
    }),
    prisma.periodSummary.findUnique({
      where: { period_windowOffset: { period, windowOffset: 1 } },
    }),
    prisma.dailySnapshot.findMany({
      where: { date: { gte: current.startDate, lte: current.endDate } },
      orderBy: { date: 'asc' },
    }),
    prisma.crmCall.findMany({
      where: {
        timestamp: { gte: realUtcStartDate, lte: realUtcNow },
        disposition: 'ANSWERED',
        direction: 'INBOUND',
      },
      select: { timestamp: true },
    }),
    prisma.crmLead.findMany({
      where: {
        thuliumCreatedAt: { gte: realUtcStartDate, lte: realUtcNow },
        source: { not: 'PHONE' },
        NOT: [
          { queueName: { contains: 'Nieodebrane', mode: 'insensitive' } },
          { subject: { contains: 'Nieodebrane', mode: 'insensitive' } },
          { thuliumStatus: { contains: 'SPAM', mode: 'insensitive' } },
        ],
      },
      select: { thuliumCreatedAt: true },
    }),
    getTodayIntradaySupplement(),
  ]);

  const eventCountMap = new Map<string, number>();
  for (const ev of byEventName) {
    eventCountMap.set(ev.eventName, ev._sum.count ?? 0);
  }
  for (const [evName, cnt] of supplement.eventsByName.entries()) {
    eventCountMap.set(evName, (eventCountMap.get(evName) ?? 0) + cnt);
  }

  const events = Array.from(eventCountMap.entries())
    .filter(([, count]) => count > 0)
    .map(([eventName, count]) => {
      const sources = detailedEvents
        .filter((d) => d.eventName === eventName)
        .map((d) => ({
          source: d.source ?? 'Direct',
          medium: d.medium ?? '(none)',
          count: d._sum.count ?? 0,
        }));

      const topSrc =
        sources.length > 0
          ? sources.reduce(
              (max, s) => (s.count > max.count ? s : max),
              { source: 'Direct', medium: '(none)', count: -1 }
            )
          : { source: '(realtime)', medium: '(live)', count };

      return {
        eventName,
        count,
        topSource: `${topSrc.source} / ${topSrc.medium}`,
      };
    })
    .sort((a, b) => b.count - a.count);

  const formSubmissions = GA4_FORM_EVENTS.reduce(
    (sum, name) => sum + (eventCountMap.get(name) ?? 0),
    0
  );
  const phoneCalls = GA4_PHONE_EVENTS.reduce(
    (sum, name) => sum + (eventCountMap.get(name) ?? 0),
    0
  );
  const total = Math.max(
    formSubmissions + phoneCalls,
    (periodSummary?.conversions ?? 0) + supplement.conversions
  );

  const sourceSessions = trafficRows.reduce((sum, r) => sum + r.sessions, 0);
  const totalSessions =
    (periodSummary?.sessions ?? sourceSessions) + supplement.sessions;

  const avgEngagementRate =
    sourceSessions > 0
      ? trafficRows.reduce((sum, r) => sum + r.sessions * (r.engagementRate ?? 0), 0) /
        sourceSessions
      : Math.max(0, 1 - (periodSummary?.bounceRate || supplement.bounceRate || 0.25));

  const engagedSessions = Math.round(totalSessions * avgEngagementRate);
  const conversionRate =
    totalSessions > 0 ? Math.round((total / totalSessions) * 10000) / 100 : 0;

  // 2. Previous Period aggregations
  const prevFormSubmissions = prevConversionEvents
    .filter((e) => GA4_FORM_EVENTS.includes(e.eventName))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const prevPhoneCalls = prevConversionEvents
    .filter((e) => GA4_PHONE_EVENTS.includes(e.eventName))
    .reduce((sum, e) => sum + (e._sum.count ?? 0), 0);

  const prevTotal = Math.max(
    prevFormSubmissions + prevPhoneCalls,
    prevPeriodSummary?.conversions ?? 0
  );
  const prevTotalSessions = prevPeriodSummary?.sessions ?? 0;
  const prevConversionRate =
    prevTotalSessions > 0
      ? Math.round((prevTotal / prevTotalSessions) * 10000) / 100
      : 0;

  // 3. Daily snapshot data with real CRM event breakdown
  const crmByDate = new Map<string, { crmForms: number; crmPhones: number }>();
  for (const lead of crmLeads) {
    const dateKey = getWarsawDateString(lead.thuliumCreatedAt);
    const entry = crmByDate.get(dateKey) ?? { crmForms: 0, crmPhones: 0 };
    entry.crmForms += 1;
    crmByDate.set(dateKey, entry);
  }
  for (const call of crmCalls) {
    const dateKey = getWarsawDateString(call.timestamp);
    const entry = crmByDate.get(dateKey) ?? { crmForms: 0, crmPhones: 0 };
    entry.crmPhones += 1;
    crmByDate.set(dateKey, entry);
  }

  const trendData = rawTrendData.map((d) => ({ ...d }));
  const todayIdx = trendData.findIndex(
    (d) => d.date.toISOString().split('T')[0] === supplement.todayDateStr
  );
  if (todayIdx >= 0) {
    trendData[todayIdx].sessions += supplement.sessions;
    trendData[todayIdx].users += supplement.users;
  } else if (supplement.sessions > 0 || crmByDate.has(supplement.todayDateStr)) {
    trendData.push({
      id: 0,
      date: supplement.todayDate,
      sessions: supplement.sessions,
      users: supplement.users,
      newUsers: supplement.newUsers,
      bounceRate: supplement.bounceRate,
      conversions: supplement.conversions,
      avgSessionDuration: 0,
      createdAt: new Date(),
    });
  }

  const daily = trendData.map((d) => {
    const dateStr = d.date.toISOString().split('T')[0];
    const crm = crmByDate.get(dateStr) ?? { crmForms: 0, crmPhones: 0 };
    return {
      date: dateStr,
      sessions: d.sessions,
      users: d.users,
      crmForms: crm.crmForms,
      crmPhones: crm.crmPhones,
    };
  });

  const data = {
    formSubmissions: {
      value: formSubmissions,
      previousValue: prevFormSubmissions,
    },
    phoneClicks: {
      value: phoneCalls,
      previousValue: prevPhoneCalls,
    },
    totalConversions: {
      value: total,
      previousValue: prevTotal,
    },
    conversionRate: {
      value: conversionRate,
      previousValue: prevConversionRate,
    },
    daily,
    events,
    funnel: [
      { label: 'Sesje', value: totalSessions },
      { label: 'Zaangażowani', value: engagedSessions },
      { label: 'Konwersje', value: total },
    ],
  };

  await setCache(cacheKey, data, 60);

  return NextResponse.json(data);
}
