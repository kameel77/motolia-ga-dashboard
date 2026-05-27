'use client';

import { useState, useEffect } from 'react';
import PeriodSelector from '@/components/ui/PeriodSelector';
import KPICard from '@/components/ui/KPICard';
import LineChart from '@/components/charts/LineChart';
import DataTable from '@/components/ui/DataTable';
import './conversions.css';

interface ConversionKPI {
  value: number;
  previousValue: number;
}

interface DailyConv {
  date: string;
  formSubmissions: number;
  phoneClicks: number;
  total: number;
}

interface EventRow {
  eventName: string;
  count: number;
  topSource: string;
}

interface FunnelStep {
  label: string;
  value: number;
}

interface ConversionsData {
  formSubmissions: ConversionKPI;
  phoneClicks: ConversionKPI;
  totalConversions: ConversionKPI;
  conversionRate: ConversionKPI;
  daily: DailyConv[];
  events: EventRow[];
  funnel: FunnelStep[];
}

function calcTrend(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

export default function ConversionsPage() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState<ConversionsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/conversions?period=${period}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [period]);

  const funnel = data?.funnel ?? [
    { label: 'Sesje', value: 0 },
    { label: 'Zaangażowani', value: 0 },
    { label: 'Konwersje', value: 0 },
  ];

  const funnelColors = ['#3b82f6', '#8b5cf6', '#10b981'];
  const funnelWidths = ['100%', '70%', '40%'];

  const chartData =
    data?.daily?.map((d) => ({
      date: d.date,
      Formularze: d.formSubmissions,
      Telefony: d.phoneClicks,
      Łącznie: d.total,
    })) ?? [];

  const eventColumns = [
    { key: 'eventName' as const, label: 'Zdarzenie' },
    {
      key: 'count' as const,
      label: 'Liczba',
      align: 'right' as const,
      format: (v: unknown) => Number(v).toLocaleString('pl-PL'),
    },
    { key: 'topSource' as const, label: 'Główne źródło' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', color: 'var(--accent-red)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            </span>
            Konwersje
          </h1>
          <p className="page-subtitle">Analiza konwersji i celów</p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* KPI Cards */}
      <div className="conv-kpi-grid">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
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
        ) : data ? (
          <>
            <KPICard
              label="Formularze"
              value={data.formSubmissions.value.toLocaleString('pl-PL')}
              trend={calcTrend(
                data.formSubmissions.value,
                data.formSubmissions.previousValue
              )}
              sparklineColor="#10b981"
            />
            <KPICard
              label="Telefony"
              value={data.phoneClicks.value.toLocaleString('pl-PL')}
              trend={calcTrend(
                data.phoneClicks.value,
                data.phoneClicks.previousValue
              )}
              sparklineColor="#f97316"
            />
            <KPICard
              label="Konwersje łącznie"
              value={data.totalConversions.value.toLocaleString('pl-PL')}
              trend={calcTrend(
                data.totalConversions.value,
                data.totalConversions.previousValue
              )}
              sparklineColor="#3b82f6"
            />
            <KPICard
              label="CR%"
              value={`${data.conversionRate.value.toFixed(2)}%`}
              trend={calcTrend(
                data.conversionRate.value,
                data.conversionRate.previousValue
              )}
              sparklineColor="#8b5cf6"
            />
          </>
        ) : null}
      </div>

      {/* Funnel */}
      <div className="conv-card" style={{ marginBottom: 'var(--space-xl)' }}>
        <div className="conv-card-title">Lejek konwersji</div>
        <div className="funnel-container">
          {funnel.map((step, i) => (
            <div key={step.label} style={{ display: 'flex', alignItems: 'center' }}>
              <div className="funnel-step">
                <div
                  className="funnel-bar"
                  style={{
                    background: funnelColors[i] || '#3b82f6',
                    width: funnelWidths[i] || '100%',
                    minWidth: 100,
                  }}
                >
                  {step.value.toLocaleString('pl-PL')}
                </div>
                <span className="funnel-step-label">{step.label}</span>
                {i > 0 && funnel[i - 1].value > 0 && (
                  <span className="funnel-step-pct">
                    {((step.value / funnel[i - 1].value) * 100).toFixed(1)}%
                  </span>
                )}
              </div>
              {i < funnel.length - 1 && (
                <span className="funnel-arrow">→</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Daily Trend Chart */}
      {chartData.length > 0 && (
        <div className="conv-chart-section">
          <div className="conv-card">
            <div className="conv-card-title">Trend konwersji dziennie</div>
            <LineChart
              data={chartData}
              xKey="date"
              lines={[
                { key: 'Formularze', color: '#10b981', label: 'Formularze' },
                { key: 'Telefony', color: '#f97316', label: 'Telefony' },
                { key: 'Łącznie', color: '#3b82f6', label: 'Łącznie' },
              ]}
              height={280}
              xTickFormatter={(v) => {
                const p = v.split('-');
                return p.length >= 3 ? `${p[2]}.${p[1]}` : v;
              }}
            />
          </div>
        </div>
      )}

      {/* Events Table */}
      <div className="conv-table-section">
        <div className="conv-card">
          <div className="conv-card-title" style={{ marginBottom: 16 }}>
            Zdarzenia konwersji
          </div>
          {loading ? (
            <div
              className="skeleton"
              style={{ width: '100%', height: 200, borderRadius: 12 }}
            />
          ) : (
            <DataTable
              columns={eventColumns}
              data={(data?.events ?? []) as unknown as Record<string, unknown>[]}
              pageSize={10}
            />
          )}
        </div>
      </div>
    </div>
  );
}
