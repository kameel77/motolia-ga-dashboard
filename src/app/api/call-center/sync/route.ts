import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { collectAgentDailyWork } from '@/worker/cron';

export async function POST(request: NextRequest) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const syncedRows = await collectAgentDailyWork(7);
    return NextResponse.json({ ok: true, syncedRows });
  } catch (err: any) {
    console.error('[API /call-center/sync] error:', err);
    return NextResponse.json(
      { error: 'Failed to sync agent work report', details: err.message },
      { status: 500 }
    );
  }
}
