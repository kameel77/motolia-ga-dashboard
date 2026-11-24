export type ReportKpiKey =
  | 'sessions'
  | 'users'
  | 'totalLeads'
  | 'webFormLeads'
  | 'phoneUniqueAnswered';

export type ReportAlertKey =
  | 'low_answer_rate'
  | 'stale_new_leads'
  | 'traffic_change'
  | 'zero_web_forms'
  | 'period_normal';

export interface ReportVisibilityConfig {
  kpis: Record<ReportKpiKey, boolean>;
  alerts: Record<ReportAlertKey, boolean>;
}

export const REPORT_KPI_KEYS: ReportKpiKey[] = [
  'sessions',
  'users',
  'totalLeads',
  'webFormLeads',
  'phoneUniqueAnswered',
];

export const REPORT_ALERT_KEYS: ReportAlertKey[] = [
  'low_answer_rate',
  'stale_new_leads',
  'traffic_change',
  'zero_web_forms',
  'period_normal',
];

export const DEFAULT_REPORT_VISIBILITY: ReportVisibilityConfig = {
  kpis: {
    sessions: true,
    users: true,
    totalLeads: true,
    webFormLeads: true,
    phoneUniqueAnswered: true,
  },
  alerts: {
    low_answer_rate: true,
    stale_new_leads: true,
    traffic_change: true,
    zero_web_forms: true,
    period_normal: true,
  },
};

export function normalizeReportVisibility(raw: unknown): ReportVisibilityConfig {
  const src =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rawKpis =
    src.kpis && typeof src.kpis === 'object'
      ? (src.kpis as Record<string, unknown>)
      : {};
  const rawAlerts =
    src.alerts && typeof src.alerts === 'object'
      ? (src.alerts as Record<string, unknown>)
      : {};

  const kpis = { ...DEFAULT_REPORT_VISIBILITY.kpis };
  for (const key of REPORT_KPI_KEYS) {
    if (typeof rawKpis[key] === 'boolean') {
      kpis[key] = rawKpis[key] as boolean;
    }
  }

  const alerts = { ...DEFAULT_REPORT_VISIBILITY.alerts };
  for (const key of REPORT_ALERT_KEYS) {
    if (typeof rawAlerts[key] === 'boolean') {
      alerts[key] = rawAlerts[key] as boolean;
    }
  }

  return { kpis, alerts };
}

export function getAlertKey(alert: {
  code?: ReportAlertKey;
  title: string;
}): ReportAlertKey {
  if (alert.code && REPORT_ALERT_KEYS.includes(alert.code)) {
    return alert.code;
  }

  const title = (alert.title || '').toLowerCase();
  if (title.includes('niska odbieralność')) return 'low_answer_rate';
  if (title.includes('zalega w statusie')) return 'stale_new_leads';
  if (title.includes('wzrost ruchu') || title.includes('spadek ruchu')) {
    return 'traffic_change';
  }
  if (title.includes('zero formularzy')) return 'zero_web_forms';
  return 'period_normal';
}
