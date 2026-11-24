import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import {
  getShareTokenValue,
  verifyAnalyticsApiKey,
  verifyReportShareToken,
} from '@/lib/report-auth';
import {
  buildCallCenterReport,
  formatDurationCompact,
  resolveCallCenterWindow,
} from '@/lib/call-center-report';

function escapeTgHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

  const preset = searchParams.get('preset');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  try {
    const window = resolveCallCenterWindow(preset, startDate, endDate);
    const report = await buildCallCenterReport(
      window.startDate,
      window.endDate,
      window.label
    );

    const t = report.totals;
    const textLines: string[] = [
      `📞 *Motolia Call Center — ${report.period.label}*`,
      `• Dostępność netto zespołu: ${formatDurationCompact(
        t.availableSec
      )} / ${formatDurationCompact(t.loginSec)} (${t.availabilityPct.toFixed(1)}%)`,
      `• Przychodzące: ${t.inboundAnswered} odebranych | Nieodebrane w kolejce: ${t.inboundQueueMissedUnique} unik. (${t.inboundQueueMissedRaw} prób)`,
      `• Wychodzące: ${t.outboundSuccess} udanych (≥30s) | ${t.outboundShort} krótkich | ${t.outboundFailed} nieudanych`,
      `• Łączny czas rozmów: ${formatDurationCompact(t.totalTalkSec)}`,
    ];

    if (report.agents.length > 0) {
      textLines.push('', '*Doradcy:*');
      for (const a of report.agents) {
        textLines.push(
          `– ${a.agentName}: zalog. ${formatDurationCompact(
            a.loginSec
          )} (przerwy ${formatDurationCompact(a.pauseSec)}), przych. ${
            a.inboundAnswered
          }/${a.inboundNotAnswered}, wych. ${a.outboundSuccess}/${
            a.outboundTotal
          } (czas ${formatDurationCompact(a.totalTalkSec)})`
        );
      }
    }

    const htmlLines: string[] = [
      `📞 <b>Motolia Call Center — ${escapeTgHtml(report.period.label)}</b>`,
      `• Dostępność netto zespołu: <b>${escapeTgHtml(
        formatDurationCompact(t.availableSec)
      )}</b> / ${escapeTgHtml(
        formatDurationCompact(t.loginSec)
      )} (${t.availabilityPct.toFixed(1)}%)`,
      `• Przychodzące: <b>${t.inboundAnswered}</b> odebranych | Nieodebrane w kolejce: <b>${t.inboundQueueMissedUnique}</b> unik. (${t.inboundQueueMissedRaw} prób)`,
      `• Wychodzące: <b>${t.outboundSuccess}</b> udanych (≥30s) | ${t.outboundShort} krótkich | ${t.outboundFailed} nieudanych`,
      `• Łączny czas rozmów: <b>${escapeTgHtml(
        formatDurationCompact(t.totalTalkSec)
      )}</b>`,
    ];

    if (report.agents.length > 0) {
      htmlLines.push('', '<b>Doradcy:</b>');
      for (const a of report.agents) {
        htmlLines.push(
          `– <b>${escapeTgHtml(a.agentName)}</b>: zalog. ${escapeTgHtml(
            formatDurationCompact(a.loginSec)
          )} (przerwy ${escapeTgHtml(
            formatDurationCompact(a.pauseSec)
          )}), przych. ${a.inboundAnswered}/${
            a.inboundNotAnswered
          }, wych. ${a.outboundSuccess}/${a.outboundTotal} (${escapeTgHtml(
            formatDurationCompact(a.totalTalkSec)
          )})`
        );
      }
    }

    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    ).replace(/\/$/, '');
    const effectiveToken =
      queryToken && isViewer ? queryToken : getShareTokenValue();
    const htmlParams = new URLSearchParams({
      preset: window.preset,
      ...(window.preset === 'custom'
        ? { startDate: report.period.startDate, endDate: report.period.endDate }
        : {}),
      download: '1',
      ...(effectiveToken ? { token: effectiveToken } : {}),
    });
    const htmlUrl = `${baseUrl}/api/reports/call-center/html?${htmlParams.toString()}`;
    const filename = `motolia-call-center-${report.period.startDate}-${report.period.endDate}.html`;

    return NextResponse.json({
      preset: window.preset,
      filename,
      htmlUrl,
      summaryText: textLines.join('\n'),
      summaryHtml: htmlLines.join('\n'),
      report,
    });
  } catch (err: any) {
    console.error('[API /reports/call-center/digest] error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
