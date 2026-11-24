import { NextRequest, NextResponse } from 'next/server';
import { ReportGranularity } from '@prisma/client';
import { verifyAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getShareTokenValue, isShareTokenConfigured } from '@/lib/report-auth';

function parseGranularity(raw: string | null): ReportGranularity {
  if (raw === 'WEEKLY') return ReportGranularity.WEEKLY;
  if (raw === 'MONTHLY') return ReportGranularity.MONTHLY;
  return ReportGranularity.DAILY;
}

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const granularity = parseGranularity(searchParams.get('granularity'));
  const periodKey = searchParams.get('periodKey');

  try {
    const [archive, snapshot] = await Promise.all([
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
    ]);

    const shareConfigured = isShareTokenConfigured();
    const token = getShareTokenValue();
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
    const shareUrl =
      shareConfigured && token ? `${baseUrl}/share/${token}` : null;

    return NextResponse.json({
      snapshot,
      archive,
      shareConfigured,
      shareUrl,
    });
  } catch (err: any) {
    console.error('[API /reports] error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
