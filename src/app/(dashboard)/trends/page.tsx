'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import './trends.css';

interface HourlyPoint {
  hour: number;
  sessions: number;
  conversions: number;
  sessionsYesterday?: number;
  sessionsWeekAgo?: number;
}

interface TVSpot {
  hour: number;
  minute: number;
  station: string;
  pasmo: string;
  color: string;
}

interface HourlyData {
  points: HourlyPoint[];
}

interface TVOverlayData {
  spots: TVSpot[];
}

interface HeatmapValue {
  day: number;
  hour: number;
  sessions: number;
}

const PASMO_COLORS: Record<string, string> = {
  day: '#fbbf24',
  prime: '#ef4444',
  'early fringe': '#8b5cf6',
  morning: '#06b6d4',
};

const DAYS = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz'];

function formatHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

function CustomTooltip({
  active,
  payload,
  label,
  spots,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  spots?: TVSpot[];
}) {
  if (!active || !payload?.length) return null;
  const hour = typeof label === 'string' ? parseInt(label) : label;
  const hourSpots = spots?.filter((s) => s.hour === hour) ?? [];

  return (
    <div className="chart-tooltip" style={{ maxWidth: 260 }}>
      <div className="chart-tooltip-label">{formatHour(Number(hour))}</div>
      {payload.map((entry, i) => (
        <div key={i} className="chart-tooltip-item">
          <span
            className="chart-tooltip-dot"
            style={{ background: entry.color }}
          />
          <span className="chart-tooltip-name">{entry.name}:</span>
          <span className="chart-tooltip-value">
            {entry.value?.toLocaleString('pl-PL') ?? '—'}
          </span>
        </div>
      ))}
      {hourSpots.length > 0 && (
        <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 4 }}>
            📺 Spoty TV:
          </div>
          {hourSpots.map((s, i) => (
            <div
              key={i}
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 0',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: s.color,
                  flexShrink: 0,
                }}
              />
              {s.station} — {String(s.hour).padStart(2, '0')}:
              {String(s.minute).padStart(2, '0')} ({s.pasmo})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TrendsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [showYesterday, setShowYesterday] = useState(false);
  const [showWeekAgo, setShowWeekAgo] = useState(false);
  const [hourly, setHourly] = useState<HourlyData | null>(null);
  const [tvData, setTvData] = useState<TVOverlayData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/hourly?date=${date}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`/api/tv-overlay?date=${date}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([h, tv]) => {
      setHourly(h);
      setTvData(tv);
      setLoading(false);
    });
  }, [date]);

  const chartData = useMemo(
    () =>
      (hourly?.points ?? []).map((p) => ({
        hour: p.hour,
        name: formatHour(p.hour),
        Sesje: p.sessions,
        Konwersje: p.conversions,
        ...(showYesterday && p.sessionsYesterday !== undefined
          ? { 'Wczoraj': p.sessionsYesterday }
          : {}),
        ...(showWeekAgo && p.sessionsWeekAgo !== undefined
          ? { 'Tydzień temu': p.sessionsWeekAgo }
          : {}),
      })),
    [hourly, showYesterday, showWeekAgo]
  );

  const spots = tvData?.spots ?? [];

  // Build heatmap data (mock for now, would come from weekly API)
  const heatmapData = useMemo(() => {
    const cells: HeatmapValue[] = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const point = hourly?.points?.find((p) => p.hour === h);
        cells.push({
          day: d,
          hour: h,
          sessions: point ? Math.round(point.sessions * (0.7 + Math.random() * 0.6)) : 0,
        });
      }
    }
    return cells;
  }, [hourly]);

  const maxHeatmapVal = Math.max(...heatmapData.map((c) => c.sessions), 1);

  function heatmapColor(val: number): string {
    const intensity = val / maxHeatmapVal;
    if (intensity < 0.2) return 'rgba(59, 130, 246, 0.08)';
    if (intensity < 0.4) return 'rgba(59, 130, 246, 0.2)';
    if (intensity < 0.6) return 'rgba(59, 130, 246, 0.4)';
    if (intensity < 0.8) return 'rgba(59, 130, 246, 0.6)';
    return 'rgba(59, 130, 246, 0.85)';
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">📈 Trendy & TV</h1>
          <p className="page-subtitle">
            Godzinowy timeline z nakładką spotów TV
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="trends-controls">
        <input
          type="date"
          className="trends-date-input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <div className="trends-toggle-group">
          <button
            className={`trends-toggle ${showYesterday ? 'active' : ''}`}
            onClick={() => setShowYesterday(!showYesterday)}
          >
            Wczoraj
          </button>
          <button
            className={`trends-toggle ${showWeekAgo ? 'active' : ''}`}
            onClick={() => setShowWeekAgo(!showWeekAgo)}
          >
            Tydzień temu
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="trends-legend">
        <div className="trends-legend-item">
          <div
            className="trends-legend-line"
            style={{ background: '#3b82f6' }}
          />
          Sesje
        </div>
        <div className="trends-legend-item">
          <div
            className="trends-legend-line"
            style={{ background: '#10b981' }}
          />
          Konwersje
        </div>
        {showYesterday && (
          <div className="trends-legend-item">
            <div
              className="trends-legend-line dashed"
              style={{ color: '#8b8fa3' }}
            />
            Wczoraj
          </div>
        )}
        {showWeekAgo && (
          <div className="trends-legend-item">
            <div
              className="trends-legend-line dashed"
              style={{ color: '#5c6070' }}
            />
            Tydzień temu
          </div>
        )}
        {Object.entries(PASMO_COLORS).map(([name, color]) => (
          <div key={name} className="trends-legend-item">
            <div className="trends-legend-dot" style={{ background: color }} />
            TV: {name}
          </div>
        ))}
      </div>

      {/* Main Hourly Chart */}
      <div className="trends-main-chart">
        <div className="trends-chart-title">
          Godzinowy ruch — {date}
        </div>
        {loading ? (
          <div
            className="skeleton"
            style={{ width: '100%', height: 360, borderRadius: 12 }}
          />
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart
              data={chartData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="gradSessions" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.04)"
                vertical={false}
              />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#5c6070', fontSize: 11 }}
                dy={8}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#5c6070', fontSize: 11 }}
                dx={-8}
                width={50}
              />

              <Tooltip
                content={<CustomTooltip spots={spots} />}
              />

              {/* TV Spot Reference Lines */}
              {spots.map((spot, i) => (
                <ReferenceLine
                  key={i}
                  x={formatHour(spot.hour)}
                  stroke={spot.color || PASMO_COLORS[spot.pasmo] || '#fbbf24'}
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  strokeOpacity={0.6}
                />
              ))}

              <Area
                type="monotone"
                dataKey="Sesje"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#gradSessions)"
                dot={false}
                activeDot={{ r: 4, fill: '#3b82f6', stroke: '#1a1d27', strokeWidth: 2 }}
              />

              <Line
                type="monotone"
                dataKey="Konwersje"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#10b981', stroke: '#1a1d27', strokeWidth: 2 }}
              />

              {showYesterday && (
                <Line
                  type="monotone"
                  dataKey="Wczoraj"
                  stroke="#8b8fa3"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  dot={false}
                />
              )}

              {showWeekAgo && (
                <Line
                  type="monotone"
                  dataKey="Tydzień temu"
                  stroke="#5c6070"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  dot={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Weekly Heatmap */}
      <div className="trends-heatmap-section">
        <div className="trends-chart-title">
          Mapa ciepła — intensywność sesji (godziny × dni tygodnia)
        </div>

        <div className="heatmap-grid">
          {/* Header row: hours 0-23 */}
          <div />
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={`header-${h}`} className="heatmap-header" style={{ fontSize: '0.625rem' }}>
              {String(h).padStart(2, '0')}
            </div>
          ))}

          {/* Data rows: days 0-6 */}
          {DAYS.map((dName, d) => (
            <>
              <div key={`day-label-${d}`} className="heatmap-day-label">
                {dName}
              </div>
              {Array.from({ length: 24 }).map((_, h) => {
                const cell = heatmapData.find(
                  (c) => c.day === d && c.hour === h
                );
                return (
                  <div
                    key={`cell-${d}-${h}`}
                    className="heatmap-cell"
                    style={{
                      background: heatmapColor(cell?.sessions ?? 0),
                    }}
                    title={`${dName} ${formatHour(h)}: ${cell?.sessions ?? 0} sesji`}
                  />
                );
              })}
            </>
          ))}
        </div>

        <div className="heatmap-scale">
          <span>Mniej</span>
          <div className="heatmap-scale-bar">
            {[0.08, 0.2, 0.4, 0.6, 0.85].map((o, i) => (
              <div
                key={i}
                className="heatmap-scale-step"
                style={{ background: `rgba(59, 130, 246, ${o})` }}
              />
            ))}
          </div>
          <span>Więcej</span>
        </div>
      </div>
    </div>
  );
}
