import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import {
  getReportVisibilityConfig,
  saveReportVisibilityConfig,
} from '@/lib/report-settings';

export async function GET(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const visibility = await getReportVisibilityConfig();
  return NextResponse.json({ visibility });
}

export async function PUT(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const visibility = await saveReportVisibilityConfig(
      body?.visibility ?? body
    );
    return NextResponse.json({ ok: true, visibility });
  } catch (err: any) {
    console.error('[API /reports/settings] error:', err);
    return NextResponse.json(
      { error: 'Failed to save settings', details: err.message },
      { status: 500 }
    );
  }
}
