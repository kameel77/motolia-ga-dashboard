'use client';

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from 'recharts';

interface DonutChartDataItem {
  name: string;
  value: number;
  color?: string;
}

interface DonutChartProps {
  data: DonutChartDataItem[];
  colors?: string[];
  height?: number;
  centerLabel?: string;
  centerValue?: string | number;
  showLegend?: boolean;
}

const DEFAULT_COLORS = [
  '#3b82f6',
  '#10b981',
  '#fbbf24',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#f97316',
  '#ec4899',
];

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    payload: { color?: string; fill?: string };
  }>;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-item">
        <span
          className="chart-tooltip-dot"
          style={{ background: entry.payload.color || entry.payload.fill }}
        />
        <span className="chart-tooltip-name">{entry.name}:</span>
        <span className="chart-tooltip-value">
          {entry.value.toLocaleString('pl-PL')}
        </span>
      </div>
    </div>
  );
}

function CustomLegend({
  payload,
}: {
  payload?: Array<{ value: string; color: string }>;
}) {
  if (!payload) return null;
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px 20px',
        justifyContent: 'center',
        paddingTop: 12,
      }}
    >
      {payload.map((entry, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.8125rem',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: entry.color,
              flexShrink: 0,
            }}
          />
          <span style={{ color: '#8b8fa3' }}>{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function DonutChart({
  data,
  colors = DEFAULT_COLORS,
  height = 300,
  centerLabel,
  centerValue,
  showLegend = true,
}: DonutChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="45%"
          innerRadius="60%"
          outerRadius="80%"
          dataKey="value"
          paddingAngle={2}
          strokeWidth={0}
          animationDuration={800}
          animationBegin={100}
        >
          {data.map((entry, i) => (
            <Cell
              key={entry.name}
              fill={entry.color || colors[i % colors.length]}
              style={{ outline: 'none' }}
            />
          ))}
        </Pie>

        <Tooltip content={<CustomTooltip />} />

        {showLegend && <Legend content={<CustomLegend />} />}

        {/* Center label */}
        {centerValue !== undefined && (
          <>
            <text
              x="50%"
              y="42%"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{
                fill: '#f1f3f5',
                fontSize: '1.5rem',
                fontWeight: 700,
              }}
            >
              {typeof centerValue === 'number'
                ? centerValue.toLocaleString('pl-PL')
                : centerValue}
            </text>
            {centerLabel && (
              <text
                x="50%"
                y="52%"
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fill: '#8b8fa3',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                }}
              >
                {centerLabel}
              </text>
            )}
          </>
        )}
      </PieChart>
    </ResponsiveContainer>
  );
}
