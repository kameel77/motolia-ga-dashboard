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
} from 'recharts';

interface LineConfig {
  key: string;
  color: string;
  label: string;
  dashed?: boolean;
}

interface LineChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  lines: LineConfig[];
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  xTickFormatter?: (value: string) => string;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    color: string;
    name: string;
    value: number;
  }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
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
}: LineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {lines.map((line) => (
            <linearGradient
              key={`grad-${line.key}`}
              id={`gradient-${line.key}`}
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
            stroke="rgba(255,255,255,0.04)"
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

        <Tooltip content={<CustomTooltip />} />

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
            name={line.label}
            stroke={line.color}
            strokeWidth={2}
            strokeDasharray={line.dashed ? '6 4' : undefined}
            fill={`url(#gradient-${line.key})`}
            dot={false}
            activeDot={{
              r: 4,
              fill: line.color,
              stroke: '#1a1d27',
              strokeWidth: 2,
            }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
