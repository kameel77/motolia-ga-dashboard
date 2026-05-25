'use client';

import { useState, useEffect, useMemo } from 'react';
import PeriodSelector from '@/components/ui/PeriodSelector';
import DonutChart from '@/components/charts/DonutChart';
import DataTable from '@/components/ui/DataTable';
import './devices.css';

interface DeviceRow {
  device: string;
  sessions: number;
  users: number;
  bounceRate: number;
}

interface DevicesData {
  rows: DeviceRow[];
}

const DEVICE_ICONS: Record<string, string> = {
  mobile: '📱',
  desktop: '💻',
  tablet: '📋',
};

const DEVICE_COLORS: Record<string, string> = {
  mobile: '#3b82f6',
  desktop: '#10b981',
  tablet: '#fbbf24',
};

export default function DevicesPage() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState<DevicesData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/devices?period=${period}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [period]);

  const rows = data?.rows ?? [];
  const totalSessions = rows.reduce((s, r) => s + r.sessions, 0);

  const donutData = useMemo(
    () =>
      rows.map((r) => ({
        name: r.device,
        value: r.sessions,
        color: DEVICE_COLORS[r.device.toLowerCase()] || '#5c6070',
      })),
    [rows]
  );

  const columns = [
    {
      key: 'device' as const,
      label: 'Urządzenie',
      format: (v: unknown) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{DEVICE_ICONS[String(v).toLowerCase()] || '🖥️'}</span>
          {String(v)}
        </span>
      ),
    },
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
      key: 'bounceRate' as const,
      label: 'Bounce Rate',
      align: 'right' as const,
      format: (v: unknown) => `${Number(v).toFixed(1)}%`,
    },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">📱 Urządzenia</h1>
          <p className="page-subtitle">
            Podział ruchu wg typu urządzenia
          </p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div className="devices-layout">
        {/* Donut Chart */}
        <div className="devices-card">
          <div className="devices-card-title">Podział sesji</div>
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

        {/* Breakdown + Table */}
        <div className="devices-card">
          <div className="devices-card-title">Podział szczegółowy</div>

          {/* Visual Bars */}
          {!loading && (
            <div className="devices-breakdown">
              {rows.map((r) => {
                const pct =
                  totalSessions > 0
                    ? ((r.sessions / totalSessions) * 100).toFixed(1)
                    : '0';
                const color =
                  DEVICE_COLORS[r.device.toLowerCase()] || '#5c6070';
                return (
                  <div key={r.device} className="device-bar">
                    <span className="device-bar-icon">
                      {DEVICE_ICONS[r.device.toLowerCase()] || '🖥️'}
                    </span>
                    <div className="device-bar-info">
                      <div className="device-bar-top">
                        <span className="device-bar-name">{r.device}</span>
                        <span className="device-bar-value">
                          {r.sessions.toLocaleString('pl-PL')} ({pct}%)
                        </span>
                      </div>
                      <div className="device-bar-track">
                        <div
                          className="device-bar-fill"
                          style={{
                            width: `${pct}%`,
                            background: color,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Data Table */}
          <div style={{ marginTop: 24 }}>
            {loading ? (
              <div
                className="skeleton"
                style={{ width: '100%', height: 160, borderRadius: 12 }}
              />
            ) : (
              <DataTable
                columns={columns}
                data={rows as unknown as Record<string, unknown>[]}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
