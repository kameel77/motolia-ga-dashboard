'use client';

import { useState, useEffect, useMemo } from 'react';
import PeriodSelector from '@/components/ui/PeriodSelector';
import DonutChart from '@/components/charts/DonutChart';
import BarChartComponent from '@/components/charts/BarChart';
import DataTable from '@/components/ui/DataTable';
import './channels.css';

interface ChannelRow {
  sourceMedium: string;
  channel: string;
  sessions: number;
  engagementRate: number;
  users: number;
  bounceRate: number;
  conversions: number;
  conversionRate: number;
}

interface ChannelsData {
  rows: ChannelRow[];
}

const CHANNEL_COLORS: Record<string, string> = {
  CPC: '#3b82f6',
  Organic: '#10b981',
  Direct: '#fbbf24',
  Referral: '#8b5cf6',
  Email: '#06b6d4',
  TV: '#ef4444',
  Social: '#f97316',
  Other: '#5c6070',
};

const FILTERS = [
  'Wszystkie',
  'CPC',
  'Organic',
  'Direct',
  'Referral',
  'Email',
  'TV',
];

export default function ChannelsPage() {
  const [period, setPeriod] = useState('30d');
  const [filter, setFilter] = useState('Wszystkie');
  const [data, setData] = useState<ChannelsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/channels?period=${period}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [period]);

  const filtered = useMemo(() => {
    if (!data?.rows) return [];
    if (filter === 'Wszystkie') return data.rows;
    return data.rows.filter((r) => r.channel === filter);
  }, [data, filter]);

  // Session share by channel for donut
  const donutData = useMemo(() => {
    const byChannel: Record<string, number> = {};
    (data?.rows ?? []).forEach((r) => {
      byChannel[r.channel] = (byChannel[r.channel] || 0) + r.sessions;
    });
    return Object.entries(byChannel).map(([name, value]) => ({
      name,
      value,
      color: CHANNEL_COLORS[name] || '#5c6070',
    }));
  }, [data]);

  // Conversions by channel for bar chart
  const barData = useMemo(() => {
    const byChannel: Record<string, number> = {};
    (data?.rows ?? []).forEach((r) => {
      byChannel[r.channel] = (byChannel[r.channel] || 0) + r.conversions;
    });
    return Object.entries(byChannel)
      .map(([name, value]) => ({
        name,
        value,
        color: CHANNEL_COLORS[name] || '#5c6070',
      }))
      .sort((a, b) => b.value - a.value);
  }, [data]);

  const totalSessions = donutData.reduce((s, d) => s + d.value, 0);

  const columns = [
    { key: 'sourceMedium' as const, label: 'Source/Medium' },
    {
      key: 'sessions' as const,
      label: 'Sesje',
      align: 'right' as const,
      format: (v: unknown) => Number(v).toLocaleString('pl-PL'),
    },
    {
      key: 'engagementRate' as const,
      label: 'Engagement Rate',
      align: 'right' as const,
      format: (v: unknown) => `${Number(v).toFixed(1)}%`,
    },
    {
      key: 'users' as const,
      label: 'Użytkownicy',
      align: 'right' as const,
      format: (v: unknown) => Number(v).toLocaleString('pl-PL'),
    },
    {
      key: 'bounceRate' as const,
      label: 'Bounce Rate',
      align: 'right' as const,
      format: (v: unknown) => `${Number(v).toFixed(1)}%`,
    },
    {
      key: 'conversions' as const,
      label: 'Konwersje',
      align: 'right' as const,
      format: (v: unknown) => Number(v).toLocaleString('pl-PL'),
    },
    {
      key: 'conversionRate' as const,
      label: 'CR%',
      align: 'right' as const,
      format: (v: unknown) => `${Number(v).toFixed(2)}%`,
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', color: 'var(--accent-purple)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 3H2l8 9v6l4 2v-8z" />
              </svg>
            </span>
            Kanały
          </h1>
          <p className="page-subtitle">Analiza źródeł ruchu i mediów</p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Channel Filters */}
      <div className="channels-filters">
        <div className="filter-group">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`filter-pill ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Charts Row */}
      <div className="channels-charts">
        <div className="channels-chart-card">
          <div className="channels-chart-title">Udział sesji wg kanału</div>
          {loading ? (
            <div
              className="skeleton"
              style={{ width: '100%', height: 280, borderRadius: 12 }}
            />
          ) : (
            <DonutChart
              data={donutData}
              centerValue={totalSessions}
              centerLabel="sesji"
              height={300}
            />
          )}
        </div>

        <div className="channels-chart-card">
          <div className="channels-chart-title">Konwersje wg kanału</div>
          {loading ? (
            <div
              className="skeleton"
              style={{ width: '100%', height: 280, borderRadius: 12 }}
            />
          ) : (
            <BarChartComponent
              data={barData}
              layout="horizontal"
              height={300}
            />
          )}
        </div>
      </div>

      {/* Data Table */}
      <div className="channels-table-section">
        <div className="channels-table-card">
          <div className="channels-chart-title" style={{ marginBottom: 16 }}>
            Szczegółowe dane źródeł
          </div>
          {loading ? (
            <div
              className="skeleton"
              style={{ width: '100%', height: 300, borderRadius: 12 }}
            />
          ) : (
            <DataTable
              columns={columns}
              data={filtered as unknown as Record<string, unknown>[]}
              pageSize={15}
            />
          )}
        </div>
      </div>
    </div>
  );
}
