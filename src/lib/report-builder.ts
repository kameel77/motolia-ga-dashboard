import { CrmLeadSource, CrmLeadStatus, Prisma, ReportGranularity } from '@prisma/client';
import { prisma } from './prisma';
import { getWarsawDateString, getWarsawNow } from './utils';
import { summarizeInboundCalls, type CallLike } from './thulium-mapping';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface KpiMetric {
  value: number;
  previousValue: number;
  deltaPct: number | null;
}

export interface ReportAlert {
  severity: 'positive' | 'warning' | 'info';
  title: string;
  detail: string;
}

export interface ReportWindow {
  granularity: ReportGranularity;
  periodKey: string;
  label: string;
  startDate: Date; // UTC midnight representing Warsaw calendar date
  endDate: Date;   // UTC midnight representing Warsaw calendar date
  startStr: string;
  endStr: string;
  baselinePeriodKey: string;
  baselineLabel: string;
  baselineStartDate: Date;
  baselineEndDate: Date;
  baselineStartStr: string;
  baselineEndStr: string;
}

export interface ReportPayload {
  period: {
    granularity: ReportGranularity;
    periodKey: string;
    label: string;
    startDate: string;
    endDate: string;
    baselineLabel: string;
    baselineStartDate: string;
    baselineEndDate: string;
  };
  kpi: {
    sessions: KpiMetric;
    users: KpiMetric;
    newUsers: KpiMetric;
    bounceRate: KpiMetric;
    webFormLeads: KpiMetric;
    phoneUniqueAnswered: KpiMetric;
    phoneUniqueMissed: KpiMetric;
    totalLeads: KpiMetric;
    conversionRatePct: KpiMetric;
  };
  traffic: {
    series: Array<{
      label: string;
      sessions: number;
      users: number;
      leads: number;
    }>;
    topSources: Array<{
      source: string;
      medium: string;
      sessions: number;
      users: number;
      conversions: number;
    }>;
    topLandingPages: Array<{
      path: string;
      sessions: number;
      users: number;
      conversions: number;
    }>;
    devices: Array<{
      category: string;
      sessions: number;
      sharePct: number;
    }>;
    tvSpotsCount: number;
  };
  hotline: {
    uniqueAnswered: number;
    uniqueMissed: number;
    uniqueTotal: number;
    rawAnswered: number;
    rawMissed: number;
    rawShortAnswered: number;
    answerRatePct: number;
    queues: Array<{
      queueId: string;
      queueName: string;
      uniqueAnswered: number;
      uniqueMissed: number;
      rawTotal: number;
    }>;
  };
  crm: {
    totalLeads: number;
    activeLeads: number;
    wonLeads: number;
    lostLeads: number;
    wonValue: number;
    activeValue: number;
    crPct: number;
    staleNewCount: number;
    excludedCount: number;
    bySource: {
      webForm: number;
      phone: number;
      email: number;
    };
    funnel: {
      all: number;
      inProgress: number;
      offer: number;
      won: number;
      lost: number;
    };
    agents: Array<{
      name: string;
      leads: number;
      won: number;
      value: number;
      crPct: number;
    }>;
  };
  alerts: ReportAlert[];
}

function toUtcDateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
}

function formatPlDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(
    d.getUTCMonth() + 1
  ).padStart(2, '0')}.${d.getUTCFullYear()}`;
}

function warsawLocalWallToUtc(wallUtcDate: Date): Date {
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
  const parts = formatter.formatToParts(wallUtcDate);
  const val = (name: string) =>
    parseInt(parts.find((p) => p.type === name)?.value || '0', 10);
  const hour = val('hour');
  const interpretedAsLocal = Date.UTC(
    val('year'),
    val('month') - 1,
    val('day'),
    hour === 24 ? 0 : hour,
    val('minute'),
    val('second'),
    wallUtcDate.getUTCMilliseconds()
  );
  const offsetMs = interpretedAsLocal - wallUtcDate.getTime();
  return new Date(wallUtcDate.getTime() - offsetMs);
}

function getIsoWeekInfo(utcMidnight: Date): { year: number; week: number } {
  const date = new Date(
    Date.UTC(
      utcMidnight.getUTCFullYear(),
      utcMidnight.getUTCMonth(),
      utcMidnight.getUTCDate()
    )
  );
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

function getIsoWeekMonday(isoYear: number, isoWeek: number): Date {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const dayNum = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4.getTime() - (dayNum - 1) * DAY_MS);
  return new Date(week1Monday.getTime() + (isoWeek - 1) * 7 * DAY_MS);
}

const PL_MONTHS = [
  'Styczeń',
  'Luty',
  'Marzec',
  'Kwiecień',
  'Maj',
  'Czerwiec',
  'Lipiec',
  'Sierpień',
  'Wrzesień',
  'Październik',
  'Listopad',
  'Grudzień',
];

const PL_WEEKDAYS = ['nd.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];

/**
 * Computes inclusive calendar window and its comparison baseline in Europe/Warsaw.
 * - DAILY defaults to yesterday (D-1), baseline = D-8 (same day of week).
 * - WEEKLY defaults to current ISO week (Mon-Sun), baseline = previous ISO week.
 * - MONTHLY defaults to current calendar month, baseline = previous calendar month.
 */
export function getCalendarWindow(
  granularity: ReportGranularity,
  periodKey?: string
): ReportWindow {
  const warsawToday = getWarsawNow();
  warsawToday.setUTCHours(0, 0, 0, 0);

  if (granularity === ReportGranularity.DAILY) {
    let startDate: Date;
    if (periodKey && /^\d{4}-\d{2}-\d{2}$/.test(periodKey)) {
      const [y, m, d] = periodKey.split('-').map(Number);
      startDate = new Date(Date.UTC(y, m - 1, d));
    } else {
      startDate = new Date(warsawToday.getTime() - DAY_MS);
    }
    const endDate = new Date(startDate);
    const baselineStartDate = new Date(startDate.getTime() - 7 * DAY_MS);
    const baselineEndDate = new Date(baselineStartDate);

    const key = toUtcDateStr(startDate);
    const baseKey = toUtcDateStr(baselineStartDate);
    const weekday = PL_WEEKDAYS[startDate.getUTCDay()];

    return {
      granularity,
      periodKey: key,
      label: `${formatPlDate(startDate)} (${weekday})`,
      startDate,
      endDate,
      startStr: key,
      endStr: key,
      baselinePeriodKey: baseKey,
      baselineLabel: `${formatPlDate(baselineStartDate)} (-7 dni)`,
      baselineStartDate,
      baselineEndDate,
      baselineStartStr: baseKey,
      baselineEndStr: baseKey,
    };
  }

  if (granularity === ReportGranularity.WEEKLY) {
    let isoYear: number;
    let isoWeek: number;
    if (periodKey && /^\d{4}-W\d{2}$/.test(periodKey)) {
      const [yStr, wStr] = periodKey.split('-W');
      isoYear = Number(yStr);
      isoWeek = Number(wStr);
    } else {
      const info = getIsoWeekInfo(warsawToday);
      isoYear = info.year;
      isoWeek = info.week;
    }

    const startDate = getIsoWeekMonday(isoYear, isoWeek);
    const endDate = new Date(startDate.getTime() + 6 * DAY_MS);
    const baselineStartDate = new Date(startDate.getTime() - 7 * DAY_MS);
    const baselineEndDate = new Date(endDate.getTime() - 7 * DAY_MS);
    const baseIso = getIsoWeekInfo(baselineStartDate);

    const key = `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
    const baseKey = `${baseIso.year}-W${String(baseIso.week).padStart(2, '0')}`;

    return {
      granularity,
      periodKey: key,
      label: `Tydzień ${String(isoWeek).padStart(2, '0')}/${isoYear} (${formatPlDate(
        startDate
      )} – ${formatPlDate(endDate)})`,
      startDate,
      endDate,
      startStr: toUtcDateStr(startDate),
      endStr: toUtcDateStr(endDate),
      baselinePeriodKey: baseKey,
      baselineLabel: `Tydzień ${String(baseIso.week).padStart(2, '0')}/${baseIso.year}`,
      baselineStartDate,
      baselineEndDate,
      baselineStartStr: toUtcDateStr(baselineStartDate),
      baselineEndStr: toUtcDateStr(baselineEndDate),
    };
  }

  // MONTHLY
  let year: number;
  let month: number; // 1..12
  if (periodKey && /^\d{4}-\d{2}$/.test(periodKey)) {
    const [y, m] = periodKey.split('-').map(Number);
    year = y;
    month = m;
  } else {
    year = warsawToday.getUTCFullYear();
    month = warsawToday.getUTCMonth() + 1;
  }

  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0));

  const baselineStartDate = new Date(Date.UTC(year, month - 2, 1));
  const baselineEndDate = new Date(Date.UTC(year, month - 1, 0));

  const key = `${year}-${String(month).padStart(2, '0')}`;
  const baseKey = `${baselineStartDate.getUTCFullYear()}-${String(
    baselineStartDate.getUTCMonth() + 1
  ).padStart(2, '0')}`;

  return {
    granularity,
    periodKey: key,
    label: `${PL_MONTHS[month - 1]} ${year}`,
    startDate,
    endDate,
    startStr: toUtcDateStr(startDate),
    endStr: toUtcDateStr(endDate),
    baselinePeriodKey: baseKey,
    baselineLabel: `${PL_MONTHS[baselineStartDate.getUTCMonth()]} ${baselineStartDate.getUTCFullYear()}`,
    baselineStartDate,
    baselineEndDate,
    baselineStartStr: toUtcDateStr(baselineStartDate),
    baselineEndStr: toUtcDateStr(baselineEndDate),
  };
}

function calcDeltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function mapQueueLabel(queueId: string | null): string {
  if (!queueId) return 'Bez kolejki';
  switch (queueId) {
    case '2':
      return 'Infolinia główna';
    case '3':
      return 'Oddzwonienie WWW';
    case '4':
      return 'Reklama TV';
    default:
      return /^\d+$/.test(queueId) ? `Kolejka #${queueId}` : queueId;
  }
}

async function aggregateWindowMetrics(startDate: Date, endDate: Date) {
  const endExclusiveWall = new Date(endDate.getTime() + DAY_MS);
  const realUtcStart = warsawLocalWallToUtc(startDate);
  const realUtcEndExclusive = warsawLocalWallToUtc(endExclusiveWall);

  const salesLeadWhere: Prisma.CrmLeadWhereInput = {
    status: { not: CrmLeadStatus.EXCLUDED },
    NOT: [
      { queueName: { contains: 'Nieodebrane', mode: 'insensitive' } },
      { subject: { contains: 'Nieodebrane', mode: 'insensitive' } },
    ],
  };

  const leadDateWhere: Prisma.CrmLeadWhereInput = {
    thuliumCreatedAt: { gte: realUtcStart, lt: realUtcEndExclusive },
  };

  const [
    dailySnapshots,
    hourlyRows,
    sourceRows,
    landingRows,
    deviceRows,
    tvSpotsCount,
    inboundCalls,
    salesLeads,
    allTicketsCount,
  ] = await Promise.all([
    prisma.dailySnapshot.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      orderBy: { date: 'asc' },
    }),
    prisma.trafficByHour.findMany({
      where: { capturedAt: { gte: startDate, lt: endExclusiveWall } },
      orderBy: { id: 'asc' },
    }),
    prisma.trafficBySource.findMany({
      where: { capturedAt: { gte: startDate, lt: endExclusiveWall } },
      select: {
        source: true,
        medium: true,
        sessions: true,
        users: true,
        conversions: true,
      },
    }),
    prisma.trafficByLandingPage.findMany({
      where: { capturedAt: { gte: startDate, lt: endExclusiveWall } },
      select: {
        landingPage: true,
        sessions: true,
        users: true,
        conversions: true,
      },
    }),
    prisma.trafficByDevice.findMany({
      where: { capturedAt: { gte: startDate, lt: endExclusiveWall } },
      select: {
        deviceCategory: true,
        sessions: true,
      },
    }),
    prisma.tvSchedule.count({
      where: { airDate: { gte: startDate, lt: endExclusiveWall } },
    }),
    prisma.crmCall.findMany({
      where: {
        timestamp: { gte: realUtcStart, lt: realUtcEndExclusive },
        direction: 'INBOUND',
      },
      select: {
        id: true,
        phone: true,
        direction: true,
        disposition: true,
        billsec: true,
        waitTime: true,
        agentName: true,
        queueName: true,
        timestamp: true,
      },
    }),
    prisma.crmLead.findMany({
      where: {
        ...leadDateWhere,
        ...salesLeadWhere,
      },
      select: {
        id: true,
        source: true,
        status: true,
        agentName: true,
        value: true,
        thuliumCreatedAt: true,
        statusHistory: { select: { toStatus: true } },
      },
    }),
    prisma.crmLead.count({ where: leadDateWhere }),
  ]);

  // GA4 Totals from DailySnapshot (fallback to hourly sum if snapshot empty)
  let sessions = dailySnapshots.reduce((s, r) => s + r.sessions, 0);
  let users = dailySnapshots.reduce((s, r) => s + r.users, 0);
  const newUsers = dailySnapshots.reduce((s, r) => s + r.newUsers, 0);
  const bounceRate =
    sessions > 0
      ? Math.round(
          (dailySnapshots.reduce((s, r) => s + r.sessions * r.bounceRate, 0) /
            sessions) *
            10000
        ) / 100
      : 0;

  // Deduplicate TrafficByHour by dateHour (keep highest id)
  const dedupHourly = new Map<string, (typeof hourlyRows)[0]>();
  for (const r of hourlyRows) {
    const existing = dedupHourly.get(r.dateHour);
    if (!existing || r.id > existing.id) {
      dedupHourly.set(r.dateHour, r);
    }
  }
  if (sessions === 0 && dedupHourly.size > 0) {
    for (const r of dedupHourly.values()) {
      sessions += r.sessions;
      users += r.users;
    }
  }

  // Inbound calls summary (deduplicated) + queue breakdown
  const callSummary = summarizeInboundCalls(inboundCalls);
  const queueBuckets = new Map<string, CallLike[]>();
  for (const c of inboundCalls) {
    const qKey = c.queueName || '';
    const arr = queueBuckets.get(qKey) ?? [];
    arr.push(c);
    queueBuckets.set(qKey, arr);
  }
  const queues = Array.from(queueBuckets.entries())
    .map(([queueId, qCalls]) => {
      const qs = summarizeInboundCalls(qCalls);
      return {
        queueId: queueId || 'none',
        queueName: mapQueueLabel(queueId || null),
        uniqueAnswered: qs.uniqueAnswered,
        uniqueMissed: qs.uniqueMissed,
        rawTotal: qCalls.length,
      };
    })
    .sort((a, b) => b.rawTotal - a.rawTotal);

  const answerRatePct =
    callSummary.uniqueTotal > 0
      ? Math.round((callSummary.uniqueAnswered / callSummary.uniqueTotal) * 1000) /
        10
      : 0;

  // CRM leads aggregates (strictly aggregate, zero PII)
  let activeLeads = 0;
  let wonLeads = 0;
  let lostLeads = 0;
  let wonValue = 0;
  let activeValue = 0;
  let webFormCount = 0;
  let phoneLeadCount = 0;
  let emailLeadCount = 0;
  let staleNewCount = 0;
  let reachedInProgress = 0;
  let reachedOffer = 0;

  const staleCutoff = Date.now() - DAY_MS;
  const agentMap = new Map<
    string,
    { leads: number; won: number; value: number }
  >();

  for (const lead of salesLeads) {
    if (lead.source === CrmLeadSource.WEB_FORM) webFormCount += 1;
    else if (lead.source === CrmLeadSource.PHONE) phoneLeadCount += 1;
    else if (lead.source === CrmLeadSource.EMAIL) emailLeadCount += 1;

    if (lead.status === CrmLeadStatus.WON) {
      wonLeads += 1;
      wonValue += lead.value;
    } else if (lead.status === CrmLeadStatus.LOST) {
      lostLeads += 1;
    } else {
      activeLeads += 1;
      activeValue += lead.value;
    }

    if (
      lead.status === CrmLeadStatus.NEW &&
      lead.thuliumCreatedAt.getTime() < staleCutoff
    ) {
      staleNewCount += 1;
    }

    const seen = new Set<CrmLeadStatus>([
      lead.status,
      ...lead.statusHistory.map((h) => h.toStatus),
    ]);
    const hadOffer =
      seen.has(CrmLeadStatus.OFFER) || seen.has(CrmLeadStatus.WON);
    const hadInProgress = hadOffer || seen.has(CrmLeadStatus.IN_PROGRESS);
    if (hadInProgress) reachedInProgress += 1;
    if (hadOffer) reachedOffer += 1;

    if (lead.agentName) {
      const a = agentMap.get(lead.agentName) ?? { leads: 0, won: 0, value: 0 };
      a.leads += 1;
      if (lead.status === CrmLeadStatus.WON) a.won += 1;
      a.value += lead.value;
      agentMap.set(lead.agentName, a);
    }
  }

  const totalSalesLeads = salesLeads.length;
  const excludedCount = Math.max(0, allTicketsCount - totalSalesLeads);
  const crmCrPct =
    totalSalesLeads > 0
      ? Math.round((wonLeads / totalSalesLeads) * 10000) / 100
      : 0;

  const agents = Array.from(agentMap.entries())
    .map(([name, a]) => ({
      name,
      leads: a.leads,
      won: a.won,
      value: Math.round(a.value),
      crPct: a.leads > 0 ? Math.round((a.won / a.leads) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.leads - a.leads || b.value - a.value);

  // Combined marketing leads: genuine web/email forms + deduplicated answered inbound calls
  const webFormLeads = webFormCount + emailLeadCount;
  const totalLeads = webFormLeads + callSummary.uniqueAnswered;
  const conversionRatePct =
    sessions > 0 ? Math.round((totalLeads / sessions) * 10000) / 100 : 0;

  return {
    sessions,
    users,
    newUsers,
    bounceRate,
    webFormLeads,
    totalLeads,
    conversionRatePct,
    dailySnapshots,
    dedupHourly,
    sourceRows,
    landingRows,
    deviceRows,
    tvSpotsCount,
    callSummary,
    answerRatePct,
    queues,
    salesLeads,
    crm: {
      totalLeads: totalSalesLeads,
      activeLeads,
      wonLeads,
      lostLeads,
      wonValue: Math.round(wonValue),
      activeValue: Math.round(activeValue),
      crPct: crmCrPct,
      staleNewCount,
      excludedCount,
      bySource: {
        webForm: webFormCount,
        phone: phoneLeadCount,
        email: emailLeadCount,
      },
      funnel: {
        all: totalSalesLeads,
        inProgress: reachedInProgress,
        offer: reachedOffer,
        won: wonLeads,
        lost: lostLeads,
      },
      agents,
    },
    inboundCalls,
  };
}

export async function buildReportPayload(
  granularity: ReportGranularity,
  periodKey?: string
): Promise<{ window: ReportWindow; payload: ReportPayload }> {
  const window = getCalendarWindow(granularity, periodKey);

  const [curr, prev] = await Promise.all([
    aggregateWindowMetrics(window.startDate, window.endDate),
    aggregateWindowMetrics(window.baselineStartDate, window.baselineEndDate),
  ]);

  // Build trend series
  const series: ReportPayload['traffic']['series'] = [];
  if (granularity === ReportGranularity.DAILY) {
    const byHourTraffic = new Map<number, { sessions: number; users: number }>();
    for (const r of curr.dedupHourly.values()) {
      const hour = parseInt(r.dateHour.slice(8, 10), 10);
      if (Number.isNaN(hour)) continue;
      const acc = byHourTraffic.get(hour) ?? { sessions: 0, users: 0 };
      acc.sessions += r.sessions;
      acc.users += r.users;
      byHourTraffic.set(hour, acc);
    }

    const callsByHour = new Map<number, CallLike[]>();
    for (const c of curr.inboundCalls) {
      const hourStr = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Warsaw',
        hour: '2-digit',
        hour12: false,
      }).format(c.timestamp);
      const h = parseInt(hourStr, 10) % 24;
      const arr = callsByHour.get(h) ?? [];
      arr.push(c);
      callsByHour.set(h, arr);
    }

    const formsByHour = new Map<number, number>();
    for (const l of curr.salesLeads) {
      if (l.source === CrmLeadSource.PHONE) continue;
      const hourStr = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Warsaw',
        hour: '2-digit',
        hour12: false,
      }).format(l.thuliumCreatedAt);
      const h = parseInt(hourStr, 10) % 24;
      formsByHour.set(h, (formsByHour.get(h) ?? 0) + 1);
    }

    for (let h = 0; h < 24; h++) {
      const t = byHourTraffic.get(h) ?? { sessions: 0, users: 0 };
      const hCalls = summarizeInboundCalls(callsByHour.get(h) ?? []);
      series.push({
        label: `${String(h).padStart(2, '0')}:00`,
        sessions: t.sessions,
        users: t.users,
        leads: (formsByHour.get(h) ?? 0) + hCalls.uniqueAnswered,
      });
    }
  } else {
    const snapByDate = new Map<string, (typeof curr.dailySnapshots)[0]>();
    for (const s of curr.dailySnapshots) {
      snapByDate.set(toUtcDateStr(s.date), s);
    }

    const callsByDate = new Map<string, CallLike[]>();
    for (const c of curr.inboundCalls) {
      const key = getWarsawDateString(c.timestamp);
      const arr = callsByDate.get(key) ?? [];
      arr.push(c);
      callsByDate.set(key, arr);
    }

    const formsByDate = new Map<string, number>();
    for (const l of curr.salesLeads) {
      if (l.source === CrmLeadSource.PHONE) continue;
      const key = getWarsawDateString(l.thuliumCreatedAt);
      formsByDate.set(key, (formsByDate.get(key) ?? 0) + 1);
    }

    for (
      let d = new Date(window.startDate);
      d.getTime() <= window.endDate.getTime();
      d = new Date(d.getTime() + DAY_MS)
    ) {
      const key = toUtcDateStr(d);
      const snap = snapByDate.get(key);
      const dCalls = summarizeInboundCalls(callsByDate.get(key) ?? []);
      series.push({
        label: `${String(d.getUTCDate()).padStart(2, '0')}.${String(
          d.getUTCMonth() + 1
        ).padStart(2, '0')}`,
        sessions: snap?.sessions ?? 0,
        users: snap?.users ?? 0,
        leads: (formsByDate.get(key) ?? 0) + dCalls.uniqueAnswered,
      });
    }
  }

  // Top Sources
  const srcMap = new Map<
    string,
    { source: string; medium: string; sessions: number; users: number; conversions: number }
  >();
  for (const r of curr.sourceRows) {
    const k = `${r.source}|||${r.medium}`;
    const acc = srcMap.get(k) ?? {
      source: r.source,
      medium: r.medium,
      sessions: 0,
      users: 0,
      conversions: 0,
    };
    acc.sessions += r.sessions;
    acc.users += r.users;
    acc.conversions += r.conversions;
    srcMap.set(k, acc);
  }
  const topSources = Array.from(srcMap.values())
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 6);

  // Top Landing Pages
  const lpMap = new Map<
    string,
    { path: string; sessions: number; users: number; conversions: number }
  >();
  for (const r of curr.landingRows) {
    const acc = lpMap.get(r.landingPage) ?? {
      path: r.landingPage,
      sessions: 0,
      users: 0,
      conversions: 0,
    };
    acc.sessions += r.sessions;
    acc.users += r.users;
    acc.conversions += r.conversions;
    lpMap.set(r.landingPage, acc);
  }
  const topLandingPages = Array.from(lpMap.values())
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 6);

  // Devices
  const devMap = new Map<string, number>();
  let totalDevSessions = 0;
  for (const r of curr.deviceRows) {
    devMap.set(r.deviceCategory, (devMap.get(r.deviceCategory) ?? 0) + r.sessions);
    totalDevSessions += r.sessions;
  }
  const devices = Array.from(devMap.entries())
    .map(([category, devSessions]) => ({
      category,
      sessions: devSessions,
      sharePct:
        totalDevSessions > 0
          ? Math.round((devSessions / totalDevSessions) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);

  // Automatic insights / anomaly flags
  const alerts: ReportAlert[] = [];
  if (curr.answerRatePct < 75 && curr.callSummary.uniqueMissed >= 3) {
    alerts.push({
      severity: 'warning',
      title: `Niska odbieralność infolinii (${curr.answerRatePct}%)`,
      detail: `${curr.callSummary.uniqueMissed} unikalnych klientów (${curr.callSummary.rawMissed} prób) nie dodzwoniło się lub rozłączyło na IVR.`,
    });
  }
  if (curr.crm.staleNewCount > 0) {
    alerts.push({
      severity: 'warning',
      title: `${curr.crm.staleNewCount} leadów zalega w statusie "Nowy" > 24h`,
      detail: 'Wymagana aktualizacja statusów w Thulium przez doradców, aby lejek odzwierciedlał realny stan rozmów.',
    });
  }
  const sessionsDelta = calcDeltaPct(curr.sessions, prev.sessions);
  if (sessionsDelta !== null && sessionsDelta >= 20) {
    alerts.push({
      severity: 'positive',
      title: `Wzrost ruchu o +${sessionsDelta}% vs ${window.baselineLabel}`,
      detail: `${curr.sessions.toLocaleString('pl-PL')} sesji wobec ${prev.sessions.toLocaleString('pl-PL')} w okresie bazowym.`,
    });
  } else if (sessionsDelta !== null && sessionsDelta <= -20) {
    alerts.push({
      severity: 'warning',
      title: `Spadek ruchu o ${sessionsDelta}% vs ${window.baselineLabel}`,
      detail: `${curr.sessions.toLocaleString('pl-PL')} sesji wobec ${prev.sessions.toLocaleString('pl-PL')} w okresie bazowym.`,
    });
  }
  if (curr.webFormLeads === 0 && curr.sessions >= 100) {
    alerts.push({
      severity: 'warning',
      title: 'Zero formularzy WWW przy aktywnym ruchu',
      detail: `Zarejestrowano ${curr.sessions.toLocaleString('pl-PL')} sesji, ale ani jednego leada formularzowego w Thulium.`,
    });
  }
  if (alerts.length === 0) {
    alerts.push({
      severity: 'info',
      title: 'Przebieg okresu w normie',
      detail: `Łącznie ${curr.totalLeads} zdeduplikowanych leadów (formularze + odebrane telefony) przy ${curr.sessions.toLocaleString('pl-PL')} sesjach.`,
    });
  }

  const payload: ReportPayload = {
    period: {
      granularity,
      periodKey: window.periodKey,
      label: window.label,
      startDate: window.startStr,
      endDate: window.endStr,
      baselineLabel: window.baselineLabel,
      baselineStartDate: window.baselineStartStr,
      baselineEndDate: window.baselineEndStr,
    },
    kpi: {
      sessions: {
        value: curr.sessions,
        previousValue: prev.sessions,
        deltaPct: calcDeltaPct(curr.sessions, prev.sessions),
      },
      users: {
        value: curr.users,
        previousValue: prev.users,
        deltaPct: calcDeltaPct(curr.users, prev.users),
      },
      newUsers: {
        value: curr.newUsers,
        previousValue: prev.newUsers,
        deltaPct: calcDeltaPct(curr.newUsers, prev.newUsers),
      },
      bounceRate: {
        value: curr.bounceRate,
        previousValue: prev.bounceRate,
        deltaPct: calcDeltaPct(curr.bounceRate, prev.bounceRate),
      },
      webFormLeads: {
        value: curr.webFormLeads,
        previousValue: prev.webFormLeads,
        deltaPct: calcDeltaPct(curr.webFormLeads, prev.webFormLeads),
      },
      phoneUniqueAnswered: {
        value: curr.callSummary.uniqueAnswered,
        previousValue: prev.callSummary.uniqueAnswered,
        deltaPct: calcDeltaPct(
          curr.callSummary.uniqueAnswered,
          prev.callSummary.uniqueAnswered
        ),
      },
      phoneUniqueMissed: {
        value: curr.callSummary.uniqueMissed,
        previousValue: prev.callSummary.uniqueMissed,
        deltaPct: calcDeltaPct(
          curr.callSummary.uniqueMissed,
          prev.callSummary.uniqueMissed
        ),
      },
      totalLeads: {
        value: curr.totalLeads,
        previousValue: prev.totalLeads,
        deltaPct: calcDeltaPct(curr.totalLeads, prev.totalLeads),
      },
      conversionRatePct: {
        value: curr.conversionRatePct,
        previousValue: prev.conversionRatePct,
        deltaPct: calcDeltaPct(curr.conversionRatePct, prev.conversionRatePct),
      },
    },
    traffic: {
      series,
      topSources,
      topLandingPages,
      devices,
      tvSpotsCount: curr.tvSpotsCount,
    },
    hotline: {
      ...curr.callSummary,
      answerRatePct: curr.answerRatePct,
      queues: curr.queues,
    },
    crm: curr.crm,
    alerts,
  };

  return { window, payload };
}

export async function generateAndSaveReport(
  granularity: ReportGranularity,
  periodKey?: string,
  isFinal = false
) {
  const { window, payload } = await buildReportPayload(granularity, periodKey);

  return prisma.reportSnapshot.upsert({
    where: {
      granularity_periodKey: {
        granularity,
        periodKey: window.periodKey,
      },
    },
    create: {
      granularity,
      periodKey: window.periodKey,
      startDate: window.startDate,
      endDate: window.endDate,
      isFinal,
      payload: JSON.parse(JSON.stringify(payload)),
      generatedAt: new Date(),
    },
    update: {
      startDate: window.startDate,
      endDate: window.endDate,
      isFinal,
      payload: JSON.parse(JSON.stringify(payload)),
      generatedAt: new Date(),
    },
  });
}

/**
 * Generates / refreshes the morning report set:
 * - DAILY: D-1 (preliminary, due to GA4 lag) + D-2 (final correction)
 * - WEEKLY: current ISO week (in progress) + previous ISO week (final)
 * - MONTHLY: current month (MTD) + previous month (final)
 */
export async function runScheduledReportGeneration(): Promise<number> {
  const warsawToday = getWarsawNow();
  warsawToday.setUTCHours(0, 0, 0, 0);

  const d1 = toUtcDateStr(new Date(warsawToday.getTime() - DAY_MS));
  const d2 = toUtcDateStr(new Date(warsawToday.getTime() - 2 * DAY_MS));

  const currentWeek = getCalendarWindow(ReportGranularity.WEEKLY);
  const currentMonth = getCalendarWindow(ReportGranularity.MONTHLY);

  const jobs: Array<Promise<unknown>> = [
    generateAndSaveReport(ReportGranularity.DAILY, d1, false),
    generateAndSaveReport(ReportGranularity.DAILY, d2, true),
    generateAndSaveReport(ReportGranularity.WEEKLY, currentWeek.periodKey, false),
    generateAndSaveReport(
      ReportGranularity.WEEKLY,
      currentWeek.baselinePeriodKey,
      true
    ),
    generateAndSaveReport(ReportGranularity.MONTHLY, currentMonth.periodKey, false),
    generateAndSaveReport(
      ReportGranularity.MONTHLY,
      currentMonth.baselinePeriodKey,
      true
    ),
  ];

  await Promise.all(jobs);
  return jobs.length;
}
