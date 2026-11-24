import { prisma } from './prisma';
import { getWarsawNow } from './utils';
import {
  classifyInboundCall,
  normalizePhone,
  summarizeInboundCalls,
} from './thulium-mapping';

const DAY_MS = 24 * 60 * 60 * 1000;
const SYSTEM_AGENTS = new Set(['automat', 'thulium', 'voicebot.motolia']);

export interface AgentCallCenterRow {
  agentLogin: string;
  agentName: string;
  loginSec: number;
  pauseSec: number;
  availableSec: number;
  availabilityPct: number;
  inboundAnswered: number;
  inboundNotAnswered: number;
  inboundAnswerRatePct: number;
  inboundTalkSec: number;
  outboundSuccess: number;
  outboundShort: number;
  outboundFailed: number;
  outboundTotal: number;
  outboundUniqueClients: number;
  outboundTalkSec: number;
  totalTalkSec: number;
  avgTalkSec: number;
  ticketsResponded: number;
  ticketsClosed: number;
}

export interface CallCenterAlert {
  severity: 'warning' | 'info' | 'positive';
  title: string;
  detail: string;
}

export interface CallCenterReportData {
  period: {
    label: string;
    startDate: string;
    endDate: string;
  };
  totals: {
    loginSec: number;
    pauseSec: number;
    availableSec: number;
    availabilityPct: number;
    inboundAnswered: number;
    inboundNotAnsweredAtAgent: number;
    inboundQueueMissedUnique: number;
    inboundQueueMissedRaw: number;
    outboundSuccess: number;
    outboundShort: number;
    outboundFailed: number;
    outboundTotal: number;
    totalTalkSec: number;
    avgTalkSec: number;
    ticketsResponded: number;
    ticketsClosed: number;
  };
  agents: AgentCallCenterRow[];
  alerts: CallCenterAlert[];
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

export type CallCenterPreset =
  | 'yesterday'
  | 'today'
  | '7d'
  | '30d'
  | 'month'
  | 'custom';

export function resolveCallCenterWindow(
  presetRaw: string | null | undefined,
  customStart?: string | null,
  customEnd?: string | null
): { startDate: Date; endDate: Date; label: string; preset: CallCenterPreset } {
  const today = getWarsawNow();
  today.setUTCHours(0, 0, 0, 0);

  const preset = (
    ['yesterday', 'today', '7d', '30d', 'month', 'custom'].includes(
      presetRaw || ''
    )
      ? presetRaw
      : 'yesterday'
  ) as CallCenterPreset;

  if (preset === 'today') {
    return {
      preset,
      startDate: new Date(today),
      endDate: new Date(today),
      label: `Dzisiaj (${formatPlDate(today)})`,
    };
  }

  if (preset === '7d') {
    const startDate = new Date(today.getTime() - 6 * DAY_MS);
    return {
      preset,
      startDate,
      endDate: new Date(today),
      label: `Ostatnie 7 dni (${formatPlDate(startDate)} – ${formatPlDate(today)})`,
    };
  }

  if (preset === '30d') {
    const startDate = new Date(today.getTime() - 29 * DAY_MS);
    return {
      preset,
      startDate,
      endDate: new Date(today),
      label: `Ostatnie 30 dni (${formatPlDate(startDate)} – ${formatPlDate(today)})`,
    };
  }

  if (preset === 'month') {
    const startDate = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
    );
    return {
      preset,
      startDate,
      endDate: new Date(today),
      label: `Bieżący miesiąc (${formatPlDate(startDate)} – ${formatPlDate(today)})`,
    };
  }

  if (
    preset === 'custom' &&
    customStart &&
    /^\d{4}-\d{2}-\d{2}$/.test(customStart)
  ) {
    const [sy, sm, sd] = customStart.split('-').map(Number);
    const startDate = new Date(Date.UTC(sy, sm - 1, sd));
    let endDate = new Date(startDate);
    if (customEnd && /^\d{4}-\d{2}-\d{2}$/.test(customEnd)) {
      const [ey, em, ed] = customEnd.split('-').map(Number);
      const parsedEnd = new Date(Date.UTC(ey, em - 1, ed));
      if (parsedEnd.getTime() >= startDate.getTime()) {
        endDate = parsedEnd;
      }
    }
    return {
      preset,
      startDate,
      endDate,
      label:
        startDate.getTime() === endDate.getTime()
          ? formatPlDate(startDate)
          : `${formatPlDate(startDate)} – ${formatPlDate(endDate)}`,
    };
  }

  const yesterday = new Date(today.getTime() - DAY_MS);
  return {
    preset: 'yesterday',
    startDate: yesterday,
    endDate: yesterday,
    label: `Wczoraj (${formatPlDate(yesterday)})`,
  };
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

export function formatDurationCompact(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hours > 0) {
    return `${hours}h ${String(mins).padStart(2, '0')}m`;
  }
  if (mins > 0) {
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  return `${secs}s`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function buildCallCenterReport(
  startDate: Date,
  endDate: Date,
  label?: string
): Promise<CallCenterReportData> {
  const endExclusiveWall = new Date(endDate.getTime() + DAY_MS);
  const realUtcStart = warsawLocalWallToUtc(startDate);
  const realUtcEndExclusive = warsawLocalWallToUtc(endExclusiveWall);

  const [workRows, calls] = await Promise.all([
    prisma.agentDailyWork.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
      },
    }),
    prisma.crmCall.findMany({
      where: {
        timestamp: { gte: realUtcStart, lt: realUtcEndExclusive },
      },
      select: {
        id: true,
        phone: true,
        direction: true,
        disposition: true,
        billsec: true,
        waitTime: true,
        agentName: true,
        timestamp: true,
      },
    }),
  ]);

  const inboundCalls = calls.filter(
    (c) => !c.direction || c.direction.toUpperCase() === 'INBOUND'
  );
  const outboundCalls = calls.filter(
    (c) => c.direction && c.direction.toUpperCase() === 'OUTBOUND'
  );

  const inboundSummary = summarizeInboundCalls(inboundCalls);

  interface AgentWorkAcc {
    agentLogin: string;
    agentName: string;
    hasWorkData: boolean;
    loginSec: number;
    pauseSec: number;
    workInboundAnswered: number;
    workInboundNotAnswered: number;
    workInboundTalkSec: number;
    workOutboundTalkSec: number;
    ticketsResponded: number;
    ticketsClosed: number;
    crmInboundAnswered: number;
    crmInboundTalkSec: number;
    outboundSuccess: number;
    outboundShort: number;
    outboundFailed: number;
    outboundTotal: number;
    outboundUniqueSet: Set<string>;
    crmOutboundTalkSec: number;
  }

  const map = new Map<string, AgentWorkAcc>();

  const ensureAgent = (login: string, name?: string): AgentWorkAcc => {
    const key = login.trim();
    const existing = map.get(key);
    if (existing) {
      if (name && existing.agentName === existing.agentLogin) {
        existing.agentName = name;
      }
      return existing;
    }
    const created: AgentWorkAcc = {
      agentLogin: key,
      agentName: name || key,
      hasWorkData: false,
      loginSec: 0,
      pauseSec: 0,
      workInboundAnswered: 0,
      workInboundNotAnswered: 0,
      workInboundTalkSec: 0,
      workOutboundTalkSec: 0,
      ticketsResponded: 0,
      ticketsClosed: 0,
      crmInboundAnswered: 0,
      crmInboundTalkSec: 0,
      outboundSuccess: 0,
      outboundShort: 0,
      outboundFailed: 0,
      outboundTotal: 0,
      outboundUniqueSet: new Set<string>(),
      crmOutboundTalkSec: 0,
    };
    map.set(key, created);
    return created;
  };

  for (const row of workRows) {
    if (!row.agentLogin || SYSTEM_AGENTS.has(row.agentLogin.toLowerCase())) {
      continue;
    }
    const acc = ensureAgent(row.agentLogin, row.agentName);
    acc.hasWorkData = true;
    acc.loginSec += row.loginSec;
    acc.pauseSec += row.pauseSec;
    acc.workInboundAnswered += row.inboundAnswered;
    acc.workInboundNotAnswered += row.inboundNotAnswered;
    acc.workInboundTalkSec += row.inboundTalkSec;
    acc.workOutboundTalkSec += row.outboundTalkSec;
    acc.ticketsResponded += row.ticketsResponded;
    acc.ticketsClosed += row.ticketsClosed;
  }

  for (const c of inboundCalls) {
    const login = (c.agentName || '').trim();
    if (!login || SYSTEM_AGENTS.has(login.toLowerCase())) continue;
    const acc = ensureAgent(login);
    const cls = classifyInboundCall(c);
    if (cls === 'ANSWERED' || cls === 'SHORT_ANSWERED') {
      acc.crmInboundAnswered += 1;
      acc.crmInboundTalkSec += Math.max(0, (c.billsec || 0) - (c.waitTime || 0));
    }
  }

  outboundCalls.forEach((c, idx) => {
    const login = (c.agentName || '').trim();
    if (!login || SYSTEM_AGENTS.has(login.toLowerCase())) return;
    const acc = ensureAgent(login);
    acc.outboundTotal += 1;
    if (c.disposition === 'ANSWERED') {
      const talk = Math.max(0, c.billsec || 0);
      acc.crmOutboundTalkSec += talk;
      if (talk >= 30) {
        acc.outboundSuccess += 1;
        const norm = normalizePhone(c.phone);
        acc.outboundUniqueSet.add(norm || `anon:${c.id || idx}`);
      } else {
        acc.outboundShort += 1;
      }
    } else {
      acc.outboundFailed += 1;
    }
  });

  const agents: AgentCallCenterRow[] = Array.from(map.values())
    .map((acc) => {
      const availableSec = Math.max(0, acc.loginSec - acc.pauseSec);
      const availabilityPct =
        acc.loginSec > 0
          ? Math.round((availableSec / acc.loginSec) * 1000) / 10
          : 0;

      const inboundAnswered = acc.hasWorkData
        ? acc.workInboundAnswered
        : acc.crmInboundAnswered;
      const inboundNotAnswered = acc.hasWorkData ? acc.workInboundNotAnswered : 0;
      const inboundTotalAtAgent = inboundAnswered + inboundNotAnswered;
      const inboundAnswerRatePct =
        inboundTotalAtAgent > 0
          ? Math.round((inboundAnswered / inboundTotalAtAgent) * 1000) / 10
          : 0;
      const inboundTalkSec = acc.hasWorkData
        ? acc.workInboundTalkSec
        : acc.crmInboundTalkSec;
      const outboundTalkSec =
        acc.crmOutboundTalkSec > 0
          ? acc.crmOutboundTalkSec
          : acc.workOutboundTalkSec;

      const totalTalkSec = inboundTalkSec + outboundTalkSec;
      const effectiveCalls = inboundAnswered + acc.outboundSuccess;
      const avgTalkSec =
        effectiveCalls > 0 ? Math.round(totalTalkSec / effectiveCalls) : 0;

      return {
        agentLogin: acc.agentLogin,
        agentName: acc.agentName,
        loginSec: acc.loginSec,
        pauseSec: acc.pauseSec,
        availableSec,
        availabilityPct,
        inboundAnswered,
        inboundNotAnswered,
        inboundAnswerRatePct,
        inboundTalkSec,
        outboundSuccess: acc.outboundSuccess,
        outboundShort: acc.outboundShort,
        outboundFailed: acc.outboundFailed,
        outboundTotal: acc.outboundTotal,
        outboundUniqueClients: acc.outboundUniqueSet.size,
        outboundTalkSec,
        totalTalkSec,
        avgTalkSec,
        ticketsResponded: acc.ticketsResponded,
        ticketsClosed: acc.ticketsClosed,
      };
    })
    .sort((a, b) => {
      const aActivity = a.outboundSuccess + a.inboundAnswered;
      const bActivity = b.outboundSuccess + b.inboundAnswered;
      if (bActivity !== aActivity) return bActivity - aActivity;
      return b.loginSec - a.loginSec;
    });

  const totalsLoginSec = agents.reduce((s, a) => s + a.loginSec, 0);
  const totalsPauseSec = agents.reduce((s, a) => s + a.pauseSec, 0);
  const totalsAvailableSec = Math.max(0, totalsLoginSec - totalsPauseSec);
  const totalsAvailabilityPct =
    totalsLoginSec > 0
      ? Math.round((totalsAvailableSec / totalsLoginSec) * 1000) / 10
      : 0;

  const totalsInboundAnswered = agents.reduce((s, a) => s + a.inboundAnswered, 0);
  const totalsInboundNotAnsweredAtAgent = agents.reduce(
    (s, a) => s + a.inboundNotAnswered,
    0
  );
  const totalsOutboundSuccess = agents.reduce((s, a) => s + a.outboundSuccess, 0);
  const totalsOutboundShort = agents.reduce((s, a) => s + a.outboundShort, 0);
  const totalsOutboundFailed = agents.reduce((s, a) => s + a.outboundFailed, 0);
  const totalsOutboundTotal = agents.reduce((s, a) => s + a.outboundTotal, 0);
  const totalsTalkSec = agents.reduce((s, a) => s + a.totalTalkSec, 0);
  const totalsEffective = totalsInboundAnswered + totalsOutboundSuccess;
  const totalsAvgTalkSec =
    totalsEffective > 0 ? Math.round(totalsTalkSec / totalsEffective) : 0;

  const alerts: CallCenterAlert[] = [];
  for (const a of agents) {
    if (a.loginSec >= 4 * 3600 && a.pauseSec / a.loginSec >= 0.9) {
      alerts.push({
        severity: 'warning',
        title: `${a.agentName}: zalogowany ${formatDurationCompact(
          a.loginSec
        )}, z czego ≥90% na przerwie`,
        detail: `Dostępność netto wyniosła tylko ${formatDurationCompact(
          a.availableSec
        )} (${a.availabilityPct.toFixed(1)}%).`,
      });
    }
    if (a.outboundTotal >= 5 && (a.outboundFailed + a.outboundShort) / a.outboundTotal > 0.6) {
      alerts.push({
        severity: 'info',
        title: `${a.agentName}: wysoki udział nieodebranych/krótkich wychodzących`,
        detail: `Na ${a.outboundTotal} prób wychodzących tylko ${a.outboundSuccess} rozmów trwało ≥30s (${a.outboundShort} krótkich, ${a.outboundFailed} nieudanych).`,
      });
    }
  }

  if (inboundSummary.uniqueMissed >= 3) {
    alerts.push({
      severity: 'warning',
      title: `${inboundSummary.uniqueMissed} unikalnych klientów nie dodzwoniło się na kolejkę`,
      detail: `Łącznie ${inboundSummary.rawMissed} nieodebranych/porzuconych prób przychodzących w analizowanym okresie.`,
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      severity: 'positive',
      title: 'Praca Call Center w normie',
      detail: `Łącznie ${totalsInboundAnswered} odebranych przychodzących i ${totalsOutboundSuccess} skutecznych wychodzących (≥30s).`,
    });
  }

  const startStr = toUtcDateStr(startDate);
  const endStr = toUtcDateStr(endDate);

  return {
    period: {
      label: label || (startStr === endStr ? startStr : `${startStr} – ${endStr}`),
      startDate: startStr,
      endDate: endStr,
    },
    totals: {
      loginSec: totalsLoginSec,
      pauseSec: totalsPauseSec,
      availableSec: totalsAvailableSec,
      availabilityPct: totalsAvailabilityPct,
      inboundAnswered: totalsInboundAnswered,
      inboundNotAnsweredAtAgent: totalsInboundNotAnsweredAtAgent,
      inboundQueueMissedUnique: inboundSummary.uniqueMissed,
      inboundQueueMissedRaw: inboundSummary.rawMissed,
      outboundSuccess: totalsOutboundSuccess,
      outboundShort: totalsOutboundShort,
      outboundFailed: totalsOutboundFailed,
      outboundTotal: totalsOutboundTotal,
      totalTalkSec: totalsTalkSec,
      avgTalkSec: totalsAvgTalkSec,
      ticketsResponded: agents.reduce((s, a) => s + a.ticketsResponded, 0),
      ticketsClosed: agents.reduce((s, a) => s + a.ticketsClosed, 0),
    },
    agents,
    alerts,
  };
}

export function renderCallCenterHtml(
  report: CallCenterReportData,
  generatedAt: Date | string = new Date()
): string {
  const generatedStr = new Date(generatedAt).toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const t = report.totals;

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Motolia Call Center — ${escapeHtml(report.period.label)}</title>
<style>
  :root {
    --bg: #f8fafc;
    --card: #ffffff;
    --text: #0f172a;
    --muted: #64748b;
    --border: #e2e8f0;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 28px 18px;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
    line-height: 1.45;
  }
  .wrap { max-width: 1180px; margin: 0 auto; }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 16px;
    background: #0f172a;
    color: #f8fafc;
    padding: 22px 26px;
    border-radius: 14px;
    margin-bottom: 20px;
  }
  .brand { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #94a3b8; font-weight: 700; }
  .title { font-size: 22px; font-weight: 700; margin: 4px 0; }
  .sub { font-size: 13px; color: #cbd5e1; }
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-bottom: 18px; }
  .kpi { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
  .kpi .l { font-size: 11px; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  .kpi .v { font-size: 24px; font-weight: 700; margin: 4px 0; }
  .kpi .s { font-size: 12px; color: var(--muted); }
  .alerts { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
  .alert { padding: 11px 14px; border-radius: 10px; border: 1px solid var(--border); background: var(--card); font-size: 13px; }
  .alert.warning { background: #fffbeb; border-color: #fde68a; }
  .alert.positive { background: #ecfdf5; border-color: #a7f3d0; }
  .alert.info { background: #eff6ff; border-color: #bfdbfe; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; overflow-x: auto; }
  .card h2 { margin: 0 0 12px; font-size: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 9px 10px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
  th { font-size: 11px; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: none; }
  .good { color: #059669; font-weight: 600; }
  .warn { color: #d97706; font-weight: 600; }
  .bad { color: #dc2626; font-weight: 600; }
  .footer { text-align: center; font-size: 12px; color: var(--muted); margin-top: 14px; }
  @media print { body { background: #fff; padding: 0; } }
</style>
</head>
<body>
<div class="wrap">
  <header class="header">
    <div>
      <div class="brand">Motolia • Raport Call Center</div>
      <h1 class="title">Aktywność doradców: ${escapeHtml(report.period.label)}</h1>
      <div class="sub">Zakres: ${escapeHtml(report.period.startDate)} – ${escapeHtml(
        report.period.endDate
      )}</div>
    </div>
    <div class="sub" style="text-align:right">
      <div>Wygenerowano: ${escapeHtml(generatedStr)}</div>
      <div>Źródło: Thulium API + CrmCall</div>
    </div>
  </header>

  <section class="kpi-grid">
    <div class="kpi">
      <div class="l">Dostępność netto zespołu</div>
      <div class="v">${escapeHtml(formatDurationCompact(t.availableSec))}</div>
      <div class="s">Zalogowanie: ${escapeHtml(
        formatDurationCompact(t.loginSec)
      )} (${t.availabilityPct.toFixed(1)}%)</div>
    </div>
    <div class="kpi">
      <div class="l">Przychodzące</div>
      <div class="v">${t.inboundAnswered}</div>
      <div class="s">Nieodebrane w kolejce: ${t.inboundQueueMissedUnique} unik. (${t.inboundQueueMissedRaw} prób)</div>
    </div>
    <div class="kpi">
      <div class="l">Wychodzące udane (≥30s)</div>
      <div class="v" style="color:#059669">${t.outboundSuccess}</div>
      <div class="s">Krótkie &lt;30s: ${t.outboundShort} • Nieudane: ${t.outboundFailed} (łącznie ${t.outboundTotal})</div>
    </div>
    <div class="kpi">
      <div class="l">Łączny czas rozmów</div>
      <div class="v">${escapeHtml(formatDurationCompact(t.totalTalkSec))}</div>
      <div class="s">Śr. rozmowa: ${escapeHtml(formatDurationCompact(t.avgTalkSec))} • Tickety: ${t.ticketsResponded}/${t.ticketsClosed}</div>
    </div>
  </section>

  <section class="alerts">
    ${report.alerts
      .map(
        (a) =>
          `<div class="alert ${escapeHtml(a.severity)}"><strong>${escapeHtml(
            a.title
          )}</strong><div>${escapeHtml(a.detail)}</div></div>`
      )
      .join('')}
  </section>

  <section class="card">
    <h2>Zestawienie per doradca</h2>
    ${
      report.agents.length === 0
        ? '<p class="sub" style="color:var(--muted)">Brak danych aktywności doradców w wybranym okresie.</p>'
        : `<table>
      <thead>
        <tr>
          <th>Doradca</th>
          <th class="num">Zalogowanie</th>
          <th class="num">Przerwy</th>
          <th class="num">Dostępność netto</th>
          <th class="num">Przych. (od./nieod.)</th>
          <th class="num">Wych. udane (≥30s)</th>
          <th class="num">Wych. krótkie</th>
          <th class="num">Wych. nieudane</th>
          <th class="num">Czas rozmów</th>
          <th class="num">Tickety (odp./zamk.)</th>
        </tr>
      </thead>
      <tbody>
        ${report.agents
          .map(
            (a) => `<tr>
          <td><strong>${escapeHtml(a.agentName)}</strong></td>
          <td class="num">${escapeHtml(formatDurationCompact(a.loginSec))}</td>
          <td class="num">${escapeHtml(formatDurationCompact(a.pauseSec))}</td>
          <td class="num"><strong>${escapeHtml(
            formatDurationCompact(a.availableSec)
          )}</strong> (${a.availabilityPct.toFixed(0)}%)</td>
          <td class="num"><span class="good">${a.inboundAnswered}</span> / <span class="${
              a.inboundNotAnswered > 0 ? 'warn' : ''
            }">${a.inboundNotAnswered}</span></td>
          <td class="num good">${a.outboundSuccess} (${a.outboundUniqueClients} unik.)</td>
          <td class="num">${a.outboundShort}</td>
          <td class="num ${a.outboundFailed > 0 ? 'bad' : ''}">${a.outboundFailed}</td>
          <td class="num">${escapeHtml(formatDurationCompact(a.totalTalkSec))}</td>
          <td class="num">${a.ticketsResponded} / ${a.ticketsClosed}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>`
    }
  </section>

  <footer class="footer">Motolia Analytics — Raport wewnętrzny Call Center (próg udanej rozmowy wychodzącej: ≥ 30s)</footer>
</div>
</body>
</html>`;
}
