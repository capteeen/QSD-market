import type { NextResponse } from 'next/server';
import { computeStats } from '@/server/stats';
import { guarded, json } from '@/server/unavailable';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return guarded(async () => json(await computeStats()));
}
