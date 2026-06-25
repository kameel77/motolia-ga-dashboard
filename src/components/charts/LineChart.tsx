'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';

interface LineConfig {
  key: string;
  color: string;
  label: string;
  dashed?: boolean;
  yAxisId?: 'left' | 'right';
}

interface LineChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  lines: LineConfig[];
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  xTickFormatter?: (value: string) => string;
  spots?: any[];
}

const sanitizeId = (str: string) => str.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');

function CustomTooltip({
  active,
  payload,
  label,
  spots,
}: {
  active?: boolean;
  payload?: Array<{
    color: string;
    name: string;
    value: number;
  }>;
  label?: string;
  spots?: any[];
}) {
  if (!active || !payload?.length) return null;

  // Extract minutesAgo from label e.g., "15m" -> 15
  const minute = label ? parseInt(label.replace('m', '')) : null;
  const minuteSpots = spots?.filter((s) => s.minutesAgo === minute) ?? [];

  return (
    <div className="chart-tooltip" style={{ minWidth: 180, maxWidth: 280 }}>
      <div className="chart-tooltip-label">{label}</div>
      {payload.map((entry, i) => (
        <div key={i} className="chart-tooltip-item">
          <span
            className="chart-tooltip-dot"
            style={{ background: entry.color }}
          />
          <span className="chart-tooltip-name">{entry.name}:</span>
          <span className="chart-tooltip-value">
            {typeof entry.value === 'number'
              ? entry.value.toLocaleString('pl-PL')
              : entry.value}
          </span>
        </div>
      ))}

      {minuteSpots.length > 0 && (
        <div style={{ marginTop: 8, borderTop: '1px solid var(--border-color)', paddingTop: 8 }}>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            📺 Emisje TV:
          </div>
          {minuteSpots.map((s, i) => (
            <div key={i} style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', padding: '4px 0', borderBottom: i < minuteSpots.length - 1 ? '1px dashed rgba(255,255,255,0.04)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'var(--text-primary)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                {s.station} {s.time ? `(${s.time})` : ''}
              </div>
              <div style={{ color: 'var(--text-secondary)', marginTop: 2, paddingLeft: 12 }}>
                Program: <span style={{ color: 'var(--text-primary)' }}>{s.program || '—'}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 2, fontSize: '0.6875rem', color: 'var(--text-muted)', paddingLeft: 12 }}>
                <span>Dł: {s.spotLength}s</span>
                <span>Wer: {s.spotVersion || '—'}</span>
                <span style={{ color: s.color, fontWeight: 600 }}>{s.pasmo}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LineChartComponent({
  data,
  xKey,
  lines,
  height = 320,
  showGrid = true,
  showLegend = true,
  xTickFormatter,
  spots,
}: LineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {lines.map((line) => (
            <linearGradient
              key={`grad-${line.key}`}
              id={`gradient-${sanitizeId(line.key)}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={line.color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={line.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {showGrid && (
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border-color)"
            vertical={false}
          />
        )}

        <XAxis
          dataKey={xKey}
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#5c6070', fontSize: 12 }}
          dy={8}
          tickFormatter={xTickFormatter}
        />
        <YAxis
          yAxisId="left"
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#5c6070', fontSize: 12 }}
          dx={-8}
          width={50}
          tickFormatter={(v: number) => {
            if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
            return String(v);
          }}
        />
        {lines.some((l) => l.yAxisId === 'right') && (
          <YAxis
            yAxisId="right"
            orientation="right"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#5c6070', fontSize: 12 }}
            dx={8}
            width={50}
          />
        )}

        <Tooltip content={<CustomTooltip spots={spots} />} />

        {/* TV Spot Reference Lines */}
        {spots?.map((spot, i) => (
          <ReferenceLine
            key={i}
            x={`${spot.minutesAgo}m`}
            stroke={spot.color}
            strokeDasharray="4 4"
            strokeWidth={1.5}
            strokeOpacity={0.8}
          />
        ))}

        {showLegend && (
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{
              paddingBottom: 16,
              fontSize: 12,
              color: '#8b8fa3',
            }}
          />
        )}

        {lines.map((line) => (
          <Area
            key={line.key}
            type="monotone"
            dataKey={line.key}
            yAxisId={line.yAxisId || 'left'}
            name={line.label}
            stroke={line.color}
            strokeWidth={2}
            strokeDasharray={line.dashed ? '6 4' : undefined}
            fill={`url(#gradient-${sanitizeId(line.key)})`}
            dot={false}
            activeDot={{
              r: 4,
              fill: line.color,
              stroke: 'var(--bg-card)',
              strokeWidth: 2,
            }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
