'use client';

import {
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';

interface BarChartDataItem {
  name: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarChartDataItem[];
  color?: string;
  height?: number;
  layout?: 'horizontal' | 'vertical';
  showGrid?: boolean;
  barRadius?: number;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    value: number;
    payload: { color?: string };
  }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      <div className="chart-tooltip-item">
        <span className="chart-tooltip-value">
          {payload[0].value.toLocaleString('pl-PL')}
        </span>
      </div>
    </div>
  );
}

export default function BarChartComponent({
  data,
  color = '#3b82f6',
  height = 300,
  layout = 'vertical',
  showGrid = true,
  barRadius = 4,
}: BarChartProps) {
  const isHorizontal = layout === 'horizontal';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart
        data={data}
        layout={isHorizontal ? 'vertical' : 'horizontal'}
        margin={
          isHorizontal
            ? { top: 4, right: 16, left: 0, bottom: 4 }
            : { top: 8, right: 8, left: 0, bottom: 0 }
        }
      >
        {showGrid && (
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.04)"
            horizontal={isHorizontal}
            vertical={!isHorizontal}
          />
        )}

        {isHorizontal ? (
          <>
            <XAxis
              type="number"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#5c6070', fontSize: 12 }}
              tickFormatter={(v: number) => {
                if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
                return String(v);
              }}
            />
            <YAxis
              type="category"
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#8b8fa3', fontSize: 12 }}
              width={120}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#5c6070', fontSize: 12 }}
              dy={8}
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
          </>
        )}

        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(59, 130, 246, 0.06)' }} />

        <Bar
          dataKey="value"
          radius={
            isHorizontal
              ? [0, barRadius, barRadius, 0]
              : [barRadius, barRadius, 0, 0]
          }
          maxBarSize={40}
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color || color} />
          ))}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
