import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import {
  buildCallCenterReport,
  resolveCallCenterWindow,
} from '@/lib/call-center-report';

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
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
    return NextResponse.json({ preset: window.preset, report });
  } catch (err: any) {
    console.error('[API /call-center] error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
