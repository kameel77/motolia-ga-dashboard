'use client';

import { useState, useEffect, useCallback } from 'react';
import LineChart from '@/components/charts/LineChart';
import './live.css';

interface RealtimeMinute {
  minutesAgo: number;
  activeUsers: number;
}

interface TopItem {
  name: string;
  value: number;
}

interface RealtimeData {
  activeUsers: number;
  minutes: RealtimeMinute[];
  spots?: any[];
  topSources: TopItem[];
  topPages: TopItem[];
  topCities: TopItem[];
}

export default function LivePage() {
  const [data, setData] = useState<RealtimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/realtime');
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLastRefresh(new Date());
      }
    } catch {
      // silently fail - will retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const chartData =
    data?.minutes
      ?.slice()
      .reverse()
      .map((m) => ({
        name: `${m.minutesAgo}m`,
        'Aktywni użytkownicy': m.activeUsers,
      })) ?? [];

  const renderTopList = (
    title: string,
    icon: string,
    items: TopItem[] | undefined
  ) => (
    <div className="live-grid-card">
      <div className="live-grid-title">
        <span>{icon}</span>
        {title}
      </div>
      <div className="live-grid-list">
        {items && items.length > 0 ? (
          items.slice(0, 8).map((item, i) => (
            <div key={i} className="live-grid-item">
              <span className="live-grid-item-name">{item.name}</span>
              <span className="live-grid-item-value">{item.value}</span>
            </div>
          ))
        ) : (
          <span
            style={{
              color: 'var(--text-muted)',
              fontSize: '0.8125rem',
            }}
          >
            Brak danych
          </span>
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', color: '#ef4444' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="3" fill="currentColor" />
                </svg>
              </span>
              Live
            </h1>
            <p className="page-subtitle">Dane w czasie rzeczywistym</p>
          </div>
        </div>
        <div className="live-hero">
          <div className="live-indicator">
            <div className="live-dot" />
            <span className="live-badge">LIVE</span>
          </div>
          <div className="live-meta">
            <div
              className="skeleton"
              style={{ width: 120, height: 56, borderRadius: 8 }}
            />
            <div
              className="skeleton"
              style={{ width: 160, height: 16, borderRadius: 4, marginTop: 8 }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', color: '#ef4444' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" fill="currentColor" />
              </svg>
            </span>
            Live
          </h1>
          <p className="page-subtitle">Dane w czasie rzeczywistym</p>
        </div>
        <div className="live-refresh-info">
          <div className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
          Odświeżanie co 60s · Ostatnio:{' '}
          {lastRefresh.toLocaleTimeString('pl-PL')}
        </div>
      </div>

      {/* Hero — Active Users */}
      <div className="live-hero">
        <div className="live-indicator">
          <div className="live-dot" />
          <span className="live-badge">LIVE</span>
        </div>
        <div className="live-meta">
          <div className="live-count">{data?.activeUsers ?? 0}</div>
          <div className="live-count-label">aktywnych użytkowników teraz</div>
        </div>
      </div>

      {/* Mini Line Chart */}
      {chartData.length > 0 && (
        <div className="live-chart-section">
          <div className="card">
            <div
              className="section-title"
              style={{ marginBottom: 'var(--space-md)' }}
            >
              Aktywni użytkownicy — ostatnie 30 minut
            </div>
            <LineChart
              data={chartData}
              xKey="name"
              lines={[
                {
                  key: 'Aktywni użytkownicy',
                  color: '#ef4444',
                  label: 'Aktywni',
                },
              ]}
              height={200}
              showLegend={false}
              spots={data?.spots}
            />
          </div>
        </div>
      )}

      {/* Top Lists Grid */}
      <div className="live-grid">
        {renderTopList('Top Zdarzenia', '⚡', data?.topSources)}
        {renderTopList('Top Strony', '📄', data?.topPages)}
        {renderTopList('Top Miasta', '📍', data?.topCities)}
      </div>
    </div>
  );
}
