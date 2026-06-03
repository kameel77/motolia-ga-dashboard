import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { runCollectionCycle } from '@/worker/cron';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenParam = searchParams.get('token');
  
  // Allow access either with a valid cookie session or matching JWT_SECRET token
  const isSecretValid = !!(tokenParam && process.env.JWT_SECRET && tokenParam === process.env.JWT_SECRET);
  const isAuthed = isSecretValid || (await verifyAuth(request));

  if (!isAuthed) {
    console.warn('[API Sync] Unauthorized sync attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[API Sync] Manual sync triggered');
  try {
    await runCollectionCycle();
    return NextResponse.json({ success: true, message: 'Sync completed successfully' });
  } catch (err: any) {
    console.error('[API Sync] Manual sync failed:', err);
    return NextResponse.json({ error: 'Sync failed', details: err.message }, { status: 500 });
  }
}
