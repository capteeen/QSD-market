import { NextResponse } from 'next/server';
import { readDocs } from '@/server/docs';
import type { HowResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The two documents, verbatim, read from the repository at request time. */
export async function GET(): Promise<NextResponse> {
  try {
    const docs: HowResponse = await readDocs();
    return NextResponse.json(docs, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ unavailable: { reason: `the documents could not be read (${e instanceof Error ? e.message : String(e)})` } }, { status: 503 });
  }
}
