import { NextRequest, NextResponse } from 'next/server';
import { ReportGranularity } from '@prisma/client';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { verifyReportShareToken } from '@/lib/report-auth';
import {
  generateAndSaveReport,
  type ReportPayload,
} from '@/lib/report-builder';
import { renderReportHtml } from '@/lib/report-html';

function parseGranularity(raw: string | null): ReportGranularity {
  if (raw === 'WEEKLY') return ReportGranularity.WEEKLY;
  if (raw === 'MONTHLY') return ReportGranularity.MONTHLY;
  return ReportGranularity.DAILY;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  const isAdmin = await verifyAuth(request);
  const isViewer = verifyReportShareToken(token);

  if (!isAdmin && !isViewer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const granularity = parseGranularity(searchParams.get('granularity'));
  const periodKey = searchParams.get('periodKey');
  const download = searchParams.get('download') === '1';

  try {
    let snapshot = periodKey
      ? await prisma.reportSnapshot.findUnique({
          where: {
            granularity_periodKey: { granularity, periodKey },
          },
        })
      : await prisma.reportSnapshot.findFirst({
          where: { granularity },
          orderBy: { startDate: 'desc' },
        });

    if (!snapshot && isAdmin) {
      snapshot = await generateAndSaveReport(
        granularity,
        periodKey || undefined,
        false
      );
    }

    if (!snapshot) {
      return new NextResponse(
        '<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><title>Brak raportu</title></head><body style="font-family:sans-serif;padding:40px;color:#0f172a"><h1>Raport niedostępny</h1><p>Dla wybranego okresu nie wygenerowano jeszcze snapshotu raportu.</p></body></html>',
        {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }
      );
    }

    const html = renderReportHtml({
      granularity: snapshot.granularity,
      periodKey: snapshot.periodKey,
      isFinal: snapshot.isFinal,
      generatedAt: snapshot.generatedAt,
      payload: snapshot.payload as unknown as ReportPayload,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    };
    if (download) {
      const safeKey = snapshot.periodKey.replace(/[^a-zA-Z0-9_-]/g, '');
      headers['Content-Disposition'] =
        `attachment; filename="motolia-raport-${snapshot.granularity.toLowerCase()}-${safeKey}.html"`;
    }

    return new NextResponse(html, { status: 200, headers });
  } catch (err: any) {
    console.error('[API /reports/html] error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
