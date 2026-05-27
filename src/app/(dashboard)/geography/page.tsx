'use client';

import { useState, useEffect } from 'react';
import PeriodSelector from '@/components/ui/PeriodSelector';
import BarChartComponent from '@/components/charts/BarChart';
import DataTable from '@/components/ui/DataTable';
import './geography.css';

interface GeoRow {
  region: string;
  city: string;
  sessions: number;
  users: number;
  conversions: number;
  conversionRate: number;
}

interface GeoData {
  rows: GeoRow[];
}

export default function GeographyPage() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState<GeoData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/geography?period=${period}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [period]);

  const rows = data?.rows ?? [];

  // Top 10 cities for horizontal bar chart
  const topCities = [...rows]
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 10)
    .map((r) => ({
      name: r.city,
      value: r.sessions,
    }));

  // Top regions for second bar chart
  const regionMap: Record<string, number> = {};
  rows.forEach((r) => {
    regionMap[r.region] = (regionMap[r.region] || 0) + r.sessions;
  });
  const topRegions = Object.entries(regionMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const columns = [
    { key: 'region' as const, label: 'Region' },
    { key: 'city' as const, label: 'Miasto' },
    {
      key: 'sessions' as const,
      label: 'Sesje',
      align: 'right' as const,
      format: (v: unknown) => Number(v).toLocaleString('pl-PL'),
    },
    {
      key: 'users' as const,
      label: 'Użytkownicy',
      align: 'right' as const,
      format: (v: unknown) => Number(v).toLocaleString('pl-PL'),
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
            <span style={{ display: 'flex', alignItems: 'center', color: 'var(--accent-green)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </span>
            Geografia
          </h1>
          <p className="page-subtitle">
            Dane regionalne i miejskie
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div className="geo-layout">
        <div className="geo-card">
          <div className="geo-card-title">Top 10 miast wg sesji</div>
          {loading ? (
            <div
              className="skeleton"
              style={{ width: '100%', height: 320, borderRadius: 12 }}
            />
          ) : (
            <BarChartComponent
              data={topCities}
              layout="horizontal"
              height={340}
              color="#3b82f6"
            />
          )}
        </div>

        <div className="geo-card">
          <div className="geo-card-title">Top 10 regionów wg sesji</div>
          {loading ? (
            <div
              className="skeleton"
              style={{ width: '100%', height: 320, borderRadius: 12 }}
            />
          ) : (
            <BarChartComponent
              data={topRegions}
              layout="horizontal"
              height={340}
              color="#8b5cf6"
            />
          )}
        </div>
      </div>

      <div className="geo-table-section">
        <div className="geo-card">
          <div className="geo-card-title" style={{ marginBottom: 16 }}>
            Szczegółowe dane geograficzne
          </div>
          {loading ? (
            <div
              className="skeleton"
              style={{ width: '100%', height: 300, borderRadius: 12 }}
            />
          ) : (
            <DataTable
              columns={columns}
              data={rows as unknown as Record<string, unknown>[]}
              pageSize={15}
            />
          )}
        </div>
      </div>
    </div>
  );
}
