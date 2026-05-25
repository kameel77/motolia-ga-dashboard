'use client';

import { useState, useMemo } from 'react';

interface Column<T> {
  key: keyof T & string;
  label: string;
  align?: 'left' | 'right' | 'center';
  format?: (value: T[keyof T], row: T) => React.ReactNode;
  sortable?: boolean;
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[];
  data: T[];
  pageSize?: number;
  emptyMessage?: string;
}

type SortDir = 'asc' | 'desc';

export default function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  pageSize = 0,
  emptyMessage = 'Brak danych do wyświetlenia.',
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);

  const handleSort = (key: string, sortable?: boolean) => {
    if (sortable === false) return;
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va == null || vb == null) return 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      const sa = String(va);
      const sb = String(vb);
      return sortDir === 'asc'
        ? sa.localeCompare(sb)
        : sb.localeCompare(sa);
    });
  }, [data, sortKey, sortDir]);

  const paged = useMemo(() => {
    if (pageSize <= 0) return sorted;
    const start = page * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  const totalPages =
    pageSize > 0 ? Math.ceil(sorted.length / pageSize) : 1;

  if (data.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '40px 20px' }}>
        <div className="empty-state-icon">📭</div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          {emptyMessage}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={sortKey === col.key ? 'sorted' : ''}
                  style={{ textAlign: col.align || 'left' }}
                  onClick={() => handleSort(col.key, col.sortable)}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span style={{ marginLeft: 4, fontSize: '0.625rem' }}>
                      {sortDir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col.key} style={{ textAlign: col.align || 'left' }}>
                    {col.format
                      ? col.format(row[col.key], row)
                      : (String(row[col.key] ?? '—'))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            ← Wstecz
          </button>
          <span
            style={{
              fontSize: '0.8125rem',
              color: 'var(--text-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {page + 1} / {totalPages}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Dalej →
          </button>
        </div>
      )}
    </div>
  );
}
