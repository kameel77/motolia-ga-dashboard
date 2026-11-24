import { NextRequest, NextResponse } from 'next/server';
import { ReportGranularity } from '@prisma/client';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  getShareTokenValue,
  verifyAnalyticsApiKey,
  verifyReportShareToken,
} from '@/lib/report-auth';
import {
  generateAndSaveReport,
  type ReportPayload,
} from '@/lib/report-builder';
import { escapeHtml } from '@/lib/report-html';
import { getReportVisibilityConfig } from '@/lib/report-settings';
import { getAlertKey } from '@/lib/report-visibility';

function parseGranularity(raw: string | null): ReportGranularity {
  if (raw === 'WEEKLY') return ReportGranularity.WEEKLY;
  if (raw === 'MONTHLY') return ReportGranularity.MONTHLY;
  return ReportGranularity.DAILY;
}

function fmtDelta(deltaPct: number | null): string {
  if (deltaPct === null) return '';
  const sign = deltaPct > 0 ? '+' : '';
  return ` (${sign}${deltaPct.toFixed(1)}%)`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const queryToken = searchParams.get('token');

  const isAdmin = await verifyAuth(request);
  const isApiKey = verifyAnalyticsApiKey(request);
  const isViewer = verifyReportShareToken(queryToken);

  if (!isAdmin && !isApiKey && !isViewer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const granularity = parseGranularity(searchParams.get('granularity'));
  const periodKey = searchParams.get('periodKey');

  try {
    let [snapshot, visibility] = await Promise.all([
      periodKey
        ? prisma.reportSnapshot.findUnique({
            where: {
              granularity_periodKey: { granularity, periodKey },
            },
          })
        : prisma.reportSnapshot.findFirst({
            where: { granularity },
            orderBy: { startDate: 'desc' },
          }),
      getReportVisibilityConfig(),
    ]);

    if (!snapshot && (isAdmin || isApiKey)) {
      snapshot = await generateAndSaveReport(
        granularity,
        periodKey || undefined,
        false
      );
    }

    if (!snapshot) {
      return NextResponse.json(
        { error: 'Report snapshot not found' },
        { status: 404 }
      );
    }

    const payload = snapshot.payload as unknown as ReportPayload;
    const filteredAlerts = payload.alerts.filter(
      (a) => visibility.alerts[getAlertKey(a)]
    );

    const granularityLabel =
      snapshot.granularity === 'DAILY'
        ? 'Raport dzienny'
        : snapshot.granularity === 'WEEKLY'
        ? 'Raport tygodniowy'
        : 'Raport miesięczny';

    const kpiLines: string[] = [];
    if (visibility.kpis.sessions) {
      kpiLines.push(
        `• Sesje: ${payload.kpi.sessions.value.toLocaleString('pl-PL')}${fmtDelta(
          payload.kpi.sessions.deltaPct
        )}`
      );
    }
    if (visibility.kpis.users) {
      kpiLines.push(
        `• Użytkownicy: ${payload.kpi.users.value.toLocaleString('pl-PL')}${fmtDelta(
          payload.kpi.users.deltaPct
        )}`
      );
    }
    if (visibility.kpis.totalLeads) {
      kpiLines.push(
        `• Leady łącznie: ${payload.kpi.totalLeads.value.toLocaleString(
          'pl-PL'
        )} (CR: ${payload.kpi.conversionRatePct.value.toFixed(2)}%)${fmtDelta(
          payload.kpi.totalLeads.deltaPct
        )}`
      );
    }
    if (visibility.kpis.webFormLeads) {
      kpiLines.push(
        `• Formularze / E-mail: ${payload.kpi.webFormLeads.value.toLocaleString(
          'pl-PL'
        )}${fmtDelta(payload.kpi.webFormLeads.deltaPct)}`
      );
    }
    if (visibility.kpis.phoneUniqueAnswered) {
      kpiLines.push(
        `• Tel. odebrane (unik.): ${payload.kpi.phoneUniqueAnswered.value.toLocaleString(
          'pl-PL'
        )} | Nieodebrane: ${payload.kpi.phoneUniqueMissed.value.toLocaleString(
          'pl-PL'
        )}`
      );
    }

    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    ).replace(/\/$/, '');
    const effectiveShareToken =
      queryToken && isViewer ? queryToken : getShareTokenValue();
    const shareUrl = effectiveShareToken
      ? `${baseUrl}/share/${effectiveShareToken}`
      : null;

    const htmlParams = new URLSearchParams({
      granularity: snapshot.granularity,
      periodKey: snapshot.periodKey,
      download: '1',
      ...(effectiveShareToken ? { token: effectiveShareToken } : {}),
    });
    const htmlUrl = `${baseUrl}/api/reports/html?${htmlParams.toString()}`;
    const filename = `motolia-raport-${snapshot.granularity.toLowerCase()}-${snapshot.periodKey.replace(
      /[^a-zA-Z0-9_-]/g,
      ''
    )}.html`;

    const textParts: string[] = [
      `📊 *Motolia — ${granularityLabel}: ${payload.period.label}*${
        snapshot.isFinal ? '' : ' _(wstępny)_'
      }`,
      ...kpiLines,
    ];
    if (filteredAlerts.length > 0) {
      textParts.push('');
      for (const a of filteredAlerts) {
        const icon =
          a.severity === 'warning'
            ? '⚠️'
            : a.severity === 'positive'
            ? '📈'
            : 'ℹ️';
        textParts.push(`${icon} ${a.title}`);
      }
    }
    if (shareUrl) {
      textParts.push('', `🔗 Podgląd online: ${shareUrl}`);
    }

    const htmlParts: string[] = [
      `📊 <b>Motolia — ${escapeHtml(granularityLabel)}: ${escapeHtml(
        payload.period.label
      )}</b>${snapshot.isFinal ? '' : ' <i>(wstępny)</i>'}`,
      ...kpiLines.map((l) => escapeHtml(l)),
    ];
    if (filteredAlerts.length > 0) {
      htmlParts.push('');
      for (const a of filteredAlerts) {
        const icon =
          a.severity === 'warning'
            ? '⚠️'
            : a.severity === 'positive'
            ? '📈'
            : 'ℹ️';
        htmlParts.push(`${icon} <b>${escapeHtml(a.title)}</b>`);
      }
    }
    if (shareUrl) {
      htmlParts.push(
        '',
        `🔗 <a href="${escapeHtml(shareUrl)}">Otwórz raport online</a>`
      );
    }

    return NextResponse.json({
      granularity: snapshot.granularity,
      periodKey: snapshot.periodKey,
      label: payload.period.label,
      isFinal: snapshot.isFinal,
      generatedAt: snapshot.generatedAt,
      filename,
      htmlUrl,
      shareUrl,
      summaryText: textParts.join('\n'),
      summaryHtml: htmlParts.join('\n'),
      visibility,
      payload: {
        ...payload,
        alerts: filteredAlerts,
      },
    });
  } catch (err: any) {
    console.error('[API /reports/digest] error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
