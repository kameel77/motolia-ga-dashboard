import { prisma } from './prisma';
import {
  DEFAULT_REPORT_VISIBILITY,
  normalizeReportVisibility,
  type ReportVisibilityConfig,
} from './report-visibility';

const VISIBILITY_KEY = 'visibility';

export async function getReportVisibilityConfig(): Promise<ReportVisibilityConfig> {
  try {
    const row = await prisma.reportSetting.findUnique({
      where: { key: VISIBILITY_KEY },
    });
    if (!row) {
      return DEFAULT_REPORT_VISIBILITY;
    }
    return normalizeReportVisibility(row.value);
  } catch (err) {
    console.warn('[ReportSettings] Fallback to default visibility:', err);
    return DEFAULT_REPORT_VISIBILITY;
  }
}

export async function saveReportVisibilityConfig(
  raw: unknown
): Promise<ReportVisibilityConfig> {
  const normalized = normalizeReportVisibility(raw);
  const jsonValue = JSON.parse(JSON.stringify(normalized));

  await prisma.reportSetting.upsert({
    where: { key: VISIBILITY_KEY },
    create: {
      key: VISIBILITY_KEY,
      value: jsonValue,
    },
    update: {
      value: jsonValue,
    },
  });

  return normalized;
}
