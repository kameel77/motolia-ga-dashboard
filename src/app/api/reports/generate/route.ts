import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { runScheduledReportGeneration } from '@/lib/report-builder';

export async function POST(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const generatedCount = await runScheduledReportGeneration();
    return NextResponse.json({ ok: true, generatedCount });
  } catch (err: any) {
    console.error('[API /reports/generate] error:', err);
    return NextResponse.json(
      { error: 'Failed to generate reports', details: err.message },
      { status: 500 }
    );
  }
}
