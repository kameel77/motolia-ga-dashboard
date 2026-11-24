'use client';

import { useState, useEffect, useCallback } from 'react';
import ReportView, {
  type ArchiveEntry,
  type Granularity,
  type SnapshotRecord,
} from '@/components/reports/ReportView';
import {
  DEFAULT_REPORT_VISIBILITY,
  type ReportAlertKey,
  type ReportKpiKey,
  type ReportVisibilityConfig,
} from '@/lib/report-visibility';

export default function ReportsPage() {
  const [granularity, setGranularity] = useState<Granularity>('DAILY');
  const [periodKey, setPeriodKey] = useState<string>('');
  const [snapshot, setSnapshot] = useState<SnapshotRecord | null>(null);
  const [archive, setArchive] = useState<ArchiveEntry[]>([]);
  const [visibility, setVisibility] = useState<ReportVisibilityConfig>(
    DEFAULT_REPORT_VISIBILITY
  );
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareConfigured, setShareConfigured] = useState<boolean | undefined>(
    undefined
  );
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ granularity });
      if (periodKey) params.set('periodKey', periodKey);
      const res = await fetch(`/api/reports?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSnapshot(data.snapshot ?? null);
        setArchive(data.archive ?? []);
        if (data.visibility) setVisibility(data.visibility);
        setShareUrl(data.shareUrl ?? null);
        setShareConfigured(Boolean(data.shareConfigured));
      }
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoading(false);
    }
  }, [granularity, periodKey]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const persistVisibility = async (
    next: ReportVisibilityConfig,
    prev: ReportVisibilityConfig
  ) => {
    setSavingVisibility(true);
    try {
      const res = await fetch('/api/reports/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: next }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.visibility) setVisibility(data.visibility);
      } else {
        setVisibility(prev);
      }
    } catch (err) {
      console.error('Failed to save visibility settings:', err);
      setVisibility(prev);
    } finally {
      setSavingVisibility(false);
    }
  };

  const handleToggleKpi = (key: ReportKpiKey, checked: boolean) => {
    const prev = visibility;
    const next: ReportVisibilityConfig = {
      ...prev,
      kpis: { ...prev.kpis, [key]: checked },
    };
    setVisibility(next);
    void persistVisibility(next, prev);
  };

  const handleToggleAlert = (key: ReportAlertKey, checked: boolean) => {
    const prev = visibility;
    const next: ReportVisibilityConfig = {
      ...prev,
      alerts: { ...prev.alerts, [key]: checked },
    };
    setVisibility(next);
    void persistVisibility(next, prev);
  };

  const handleGranularityChange = (g: Granularity) => {
    setGranularity(g);
    setPeriodKey('');
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/reports/generate', { method: 'POST' });
      if (res.ok) {
        await loadReports();
      }
    } catch (err) {
      console.error('Failed to generate reports:', err);
    } finally {
      setGenerating(false);
    }
  };

  const htmlQuery = new URLSearchParams({
    granularity,
    ...(snapshot?.periodKey ? { periodKey: snapshot.periodKey } : {}),
  }).toString();

  return (
    <ReportView
      snapshot={snapshot}
      archive={archive}
      granularity={granularity}
      onGranularityChange={handleGranularityChange}
      onPeriodKeyChange={setPeriodKey}
      htmlHref={`/api/reports/html?${htmlQuery}`}
      downloadHref={`/api/reports/html?${htmlQuery}&download=1`}
      loading={loading}
      onGenerate={handleGenerate}
      generating={generating}
      shareUrl={shareUrl}
      shareConfigured={shareConfigured}
      visibility={visibility}
      onToggleKpi={handleToggleKpi}
      onToggleAlert={handleToggleAlert}
      savingVisibility={savingVisibility}
    />
  );
}
