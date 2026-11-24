'use client';

import { useState, useEffect, useCallback } from 'react';
import type {
  CallCenterPreset,
  CallCenterReportData,
} from '@/lib/call-center-report';
import '@/components/reports/report-view.css';
import './call-center.css';

function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(rem).padStart(2, '0')}s`;
  return `${rem}s`;
}

export default function CallCenterPage() {
  const [preset, setPreset] = useState<CallCenterPreset>('yesterday');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [report, setReport] = useState<CallCenterReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ preset });
      if (preset === 'custom' && customStart) {
        qs.set('startDate', customStart);
        if (customEnd) qs.set('endDate', customEnd);
      }
      const res = await fetch(`/api/call-center?${qs.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setReport(data.report ?? null);
      }
    } catch (err) {
      console.error('Failed to fetch call center report:', err);
    } finally {
      setLoading(false);
    }
  }, [preset, customStart, customEnd]);

  useEffect(() => {
    if (preset === 'custom' && !customStart) return;
    void loadData();
  }, [loadData, preset, customStart]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/call-center/sync', { method: 'POST' });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error('Failed to sync agent work report:', err);
    } finally {
      setSyncing(false);
    }
  };

  const htmlQuery = new URLSearchParams({
    preset,
    ...(preset === 'custom' && customStart ? { startDate: customStart } : {}),
    ...(preset === 'custom' && customEnd ? { endDate: customEnd } : {}),
  }).toString();

  const t = report?.totals;

  return (
    <div className="report-page">
      <div className="report-topbar">
        <div>
          <h1 className="report-title">Call Center — Praca doradców</h1>
          <p className="report-subtitle">
            {report
              ? `${report.period.label} (${report.period.startDate} – ${report.period.endDate})`
              : 'Czas zalogowania, przerwy, przychodzące oraz wychodzące (próg udanej: ≥30s)'}
          </p>
        </div>

        <div className="report-actions">
          <button
            type="button"
            className="report-btn"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? 'Synchronizacja...' : 'Odśwież z Thulium'}
          </button>
          <a
            href={`/api/reports/call-center/html?${htmlQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="report-btn"
          >
            Podgląd HTML
          </a>
          <a
            href={`/api/reports/call-center/html?${htmlQuery}&download=1`}
            className="report-btn primary"
          >
            Pobierz .html
          </a>
        </div>
      </div>

      <div className="report-controls">
        <div className="report-granularity">
          {(
            [
              { value: 'yesterday', label: 'Wczoraj' },
              { value: 'today', label: 'Dzisiaj' },
              { value: '7d', label: '7 dni' },
              { value: 'month', label: 'Ten miesiąc' },
              { value: '30d', label: '30 dni' },
              { value: 'custom', label: 'Zakres dat...' },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              className={`report-tab ${preset === item.value ? 'active' : ''}`}
              onClick={() => setPreset(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="cc-custom-dates">
            <input
              type="date"
              className="cc-date-input"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
            />
            <span className="report-card-note">do</span>
            <input
              type="date"
              className="cc-date-input"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="report-empty">Ładowanie raportu Call Center...</div>
      ) : !report || !t ? (
        <div className="report-empty">
          Brak danych Call Center dla wybranego okresu. Kliknij „Odśwież z Thulium”.
        </div>
      ) : (
        <>
          <div className="report-kpi-grid">
            <div className="report-kpi-card">
              <div className="report-kpi-label">Dostępność netto zespołu</div>
              <div className="report-kpi-value">{fmtDuration(t.availableSec)}</div>
              <div className="report-kpi-footer">
                <span>Zalogowanie: {fmtDuration(t.loginSec)}</span>
                <span>{t.availabilityPct.toFixed(1)}%</span>
              </div>
            </div>

            <div className="report-kpi-card">
              <div className="report-kpi-label">Przychodzące odebrane</div>
              <div className="report-kpi-value">{t.inboundAnswered}</div>
              <div className="report-kpi-footer">
                <span>
                  Nieodebrane kolejka: {t.inboundQueueMissedUnique} unik. ({t.inboundQueueMissedRaw} prób)
                </span>
              </div>
            </div>

            <div className="report-kpi-card">
              <div className="report-kpi-label">Wychodzące udane (≥30s)</div>
              <div className="report-kpi-value" style={{ color: 'var(--accent-green)' }}>
                {t.outboundSuccess}
              </div>
              <div className="report-kpi-footer">
                <span>
                  Krótkie: {t.outboundShort} • Nieudane: {t.outboundFailed}
                </span>
                <span>Łącznie: {t.outboundTotal}</span>
              </div>
            </div>

            <div className="report-kpi-card">
              <div className="report-kpi-label">Łączny czas rozmów</div>
              <div className="report-kpi-value">{fmtDuration(t.totalTalkSec)}</div>
              <div className="report-kpi-footer">
                <span>Śr. rozmowa: {fmtDuration(t.avgTalkSec)}</span>
                <span>
                  Tickety: {t.ticketsResponded} / {t.ticketsClosed}
                </span>
              </div>
            </div>
          </div>

          <div className="report-alerts">
            {report.alerts.map((a, idx) => (
              <div key={idx} className={`report-alert ${a.severity}`}>
                <strong>{a.title}</strong>
                <div>{a.detail}</div>
              </div>
            ))}
          </div>

          <div className="report-card">
            <div className="report-card-header">
              <h2 className="report-card-title">Aktywność per doradca</h2>
              <span className="report-card-note">
                Próg udanej rozmowy wychodzącej: ≥ 30 s • Źródło: Thulium
              </span>
            </div>

            {report.agents.length === 0 ? (
              <p className="report-card-note">
                Brak aktywności doradców w wybranym okresie. Kliknij „Odśwież z Thulium”, aby pobrać bieżące statystyki logowań.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Doradca</th>
                      <th className="num">Zalogowanie</th>
                      <th className="num">Przerwy</th>
                      <th className="num">Dostępność netto</th>
                      <th className="num">Przych. (od./nieod.)</th>
                      <th className="num">Wych. udane (≥30s)</th>
                      <th className="num">Wych. krótkie</th>
                      <th className="num">Wych. nieudane</th>
                      <th className="num">Czas rozmów</th>
                      <th className="num">Tickety (odp./zamk.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.agents.map((a) => (
                      <tr key={a.agentLogin}>
                        <td>
                          <strong>{a.agentName}</strong>
                          <div className="cc-agent-login">{a.agentLogin}</div>
                        </td>
                        <td className="num">{fmtDuration(a.loginSec)}</td>
                        <td className="num">{fmtDuration(a.pauseSec)}</td>
                        <td className="num">
                          <strong>{fmtDuration(a.availableSec)}</strong>{' '}
                          <span className="report-card-note">
                            ({a.availabilityPct.toFixed(0)}%)
                          </span>
                        </td>
                        <td className="num">
                          <span className="cc-good">{a.inboundAnswered}</span> /{' '}
                          <span className={a.inboundNotAnswered > 0 ? 'cc-warn' : ''}>
                            {a.inboundNotAnswered}
                          </span>
                        </td>
                        <td className="num cc-good">
                          {a.outboundSuccess}{' '}
                          <span className="report-card-note">
                            ({a.outboundUniqueClients} unik.)
                          </span>
                        </td>
                        <td className="num">{a.outboundShort}</td>
                        <td className={`num ${a.outboundFailed > 0 ? 'cc-bad' : ''}`}>
                          {a.outboundFailed}
                        </td>
                        <td className="num">{fmtDuration(a.totalTalkSec)}</td>
                        <td className="num">
                          {a.ticketsResponded} / {a.ticketsClosed}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
