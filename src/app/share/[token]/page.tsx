'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import ReportView, {
  type ArchiveEntry,
  type Granularity,
  type SnapshotRecord,
} from '@/components/reports/ReportView';

export default function PublicShareReportPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === 'string' ? params.token : '';

  const [granularity, setGranularity] = useState<Granularity>('DAILY');
  const [periodKey, setPeriodKey] = useState<string>('');
  const [snapshot, setSnapshot] = useState<SnapshotRecord | null>(null);
  const [archive, setArchive] = useState<ArchiveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  const loadPublicReport = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setUnauthorized(false);
    try {
      const qs = new URLSearchParams({ token, granularity });
      if (periodKey) qs.set('periodKey', periodKey);
      const res = await fetch(`/api/reports/public?${qs.toString()}`);
      if (res.status === 401) {
        setUnauthorized(true);
        setSnapshot(null);
        setArchive([]);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setSnapshot(data.snapshot ?? null);
        setArchive(data.archive ?? []);
      }
    } catch (err) {
      console.error('Failed to load shared report:', err);
    } finally {
      setLoading(false);
    }
  }, [token, granularity, periodKey]);

  useEffect(() => {
    loadPublicReport();
  }, [loadPublicReport]);

  if (unauthorized) {
    return (
      <div className="report-public-shell">
        <div className="report-page">
          <div className="report-empty" style={{ marginTop: 48 }}>
            <h1 style={{ margin: '0 0 8px', fontSize: 20 }}>Brak dostępu do raportu</h1>
            <p style={{ margin: 0 }}>
              Link dostępowy jest nieprawidłowy lub wygasł. Poproś administratora o aktualny adres.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const htmlQuery = new URLSearchParams({
    token,
    granularity,
    ...(snapshot?.periodKey ? { periodKey: snapshot.periodKey } : {}),
  }).toString();

  return (
    <div className="report-public-shell">
      <ReportView
        snapshot={snapshot}
        archive={archive}
        granularity={granularity}
        onGranularityChange={(g) => {
          setGranularity(g);
          setPeriodKey('');
        }}
        onPeriodKeyChange={setPeriodKey}
        htmlHref={`/api/reports/html?${htmlQuery}`}
        downloadHref={`/api/reports/html?${htmlQuery}&download=1`}
        loading={loading}
        isPublic
      />
    </div>
  );
}
