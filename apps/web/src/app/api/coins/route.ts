import type { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { activityFor, summaryFromDb } from '@/server/coins';
import { guarded, json } from '@/server/unavailable';
import { nowSeconds } from '@/lib/format';
import type { CoinsResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return guarded(async () => {
    const now = nowSeconds();
    const rows = await db().coin.findMany({ orderBy: { bornAt: 'desc' }, include: { _count: { select: { measurements: true } } } });
    const coins = await Promise.all(rows.map(async (r) => summaryFromDb(r, await activityFor(r.ca, now))));
    return json({ coins, now } satisfies CoinsResponse);
  });
}
