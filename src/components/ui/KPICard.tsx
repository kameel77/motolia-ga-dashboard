'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
} from 'recharts';
import './kpi-card.css';

interface SparklineDataPoint {
  value: number;
}

interface KPICardProps {
  label: string;
  value: string | number;
  trend?: number;
  trendLabel?: string;
  sparklineData?: SparklineDataPoint[];
  sparklineColor?: string;
}

export default function KPICard({
  label,
  value,
  trend,
  trendLabel,
  sparklineData,
  sparklineColor = '#3b82f6',
}: KPICardProps) {
  const trendDirection =
    trend === undefined || trend === 0
      ? 'neutral'
      : trend > 0
        ? 'up'
        : 'down';

  const trendSymbol =
    trendDirection === 'up' ? '↑' : trendDirection === 'down' ? '↓' : '→';

  return (
    <div className="kpi-card">
      <div className="kpi-card-header">
        <span className="kpi-label">{label}</span>
        {trend !== undefined && (
          <span className={`kpi-trend ${trendDirection}`}>
            {trendSymbol} {Math.abs(trend).toFixed(1)}%
            {trendLabel && ` ${trendLabel}`}
          </span>
        )}
      </div>
      <div className="kpi-value">{value}</div>
      {sparklineData && sparklineData.length > 0 && (
        <div className="kpi-sparkline">
          <ResponsiveContainer width="100%" height={40}>
            <AreaChart data={sparklineData}>
              <defs>
                <linearGradient
                  id={`sparkGrad-${label.replace(/\s/g, '')}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={sparklineColor}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="100%"
                    stopColor={sparklineColor}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={sparklineColor}
                strokeWidth={1.5}
                fill={`url(#sparkGrad-${label.replace(/\s/g, '')})`}
                dot={false}
                isAnimationActive={false}
              />
              <XAxis dataKey="name" hide />
              <YAxis hide domain={['dataMin - 5', 'dataMax + 5']} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
