import type { NextResponse } from 'next/server';
import { launchPreflight } from '@/server/launch';
import { guarded, json } from '@/server/unavailable';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET → { ok, problems[] }: whether a launch can run right now. The launch page calls it before asking the wallet to pay. */
export async function GET(): Promise<NextResponse> {
  return guarded(async () => json(await launchPreflight()));
}
