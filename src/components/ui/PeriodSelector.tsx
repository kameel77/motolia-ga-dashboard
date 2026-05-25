'use client';

interface PeriodOption {
  label: string;
  value: string;
}

const periods: PeriodOption[] = [
  { label: 'Dziś', value: 'today' },
  { label: '7 dni', value: '7d' },
  { label: '30 dni', value: '30d' },
  { label: '90 dni', value: '90d' },
];

interface PeriodSelectorProps {
  value: string;
  onChange: (period: string) => void;
}

export default function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <div className="filter-group">
      {periods.map((p) => (
        <button
          key={p.value}
          className={`filter-pill ${value === p.value ? 'active' : ''}`}
          onClick={() => onChange(p.value)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
