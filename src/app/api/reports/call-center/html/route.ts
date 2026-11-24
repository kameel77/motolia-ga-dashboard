import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import {
  verifyAnalyticsApiKey,
  verifyReportShareToken,
} from '@/lib/report-auth';
import {
  buildCallCenterReport,
  renderCallCenterHtml,
  resolveCallCenterWindow,
} from '@/lib/call-center-report';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  const isAdmin = await verifyAuth(request);
  const isApiKey = verifyAnalyticsApiKey(request);
  const isViewer = verifyReportShareToken(token);

  if (!isAdmin && !isApiKey && !isViewer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const preset = searchParams.get('preset');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const download = searchParams.get('download') === '1';

  try {
    const window = resolveCallCenterWindow(preset, startDate, endDate);
    const report = await buildCallCenterReport(
      window.startDate,
      window.endDate,
      window.label
    );
    const html = renderCallCenterHtml(report);

    const headers: Record<string, string> = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    };
    if (download) {
      const safeStart = report.period.startDate.replace(/[^0-9-]/g, '');
      const safeEnd = report.period.endDate.replace(/[^0-9-]/g, '');
      headers['Content-Disposition'] =
        `attachment; filename="motolia-call-center-${safeStart}-${safeEnd}.html"`;
    }

    return new NextResponse(html, { status: 200, headers });
  } catch (err: any) {
    console.error('[API /reports/call-center/html] error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
