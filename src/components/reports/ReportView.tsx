'use client';

import { useState } from 'react';
import type { ReportPayload } from '@/lib/report-builder';
import {
  DEFAULT_REPORT_VISIBILITY,
  getAlertKey,
  normalizeReportVisibility,
  type ReportAlertKey,
  type ReportKpiKey,
  type ReportVisibilityConfig,
} from '@/lib/report-visibility';
import './report-view.css';

export type Granularity = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface ArchiveEntry {
  periodKey: string;
  startDate: string;
  endDate: string;
  isFinal: boolean;
  generatedAt: string;
}

export interface SnapshotRecord {
  id: number;
  granularity: Granularity;
  periodKey: string;
  startDate: string;
  endDate: string;
  isFinal: boolean;
  generatedAt: string;
  payload: ReportPayload;
}

interface ReportViewProps {
  snapshot: SnapshotRecord | null;
  archive: ArchiveEntry[];
  granularity: Granularity;
  onGranularityChange: (g: Granularity) => void;
  onPeriodKeyChange: (key: string) => void;
  htmlHref: string;
  downloadHref: string;
  loading?: boolean;
  isPublic?: boolean;
  onGenerate?: () => void;
  generating?: boolean;
  shareUrl?: string | null;
  shareConfigured?: boolean;
  visibility?: ReportVisibilityConfig;
  onToggleKpi?: (key: ReportKpiKey, checked: boolean) => void;
  onToggleAlert?: (key: ReportAlertKey, checked: boolean) => void;
  savingVisibility?: boolean;
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('pl-PL');
}

function fmtPln(n: number): string {
  return `${Math.round(n).toLocaleString('pl-PL')} zł`;
}

function renderDelta(deltaPct: number | null) {
  if (deltaPct === null) {
    return <span className="report-delta neutral">brak bazy</span>;
  }
  const isUp = deltaPct > 0;
  const isDown = deltaPct < 0;
  const cls = isUp ? 'good' : isDown ? 'bad' : 'neutral';
  const sign = isUp ? '+' : '';
  const arrow = isUp ? '▲' : isDown ? '▼' : '•';
  return (
    <span className={`report-delta ${cls}`}>
      {arrow} {sign}
      {deltaPct.toFixed(1)}%
    </span>
  );
}

function TrendSvg({ series }: { series: ReportPayload['traffic']['series'] }) {
  if (!series || series.length === 0) {
    return <p className="report-card-note">Brak danych szeregu czasowego.</p>;
  }

  const width = 820;
  const height = 210;
  const padL = 42;
  const padR = 16;
  const padT = 16;
  const padB = 32;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const maxSessions = Math.max(...series.map((s) => s.sessions), 1);
  const maxLeads = Math.max(...series.map((s) => s.leads), 1);
  const barW = Math.max(4, Math.floor(plotW / series.length) - 4);
  const labelStep = series.length > 16 ? Math.ceil(series.length / 8) : 1;

  const leadPts = series.map((pt, idx) => {
    const slotW = plotW / series.length;
    const cx = padL + idx * slotW + slotW / 2;
    const ly = padT + plotH - Math.round((pt.leads / maxLeads) * plotH);
    return { cx, ly, label: pt.label, sessions: pt.sessions, leads: pt.leads };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[0, 0.5, 1].map((ratio) => {
        const y = padT + plotH * (1 - ratio);
        return (
          <g key={ratio}>
            <line
              x1={padL}
              y1={y}
              x2={width - padR}
              y2={y}
              stroke="#e2e8f0"
              strokeDasharray="3,3"
            />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#64748b">
              {fmtNum(maxSessions * ratio)}
            </text>
          </g>
        );
      })}

      {leadPts.map((pt, idx) => {
        const barH = Math.round((pt.sessions / maxSessions) * plotH);
        const x = pt.cx - barW / 2;
        const y = padT + plotH - barH;
        const showLabel = idx % labelStep === 0 || idx === leadPts.length - 1;
        return (
          <g key={`${pt.label}-${idx}`}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(barH, 1)}
              rx={3}
              fill="#2563eb"
              opacity={0.8}
            >
              <title>{`${pt.label}: ${fmtNum(pt.sessions)} sesji, ${fmtNum(pt.leads)} leadów`}</title>
            </rect>
            {showLabel && (
              <text
                x={pt.cx}
                y={height - 10}
                textAnchor="middle"
                fontSize="10"
                fill="#64748b"
              >
                {pt.label}
              </text>
            )}
          </g>
        );
      })}

      {leadPts.length > 1 && (
        <polyline
          fill="none"
          stroke="#10b981"
          strokeWidth="2.5"
          points={leadPts.map((p) => `${p.cx},${p.ly}`).join(' ')}
        />
      )}
      {leadPts.map((p, idx) => (
        <circle
          key={`pt-${idx}`}
          cx={p.cx}
          cy={p.ly}
          r={3.2}
          fill="#10b981"
          stroke="#ffffff"
          strokeWidth={1.2}
        />
      ))}
    </svg>
  );
}

export default function ReportView({
  snapshot,
  archive,
  granularity,
  onGranularityChange,
  onPeriodKeyChange,
  htmlHref,
  downloadHref,
  loading = false,
  isPublic = false,
  onGenerate,
  generating = false,
  shareUrl,
  shareConfigured,
  visibility = DEFAULT_REPORT_VISIBILITY,
  onToggleKpi,
  onToggleAlert,
  savingVisibility = false,
}: ReportViewProps) {
  const [copied, setCopied] = useState(false);
  const vis = normalizeReportVisibility(visibility);

  const handleCopyShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback not needed; link is displayed if copy fails
    }
  };

  const payload = snapshot?.payload;
  const funnelBase = Math.max(payload?.crm.funnel.all ?? 1, 1);

  return (
    <div className="report-page">
      <div className="report-topbar">
        <div>
          <h1 className="report-title">
            {isPublic ? 'Motolia Analytics — Raport Wyników' : 'Raporty okresowe'}
          </h1>
          <p className="report-subtitle">
            {payload
              ? `${payload.period.label} • Baza porównania: ${payload.period.baselineLabel}`
              : 'Zestawienie dzienne, tygodniowe i miesięczne (GA4 + Thulium CRM)'}
          </p>
        </div>

        <div className="report-actions">
          {!isPublic && onGenerate && (
            <button
              type="button"
              className="report-btn"
              onClick={onGenerate}
              disabled={generating}
            >
              {generating ? 'Generowanie...' : 'Odśwież raporty'}
            </button>
          )}
          {!isPublic && shareConfigured && shareUrl && (
            <button
              type="button"
              className="report-btn"
              onClick={handleCopyShare}
              title={shareUrl}
            >
              {copied ? 'Skopiowano link ✓' : 'Kopiuj link dla oglądających'}
            </button>
          )}
          {snapshot && (
            <>
              <a
                href={htmlHref}
                target="_blank"
                rel="noopener noreferrer"
                className="report-btn"
              >
                Podgląd HTML
              </a>
              <a href={downloadHref} className="report-btn primary">
                Pobierz .html
              </a>
            </>
          )}
        </div>
      </div>

      <div className="report-controls">
        <div className="report-granularity">
          {(
            [
              { value: 'DAILY', label: 'Dzień' },
              { value: 'WEEKLY', label: 'Tydzień' },
              { value: 'MONTHLY', label: 'Miesiąc' },
            ] as const
          ).map((g) => (
            <button
              key={g.value}
              type="button"
              className={`report-tab ${granularity === g.value ? 'active' : ''}`}
              onClick={() => onGranularityChange(g.value)}
            >
              {g.label}
            </button>
          ))}
        </div>

        <div className="report-archive-wrap">
          {archive.length > 0 && (
            <select
              className="report-select"
              value={snapshot?.periodKey || archive[0].periodKey}
              onChange={(e) => onPeriodKeyChange(e.target.value)}
            >
              {archive.map((item) => (
                <option key={item.periodKey} value={item.periodKey}>
                  {item.periodKey} {item.isFinal ? '(finalny)' : '(wstępny)'}
                </option>
              ))}
            </select>
          )}
          {snapshot && (
            <span
              className={`report-status-pill ${snapshot.isFinal ? 'final' : 'prelim'}`}
            >
              {snapshot.isFinal ? 'Finalny' : 'Wstępny'}
            </span>
          )}
        </div>
      </div>

      {!isPublic && shareConfigured === false && (
        <div className="report-alert info" style={{ marginBottom: 16 }}>
          <strong>Link publiczny nieaktywny</strong> — ustaw zmienną środowiskową{' '}
          <code>REPORT_SHARE_TOKEN</code> (min. 16 znaków) w Coolify, aby aktywować dostęp read-only pod <code>/share/&lt;token&gt;</code>.
        </div>
      )}

      {loading ? (
        <div className="report-empty">Ładowanie raportu...</div>
      ) : !payload ? (
        <div className="report-empty">
          <p style={{ margin: '0 0 12px', fontWeight: 600 }}>
            Brak wygenerowanego raportu dla wybranej granularności.
          </p>
          {!isPublic && onGenerate && (
            <button
              type="button"
              className="report-btn primary"
              onClick={onGenerate}
              disabled={generating}
            >
              {generating ? 'Generowanie...' : 'Wygeneruj raporty teraz'}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="report-kpi-grid">
            {(
              [
                {
                  key: 'sessions' as ReportKpiKey,
                  label: 'Sesje (GA4)',
                  value: fmtNum(payload.kpi.sessions.value),
                  sub: `Poprz.: ${fmtNum(payload.kpi.sessions.previousValue)}`,
                  deltaPct: payload.kpi.sessions.deltaPct,
                },
                {
                  key: 'users' as ReportKpiKey,
                  label: 'Użytkownicy (GA4)',
                  value: fmtNum(payload.kpi.users.value),
                  sub: `Nowi: ${fmtNum(payload.kpi.newUsers.value)}`,
                  deltaPct: payload.kpi.users.deltaPct,
                },
                {
                  key: 'totalLeads' as ReportKpiKey,
                  label: 'Leady łącznie (WWW + Tel.)',
                  value: fmtNum(payload.kpi.totalLeads.value),
                  sub: `CR: ${payload.kpi.conversionRatePct.value.toFixed(2)}%`,
                  deltaPct: payload.kpi.totalLeads.deltaPct,
                },
                {
                  key: 'webFormLeads' as ReportKpiKey,
                  label: 'Formularze / E-mail',
                  value: fmtNum(payload.kpi.webFormLeads.value),
                  sub: `Poprz.: ${fmtNum(payload.kpi.webFormLeads.previousValue)}`,
                  deltaPct: payload.kpi.webFormLeads.deltaPct,
                },
                {
                  key: 'phoneUniqueAnswered' as ReportKpiKey,
                  label: 'Tel. odebrane (unikalni)',
                  value: fmtNum(payload.kpi.phoneUniqueAnswered.value),
                  sub: `Nieodebrane: ${fmtNum(payload.kpi.phoneUniqueMissed.value)}`,
                  deltaPct: payload.kpi.phoneUniqueAnswered.deltaPct,
                },
              ]
            )
              .filter((item) => !isPublic || vis.kpis[item.key])
              .map((item) => {
                const checked = vis.kpis[item.key];
                return (
                  <div
                    key={item.key}
                    className={`report-kpi-card ${!checked && !isPublic ? 'is-excluded' : ''}`}
                  >
                    <div className="report-kpi-head">
                      <div className="report-kpi-label">{item.label}</div>
                      {!isPublic && onToggleKpi && (
                        <label
                          className="report-vis-toggle"
                          title="Zaznacz, aby pokazywać w podglądzie HTML i widoku publicznym"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => onToggleKpi(item.key, e.target.checked)}
                          />
                          <span>{checked ? 'HTML' : 'Ukryte'}</span>
                        </label>
                      )}
                    </div>
                    <div className="report-kpi-value">{item.value}</div>
                    <div className="report-kpi-footer">
                      <span>{item.sub}</span>
                      {renderDelta(item.deltaPct)}
                    </div>
                  </div>
                );
              })}
          </div>

          <div className="report-alerts">
            {payload.alerts
              .filter((a) => !isPublic || vis.alerts[getAlertKey(a)])
              .map((a, idx) => {
                const alertKey = getAlertKey(a);
                const checked = vis.alerts[alertKey];
                return (
                  <div
                    key={idx}
                    className={`report-alert ${a.severity} ${!checked && !isPublic ? 'is-excluded' : ''}`}
                  >
                    <div className="report-alert-row">
                      <div>
                        <strong>{a.title}</strong>
                        <div>{a.detail}</div>
                      </div>
                      {!isPublic && onToggleAlert && (
                        <label
                          className="report-vis-toggle"
                          title="Zaznacz, aby pokazywać ten alert w podglądzie HTML i widoku publicznym"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => onToggleAlert(alertKey, e.target.checked)}
                          />
                          <span>
                            {checked ? 'Pokaż w HTML' : 'Ukryte w HTML'}
                            {savingVisibility ? '…' : ''}
                          </span>
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>

          <div className="report-card">
            <div className="report-card-header">
              <h2 className="report-card-title">Przebieg ruchu i leadów</h2>
              <span className="report-card-note">
                Emisje TV w okresie: {fmtNum(payload.traffic.tvSpotsCount)}
              </span>
            </div>
            <TrendSvg series={payload.traffic.series} />
          </div>

          <div className="report-two-col">
            <div className="report-card">
              <div className="report-card-header">
                <h2 className="report-card-title">TOP Kanały ruchu</h2>
                <span className="report-card-note">GA4</span>
              </div>
              {payload.traffic.topSources.length === 0 ? (
                <p className="report-card-note">Brak danych kanałów.</p>
              ) : (
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Źródło / Medium</th>
                      <th className="num">Sesje</th>
                      <th className="num">Użytk.</th>
                      <th className="num">Konw.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.traffic.topSources.map((s, idx) => (
                      <tr key={idx}>
                        <td>
                          {s.source} / {s.medium}
                        </td>
                        <td className="num">{fmtNum(s.sessions)}</td>
                        <td className="num">{fmtNum(s.users)}</td>
                        <td className="num">{fmtNum(s.conversions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="report-card">
              <div className="report-card-header">
                <h2 className="report-card-title">TOP Strony docelowe</h2>
                <span className="report-card-note">GA4</span>
              </div>
              {payload.traffic.topLandingPages.length === 0 ? (
                <p className="report-card-note">Brak danych stron docelowych.</p>
              ) : (
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Ścieżka</th>
                      <th className="num">Sesje</th>
                      <th className="num">Użytk.</th>
                      <th className="num">Konw.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.traffic.topLandingPages.map((p, idx) => (
                      <tr key={idx}>
                        <td>{p.path}</td>
                        <td className="num">{fmtNum(p.sessions)}</td>
                        <td className="num">{fmtNum(p.users)}</td>
                        <td className="num">{fmtNum(p.conversions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="report-two-col">
            <div className="report-card">
              <div className="report-card-header">
                <h2 className="report-card-title">Infolinia (unikalni klienci)</h2>
                <span className="report-card-note">
                  Odbieralność: {payload.hotline.answerRatePct.toFixed(1)}%
                </span>
              </div>

              <div className="report-hotline-grid">
                <div className="report-hotline-box">
                  <div className="label">Odebrane (unik.)</div>
                  <div className="val" style={{ color: 'var(--accent-green)' }}>
                    {fmtNum(payload.hotline.uniqueAnswered)}
                  </div>
                  <div className="label">{fmtNum(payload.hotline.rawAnswered)} rozmów ≥30s</div>
                </div>
                <div className="report-hotline-box">
                  <div className="label">Nieodebrane (unik.)</div>
                  <div className="val" style={{ color: 'var(--accent-yellow)' }}>
                    {fmtNum(payload.hotline.uniqueMissed)}
                  </div>
                  <div className="label">{fmtNum(payload.hotline.rawMissed)} prób</div>
                </div>
                <div className="report-hotline-box">
                  <div className="label">Krótkie &lt;30s</div>
                  <div className="val">{fmtNum(payload.hotline.rawShortAnswered)}</div>
                  <div className="label">Połączone &lt;30s</div>
                </div>
              </div>

              {payload.hotline.queues.length > 0 && (
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Kolejka</th>
                      <th className="num">Odebrane (unik.)</th>
                      <th className="num">Nieodebrane (unik.)</th>
                      <th className="num">Próby</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.hotline.queues.map((q) => (
                      <tr key={q.queueId}>
                        <td>{q.queueName}</td>
                        <td className="num">{fmtNum(q.uniqueAnswered)}</td>
                        <td className="num">{fmtNum(q.uniqueMissed)}</td>
                        <td className="num">{fmtNum(q.rawTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="report-card">
              <div className="report-card-header">
                <h2 className="report-card-title">Lejek CRM (Thulium)</h2>
                <span className="report-card-note">
                  Wygrane: {fmtPln(payload.crm.wonValue)}
                </span>
              </div>

              {[
                { label: 'Wszystkie leady sprzedażowe', count: payload.crm.funnel.all, color: '#475569' },
                { label: 'W kontakcie', count: payload.crm.funnel.inProgress, color: '#2563eb' },
                { label: 'Oferta / Wniosek', count: payload.crm.funnel.offer, color: '#7c3aed' },
                { label: 'Wygrane', count: payload.crm.funnel.won, color: '#10b981' },
                { label: 'Przegrane', count: payload.crm.funnel.lost, color: '#ef4444' },
              ].map((row) => {
                const pct = Math.round((row.count / funnelBase) * 100);
                return (
                  <div key={row.label} className="report-funnel-row">
                    <div className="report-funnel-meta">
                      <span>{row.label}</span>
                      <strong>
                        {fmtNum(row.count)} ({pct}%)
                      </strong>
                    </div>
                    <div className="report-bar-track">
                      <div
                        className="report-bar-fill"
                        style={{
                          width: `${Math.max(pct, row.count > 0 ? 3 : 0)}%`,
                          background: row.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}

              <p className="report-card-note" style={{ marginTop: 10 }}>
                W toku: {fmtPln(payload.crm.activeValue)} • Odfiltrowane:{' '}
                {fmtNum(payload.crm.excludedCount)} • Zalegające &gt;24h w Nowy:{' '}
                {fmtNum(payload.crm.staleNewCount)}
              </p>

              {payload.crm.agents.length > 0 && (
                <table className="report-table" style={{ marginTop: 10 }}>
                  <thead>
                    <tr>
                      <th>Doradca</th>
                      <th className="num">Leady</th>
                      <th className="num">Wygrane</th>
                      <th className="num">CR</th>
                      <th className="num">Wartość</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.crm.agents.map((a) => (
                      <tr key={a.name}>
                        <td>{a.name}</td>
                        <td className="num">{fmtNum(a.leads)}</td>
                        <td className="num">{fmtNum(a.won)}</td>
                        <td className="num">{a.crPct.toFixed(1)}%</td>
                        <td className="num">{fmtPln(a.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
