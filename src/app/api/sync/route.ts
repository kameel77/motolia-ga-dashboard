import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { runCollectionCycle } from '@/worker/cron';

export async function GET(request: NextRequest) {
  // Temporarily bypass auth for remote diagnostics
  /*
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  */

  console.log('[API Sync] Manual sync triggered (auth bypassed)');
  try {
    await runCollectionCycle();
    return NextResponse.json({ success: true, message: 'Sync completed successfully' });
  } catch (err: any) {
    console.error('[API Sync] Manual sync failed:', err);
    return NextResponse.json({ error: 'Sync failed', details: err.message }, { status: 500 });
  }
}
