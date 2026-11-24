import type { ReportPayload } from './report-builder';
import { formatDurationCompact } from './call-center-report';
import {
  getAlertKey,
  normalizeReportVisibility,
  type ReportVisibilityConfig,
} from './report-visibility';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('pl-PL');
}

function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

function fmtPln(n: number): string {
  return `${Math.round(n).toLocaleString('pl-PL')} zł`;
}

function renderDelta(deltaPct: number | null, invertColor = false): string {
  if (deltaPct === null) {
    return '<span class="delta neutral">brak bazy</span>';
  }
  const isUp = deltaPct > 0;
  const isDown = deltaPct < 0;
  let cls = 'neutral';
  if (isUp) cls = invertColor ? 'bad' : 'good';
  if (isDown) cls = invertColor ? 'good' : 'bad';
  const sign = isUp ? '+' : '';
  const arrow = isUp ? '▲' : isDown ? '▼' : '•';
  return `<span class="delta ${cls}">${arrow} ${sign}${deltaPct.toFixed(1)}%</span>`;
}

function renderTrendSvg(series: ReportPayload['traffic']['series']): string {
  if (!series || series.length === 0) {
    return '<p class="empty">Brak danych szeregu czasowego dla wybranego okresu.</p>';
  }

  const width = 820;
  const height = 220;
  const padL = 42;
  const padR = 16;
  const padT = 18;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxSessions = Math.max(...series.map((s) => s.sessions), 1);
  const maxLeads = Math.max(...series.map((s) => s.leads), 1);
  const barGap = 4;
  const barW = Math.max(4, Math.floor(plotW / series.length) - barGap);

  const bars: string[] = [];
  const leadPoints: string[] = [];
  const xLabels: string[] = [];

  const labelStep = series.length > 16 ? Math.ceil(series.length / 8) : 1;

  series.forEach((pt, idx) => {
    const slotW = plotW / series.length;
    const cx = padL + idx * slotW + slotW / 2;
    const barH = Math.round((pt.sessions / maxSessions) * plotH);
    const x = cx - barW / 2;
    const y = padT + plotH - barH;
    bars.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${Math.max(
        barH,
        1
      )}" rx="3" fill="#2563eb" opacity="0.82"><title>${escapeHtml(
        pt.label
      )}: ${fmtNum(pt.sessions)} sesji, ${fmtNum(pt.leads)} leadów</title></rect>`
    );

    const ly = padT + plotH - Math.round((pt.leads / maxLeads) * plotH);
    leadPoints.push(`${cx.toFixed(1)},${ly.toFixed(1)}`);

    if (idx % labelStep === 0 || idx === series.length - 1) {
      xLabels.push(
        `<text x="${cx.toFixed(1)}" y="${
          height - 10
        }" text-anchor="middle" font-size="10" fill="#64748b">${escapeHtml(
          pt.label
        )}</text>`
      );
    }
  });

  const gridLines = [0, 0.5, 1]
    .map((ratio) => {
      const y = padT + plotH * (1 - ratio);
      const val = Math.round(maxSessions * ratio);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${
        width - padR
      }" y2="${y.toFixed(
        1
      )}" stroke="#e2e8f0" stroke-dasharray="3,3"/><text x="${
        padL - 6
      }" y="${(y + 3).toFixed(
        1
      )}" text-anchor="end" font-size="10" fill="#64748b">${fmtNum(val)}</text>`;
    })
    .join('');

  return `
  <svg viewBox="0 0 ${width} ${height}" class="chart-svg" role="img" aria-label="Trend sesji i leadów">
    ${gridLines}
    ${bars.join('')}
    ${
      leadPoints.length > 1
        ? `<polyline fill="none" stroke="#10b981" stroke-width="2.5" points="${leadPoints.join(
            ' '
          )}" />`
        : ''
    }
    ${leadPoints
      .map((pt) => {
        const [x, y] = pt.split(',');
        return `<circle cx="${x}" cy="${y}" r="3.2" fill="#10b981" stroke="#ffffff" stroke-width="1.2" />`;
      })
      .join('')}
    ${xLabels.join('')}
  </svg>`;
}

export function renderReportHtml(
  snapshot: {
    granularity: string;
    periodKey: string;
    isFinal: boolean;
    generatedAt: Date | string;
    payload: ReportPayload;
  },
  visibility?: ReportVisibilityConfig
): string {
  const { payload } = snapshot;
  const vis = normalizeReportVisibility(visibility);
  const generatedStr = new Date(snapshot.generatedAt).toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const granularityLabel =
    snapshot.granularity === 'DAILY'
      ? 'Raport dzienny'
      : snapshot.granularity === 'WEEKLY'
      ? 'Raport tygodniowy'
      : 'Raport miesięczny';

  const statusBadge = snapshot.isFinal
    ? '<span class="badge final">Finalny</span>'
    : '<span class="badge prelim">Wstępny (GA4 w trakcie domykania)</span>';

  const funnelBase = Math.max(payload.crm.funnel.all, 1);
  const currentNew =
    payload.crm.funnel.currentNew ??
    Math.max(0, payload.crm.funnel.all - payload.crm.funnel.inProgress - payload.crm.funnel.lost);
  const currentInProgress =
    payload.crm.funnel.currentInProgress ??
    Math.max(0, payload.crm.funnel.inProgress - payload.crm.funnel.offer);
  const currentOffer =
    payload.crm.funnel.currentOffer ??
    Math.max(0, payload.crm.funnel.offer - payload.crm.funnel.won);

  const funnelRows = [
    { label: 'Nowy (czeka na kontakt)', count: currentNew, cohort: null as number | null, color: '#64748b' },
    {
      label: 'W kontakcie',
      count: currentInProgress,
      cohort: payload.crm.funnel.inProgress > currentInProgress ? payload.crm.funnel.inProgress : null,
      color: '#2563eb',
    },
    {
      label: 'Oferta / Wniosek',
      count: currentOffer,
      cohort: payload.crm.funnel.offer > currentOffer ? payload.crm.funnel.offer : null,
      color: '#7c3aed',
    },
    { label: 'Wygrane', count: payload.crm.funnel.won, cohort: null, color: '#10b981' },
    { label: 'Przegrane', count: payload.crm.funnel.lost, cohort: null, color: '#ef4444' },
  ]
    .map((f) => {
      const pct = Math.round((f.count / funnelBase) * 100);
      const cohortHint =
        f.cohort !== null
          ? ` <span style="font-weight:400;color:#64748b">(łącznie przeszło: ${fmtNum(f.cohort)})</span>`
          : '';
      return `
      <div class="funnel-row">
        <div class="funnel-meta">
          <span>${escapeHtml(f.label)}${cohortHint}</span>
          <strong>${fmtNum(f.count)} (${pct}%)</strong>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(
          pct,
          f.count > 0 ? 3 : 0
        )}%;background:${f.color}"></div></div>
      </div>`;
    })
    .join('');

  const kpiCardsHtml: string[] = [];
  if (vis.kpis.sessions) {
    kpiCardsHtml.push(`
    <div class="kpi">
      <div class="kpi-label">Sesje (GA4)</div>
      <div class="kpi-val">${fmtNum(payload.kpi.sessions.value)}</div>
      <div class="kpi-sub"><span>Poprz.: ${fmtNum(
        payload.kpi.sessions.previousValue
      )}</span>${renderDelta(payload.kpi.sessions.deltaPct)}</div>
    </div>`);
  }
  if (vis.kpis.users) {
    kpiCardsHtml.push(`
    <div class="kpi">
      <div class="kpi-label">Użytkownicy (GA4)</div>
      <div class="kpi-val">${fmtNum(payload.kpi.users.value)}</div>
      <div class="kpi-sub"><span>Nowi: ${fmtNum(
        payload.kpi.newUsers.value
      )}</span>${renderDelta(payload.kpi.users.deltaPct)}</div>
    </div>`);
  }
  if (vis.kpis.totalLeads) {
    kpiCardsHtml.push(`
    <div class="kpi">
      <div class="kpi-label">Leady łącznie (WWW + Tel.)</div>
      <div class="kpi-val">${fmtNum(payload.kpi.totalLeads.value)}</div>
      <div class="kpi-sub"><span>CR: ${fmtPct(
        payload.kpi.conversionRatePct.value,
        2
      )}</span>${renderDelta(payload.kpi.totalLeads.deltaPct)}</div>
    </div>`);
  }
  if (vis.kpis.webFormLeads) {
    kpiCardsHtml.push(`
    <div class="kpi">
      <div class="kpi-label">Formularze / E-mail (Thulium)</div>
      <div class="kpi-val">${fmtNum(payload.kpi.webFormLeads.value)}</div>
      <div class="kpi-sub"><span>Poprz.: ${fmtNum(
        payload.kpi.webFormLeads.previousValue
      )}</span>${renderDelta(payload.kpi.webFormLeads.deltaPct)}</div>
    </div>`);
  }
  if (vis.kpis.phoneUniqueAnswered) {
    kpiCardsHtml.push(`
    <div class="kpi">
      <div class="kpi-label">Tel. odebrane (unikalni)</div>
      <div class="kpi-val">${fmtNum(payload.kpi.phoneUniqueAnswered.value)}</div>
      <div class="kpi-sub"><span>Nieodebrane unik.: ${fmtNum(
        payload.kpi.phoneUniqueMissed.value
      )}</span>${renderDelta(payload.kpi.phoneUniqueAnswered.deltaPct)}</div>
    </div>`);
  }

  const visibleAlerts = payload.alerts.filter(
    (a) => vis.alerts[getAlertKey(a)]
  );

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Motolia Analytics — ${escapeHtml(granularityLabel)} (${escapeHtml(
    payload.period.label
  )})</title>
<style>
  :root {
    --bg: #f8fafc;
    --card: #ffffff;
    --text: #0f172a;
    --muted: #64748b;
    --border: #e2e8f0;
    --blue: #2563eb;
    --green: #059669;
    --red: #dc2626;
    --amber: #d97706;
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
  .wrap { max-width: 1120px; margin: 0 auto; }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 16px;
    background: #0f172a;
    color: #f8fafc;
    padding: 24px 28px;
    border-radius: 14px;
    margin-bottom: 20px;
  }
  .brand { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #94a3b8; font-weight: 700; }
  .title { font-size: 24px; font-weight: 700; margin: 4px 0 6px; }
  .subtitle { font-size: 13px; color: #cbd5e1; }
  .header-right { text-align: right; font-size: 12px; color: #cbd5e1; }
  .badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .badge.final { background: rgba(16,185,129,0.2); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.4); }
  .badge.prelim { background: rgba(245,158,11,0.2); color: #fcd34d; border: 1px solid rgba(245,158,11,0.4); }

  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(195px, 1fr));
    gap: 14px;
    margin-bottom: 20px;
  }
  .kpi {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px 18px;
  }
  .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 600; }
  .kpi-val { font-size: 28px; font-weight: 700; margin: 6px 0 4px; }
  .kpi-sub { font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; align-items: center; gap: 6px; }
  .delta { font-size: 12px; font-weight: 600; }
  .delta.good { color: var(--green); }
  .delta.bad { color: var(--red); }
  .delta.neutral { color: var(--muted); }

  .alerts { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
  .alert {
    padding: 12px 16px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--card);
    font-size: 13px;
  }
  .alert.warning { background: #fffbeb; border-color: #fde68a; }
  .alert.positive { background: #ecfdf5; border-color: #a7f3d0; }
  .alert.info { background: #eff6ff; border-color: #bfdbfe; }
  .alert strong { display: block; margin-bottom: 2px; }

  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px 22px;
    margin-bottom: 18px;
  }
  .card-title {
    font-size: 15px;
    font-weight: 700;
    margin: 0 0 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .card-note { font-size: 12px; font-weight: 400; color: var(--muted); }
  .two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 18px; }
  .chart-svg { width: 100%; height: auto; display: block; }
  .legend { display: flex; gap: 16px; font-size: 12px; color: var(--muted); margin-top: 6px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: none; }

  .hotline-pills { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
  .hpill { background: #f1f5f9; border-radius: 8px; padding: 10px 12px; }
  .hpill .l { font-size: 11px; color: var(--muted); }
  .hpill .v { font-size: 20px; font-weight: 700; margin-top: 2px; }

  .funnel-row { margin-bottom: 10px; }
  .funnel-meta { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
  .bar-track { height: 8px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 999px; }

  .empty { font-size: 13px; color: var(--muted); margin: 8px 0; }
  .footer { text-align: center; font-size: 12px; color: var(--muted); margin-top: 16px; }
  @media print {
    body { background: #ffffff; padding: 0; }
    .card, .kpi { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header class="header">
    <div>
      <div class="brand">Motolia Analytics • Raport Wykonawczy</div>
      <h1 class="title">${escapeHtml(granularityLabel)}: ${escapeHtml(
        payload.period.label
      )}</h1>
      <div class="subtitle">Porównanie z okresem bazowym: ${escapeHtml(
        payload.period.baselineLabel
      )} (${escapeHtml(payload.period.baselineStartDate)} – ${escapeHtml(
        payload.period.baselineEndDate
      )})</div>
    </div>
    <div class="header-right">
      ${statusBadge}
      <div>Wygenerowano: ${escapeHtml(generatedStr)}</div>
      <div>Klucz okresu: ${escapeHtml(payload.period.periodKey)}</div>
    </div>
  </header>

  ${
    kpiCardsHtml.length > 0
      ? `<section class="kpi-grid">${kpiCardsHtml.join('')}</section>`
      : ''
  }

  ${
    visibleAlerts.length > 0
      ? `<section class="alerts">${visibleAlerts
          .map(
            (a) => `<div class="alert ${escapeHtml(
              a.severity
            )}"><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(
              a.detail
            )}</span></div>`
          )
          .join('')}</section>`
      : ''
  }

  <section class="card">
    <h2 class="card-title">
      <span>Przebieg ruchu i leadów</span>
      <span class="card-note">Emisje TV w okresie: ${fmtNum(
        payload.traffic.tvSpotsCount
      )}</span>
    </h2>
    ${renderTrendSvg(payload.traffic.series)}
    <div class="legend">
      <span><span class="dot" style="background:#2563eb"></span>Sesje</span>
      <span><span class="dot" style="background:#10b981"></span>Leady (WWW + unikalne odebrane tel.)</span>
    </div>
  </section>

  <div class="two-col">
    <section class="card">
      <h2 class="card-title"><span>TOP Kanały ruchu</span><span class="card-note">GA4</span></h2>
      ${
        payload.traffic.topSources.length === 0
          ? '<p class="empty">Brak danych kanałów.</p>'
          : `<table><thead><tr><th>Źródło / Medium</th><th class="num">Sesje</th><th class="num">Użytk.</th><th class="num">Konw.</th></tr></thead><tbody>${payload.traffic.topSources
              .map(
                (s) =>
                  `<tr><td>${escapeHtml(s.source)} / ${escapeHtml(
                    s.medium
                  )}</td><td class="num">${fmtNum(
                    s.sessions
                  )}</td><td class="num">${fmtNum(
                    s.users
                  )}</td><td class="num">${fmtNum(s.conversions)}</td></tr>`
              )
              .join('')}</tbody></table>`
      }
    </section>

    <section class="card">
      <h2 class="card-title"><span>TOP Strony docelowe</span><span class="card-note">GA4</span></h2>
      ${
        payload.traffic.topLandingPages.length === 0
          ? '<p class="empty">Brak danych stron docelowych.</p>'
          : `<table><thead><tr><th>Ścieżka</th><th class="num">Sesje</th><th class="num">Użytk.</th><th class="num">Konw.</th></tr></thead><tbody>${payload.traffic.topLandingPages
              .map(
                (p) =>
                  `<tr><td>${escapeHtml(p.path)}</td><td class="num">${fmtNum(
                    p.sessions
                  )}</td><td class="num">${fmtNum(
                    p.users
                  )}</td><td class="num">${fmtNum(p.conversions)}</td></tr>`
              )
              .join('')}</tbody></table>`
      }
    </section>
  </div>

  <div class="two-col">
    ${
      vis.sections.hotline !== false
        ? `<section class="card">
      <h2 class="card-title">
        <span>Infolinia (Thulium — unikalni klienci)</span>
        <span class="card-note">Odbieralność: ${fmtPct(
          payload.hotline.answerRatePct
        )}</span>
      </h2>
      <div class="hotline-pills">
        <div class="hpill"><div class="l">Odebrane (unikalni)</div><div class="v" style="color:#059669">${fmtNum(
          payload.hotline.uniqueAnswered
        )}</div><div class="l">${fmtNum(payload.hotline.rawAnswered)} rozmów ≥30s</div></div>
        <div class="hpill"><div class="l">Nieodebrane / IVR (unikalni)</div><div class="v" style="color:#d97706">${fmtNum(
          payload.hotline.uniqueMissed
        )}</div><div class="l">${fmtNum(payload.hotline.rawMissed)} prób</div></div>
        <div class="hpill"><div class="l">Oddzwonienia (unik.)</div><div class="v" style="color:#2563eb">${fmtNum(
          payload.hotline.outboundUniqueAnswered ?? 0
        )}</div><div class="l">${fmtNum(
          payload.hotline.outboundRawTotal ?? 0
        )} prób • ${fmtNum(
          payload.hotline.missedCalledBack ?? 0
        )} z nieodebranych</div></div>
        <div class="hpill"><div class="l">Krótkie &lt;30s</div><div class="v">${fmtNum(
          payload.hotline.rawShortAnswered
        )}</div><div class="l">Połączone &lt;30s</div></div>
      </div>
      ${
        payload.hotline.queues.length === 0
          ? '<p class="empty">Brak połączeń przychodzących w okresie.</p>'
          : `<table><thead><tr><th>Kolejka</th><th class="num">Odebrane (unik.)</th><th class="num">Nieodebrane (unik.)</th><th class="num">Próby</th></tr></thead><tbody>${payload.hotline.queues
              .map(
                (q) =>
                  `<tr><td>${escapeHtml(
                    q.queueName
                  )}</td><td class="num">${fmtNum(
                    q.uniqueAnswered
                  )}</td><td class="num">${fmtNum(
                    q.uniqueMissed
                  )}</td><td class="num">${fmtNum(q.rawTotal)}</td></tr>`
              )
              .join('')}</tbody></table>`
      }
    </section>`
        : ''
    }

    <section class="card">
      <h2 class="card-title">
        <span>Lejek CRM (Thulium)</span>
        <span class="card-note">Wszystkie: ${fmtNum(
          payload.crm.funnel.all
        )} • Wygrane: ${fmtPln(payload.crm.wonValue)}</span>
      </h2>
      ${funnelRows}
      <p class="card-note" style="margin-top:10px">
        W toku: ${fmtPln(payload.crm.activeValue)} • Odfiltrowane (SPAM/Połączone/Test): ${fmtNum(
    payload.crm.excludedCount
  )} • Zalegające &gt;24h w Nowy: ${fmtNum(payload.crm.staleNewCount)}
      </p>
      ${
        payload.crm.agents.length === 0
          ? ''
          : `<table style="margin-top:10px"><thead><tr><th>Doradca</th><th class="num">Leady</th><th class="num">Wygrane</th><th class="num">CR</th><th class="num">Wartość</th></tr></thead><tbody>${payload.crm.agents
              .map(
                (a) =>
                  `<tr><td>${escapeHtml(a.name)}</td><td class="num">${fmtNum(
                    a.leads
                  )}</td><td class="num">${fmtNum(
                    a.won
                  )}</td><td class="num">${fmtPct(
                    a.crPct
                  )}</td><td class="num">${fmtPln(a.value)}</td></tr>`
              )
              .join('')}</tbody></table>`
      }
    </section>
  </div>

  ${
    vis.sections.callCenter === true && payload.callCenter
      ? `<section class="card">
      <h2 class="card-title">
        <span>Call Center — Aktywność doradców</span>
        <span class="card-note">Dostępność netto zespołu: ${escapeHtml(
          formatDurationCompact(payload.callCenter.totals.availableSec)
        )} / ${escapeHtml(
          formatDurationCompact(payload.callCenter.totals.loginSec)
        )} (${payload.callCenter.totals.availabilityPct.toFixed(1)}%)</span>
      </h2>
      ${
        payload.callCenter.agents.length === 0
          ? '<p class="empty">Brak danych aktywności doradców w tym okresie.</p>'
          : `<table><thead><tr><th>Doradca</th><th class="num">Zalogowanie</th><th class="num">Przerwy</th><th class="num">Dostępność</th><th class="num">Przych. (od./nieod.)</th><th class="num">Wych. udane / prób</th><th class="num">Czas rozmów</th><th class="num">Tickety</th></tr></thead><tbody>${payload.callCenter.agents
              .map(
                (a) =>
                  `<tr><td>${escapeHtml(a.agentName)}</td><td class="num">${escapeHtml(
                    formatDurationCompact(a.loginSec)
                  )}</td><td class="num">${escapeHtml(
                    formatDurationCompact(a.pauseSec)
                  )}</td><td class="num"><strong>${escapeHtml(
                    formatDurationCompact(a.availableSec)
                  )}</strong></td><td class="num">${a.inboundAnswered} / ${
                    a.inboundNotAnswered
                  }</td><td class="num">${a.outboundSuccess} / ${
                    a.outboundTotal
                  }</td><td class="num">${escapeHtml(
                    formatDurationCompact(a.totalTalkSec)
                  )}</td><td class="num">${a.ticketsResponded} / ${
                    a.ticketsClosed
                  }</td></tr>`
              )
              .join('')}</tbody></table>`
      }
    </section>`
      : ''
  }

  <footer class="footer">
    Wygenerowano automatycznie przez Motolia Analytics (GA4 + Thulium CRM). Raport zagregowany bez danych osobowych klientów.
  </footer>
</div>
</body>
</html>`;
}
