import { NextRequest, NextResponse } from 'next/server';
import { ReportGranularity } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { verifyReportShareToken } from '@/lib/report-auth';
import { getReportVisibilityConfig } from '@/lib/report-settings';

function parseGranularity(raw: string | null): ReportGranularity {
  if (raw === 'WEEKLY') return ReportGranularity.WEEKLY;
  if (raw === 'MONTHLY') return ReportGranularity.MONTHLY;
  return ReportGranularity.DAILY;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!verifyReportShareToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const granularity = parseGranularity(searchParams.get('granularity'));
  const periodKey = searchParams.get('periodKey');

  try {
    const [archive, snapshot, visibility] = await Promise.all([
      prisma.reportSnapshot.findMany({
        where: { granularity },
        orderBy: { startDate: 'desc' },
        take: 30,
        select: {
          periodKey: true,
          startDate: true,
          endDate: true,
          isFinal: true,
          generatedAt: true,
        },
      }),
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

    return NextResponse.json({
      snapshot,
      archive,
      visibility,
    });
  } catch (err: any) {
    console.error('[API /reports/public] error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
