'use client';

import { useState, useEffect, useCallback } from 'react';
import KPICard from '@/components/ui/KPICard';
import PeriodSelector from '@/components/ui/PeriodSelector';
import LineChart from '@/components/charts/LineChart';
import './overview.css';

interface KPI {
  label: string;
  value: number;
  previousValue: number;
  sparkline?: number[];
}

interface DailyPoint {
  date: string;
  sessions: number;
  users: number;
}

interface OverviewData {
  sessions: KPI;
  users: KPI;
  newUsers: KPI;
  bounceRate: KPI;
  formSubmissions: KPI;
  phoneClicks: KPI;
  totalConversions: KPI;
  conversionRate: KPI;
  daily: DailyPoint[];
}

function calcTrend(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

function formatNum(n: number): string {
  return n.toLocaleString('pl-PL');
}

function formatPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export default function OverviewPage() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(false);
    fetch(`/api/overview?period=${period}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setData(d))
      .catch(() => {
        setData(null);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const buildSparkline = (arr?: number[]) =>
    arr?.map((v) => ({ value: v })) ?? [];

  const kpis = data
    ? [
        {
          label: 'Sesje',
          value: formatNum(data.sessions.value),
          trend: calcTrend(data.sessions.value, data.sessions.previousValue),
          sparkline: buildSparkline(data.sessions.sparkline),
          color: '#3b82f6',
        },
        {
          label: 'Użytkownicy',
          value: formatNum(data.users.value),
          trend: calcTrend(data.users.value, data.users.previousValue),
          sparkline: buildSparkline(data.users.sparkline),
          color: '#8b5cf6',
        },
        {
          label: 'Nowi użytkownicy',
          value: formatNum(data.newUsers.value),
          trend: calcTrend(data.newUsers.value, data.newUsers.previousValue),
          sparkline: buildSparkline(data.newUsers.sparkline),
          color: '#06b6d4',
        },
        {
          label: 'Bounce Rate',
          value: formatPct(data.bounceRate.value),
          trend: calcTrend(data.bounceRate.value, data.bounceRate.previousValue) * -1,
          sparkline: buildSparkline(data.bounceRate.sparkline),
          color: '#fbbf24',
        },
        {
          label: 'Formularze',
          value: formatNum(data.formSubmissions.value),
          trend: calcTrend(
            data.formSubmissions.value,
            data.formSubmissions.previousValue
          ),
          sparkline: buildSparkline(data.formSubmissions.sparkline),
          color: '#10b981',
        },
        {
          label: 'Telefony',
          value: formatNum(data.phoneClicks.value),
          trend: calcTrend(
            data.phoneClicks.value,
            data.phoneClicks.previousValue
          ),
          sparkline: buildSparkline(data.phoneClicks.sparkline),
          color: '#f97316',
        },
        {
          label: 'Konwersje łącznie',
          value: formatNum(data.totalConversions.value),
          trend: calcTrend(
            data.totalConversions.value,
            data.totalConversions.previousValue
          ),
          sparkline: buildSparkline(data.totalConversions.sparkline),
          color: '#ef4444',
        },
        {
          label: 'CR%',
          value: formatPct(data.conversionRate.value),
          trend: calcTrend(
            data.conversionRate.value,
            data.conversionRate.previousValue
          ),
          sparkline: buildSparkline(data.conversionRate.sparkline),
          color: '#ec4899',
        },
      ]
    : [];

  const chartData =
    data?.daily?.map((d) => ({
      date: d.date,
      Sesje: d.sessions,
      Użytkownicy: d.users,
    })) ?? [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', color: 'var(--accent-blue)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="9" rx="1" />
                <rect x="14" y="3" width="7" height="5" rx="1" />
                <rect x="14" y="12" width="7" height="9" rx="1" />
                <rect x="3" y="16" width="7" height="5" rx="1" />
              </svg>
            </span>
            Overview
          </h1>
          <p className="page-subtitle">
            Podsumowanie kluczowych wskaźników
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {error && !loading && (
        <div className="fetch-error-banner">
          <span>Nie udało się pobrać danych. Sprawdź połączenie i spróbuj ponownie.</span>
          <button type="button" onClick={fetchData}>Spróbuj ponownie</button>
        </div>
      )}

      {/* KPI Grid */}
      <div className="overview-kpi-grid">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="kpi-card" style={{ opacity: 0.5 }}>
                <div className="kpi-card-header">
                  <div
                    className="skeleton"
                    style={{ width: 80, height: 14, borderRadius: 4 }}
                  />
                </div>
                <div
                  className="skeleton"
                  style={{ width: 100, height: 32, borderRadius: 6, marginTop: 8 }}
                />
              </div>
            ))
          : kpis.map((k) => (
              <KPICard
                key={k.label}
                label={k.label}
                value={k.value}
                trend={k.trend}
                sparklineData={k.sparkline}
                sparklineColor={k.color}
              />
            ))}
      </div>

      {/* Daily Sessions Chart */}
      {chartData.length > 0 && (
        <div className="overview-chart-section">
          <div className="overview-chart-card">
            <div className="overview-chart-header">
              <span className="section-title">Trend dzienny</span>
            </div>
            <LineChart
              data={chartData}
              xKey="date"
              lines={[
                { key: 'Sesje', color: '#3b82f6', label: 'Sesje' },
                {
                  key: 'Użytkownicy',
                  color: '#8b5cf6',
                  label: 'Użytkownicy',
                },
              ]}
              height={320}
              xTickFormatter={(v) => {
                const parts = v.split('-');
                return parts.length >= 3
                  ? `${parts[2]}.${parts[1]}`
                  : v;
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
