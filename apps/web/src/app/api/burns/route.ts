import type { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { guarded, json } from '@/server/unavailable';
import type { BurnsResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return guarded(async () => {
    const [rows, agg] = await Promise.all([db().burn.findMany({ orderBy: { at: 'desc' }, take: 500 }), db().burn.aggregate({ _sum: { qsdBurned: true } })]);
    const res: BurnsResponse = {
      burns: rows.map((b) => ({ id: b.id, tx: b.tx, swapTx: b.swapTx, lamportsIn: b.lamportsIn.toString(), qsdBurned: b.qsdBurned.toString(), at: b.at.toISOString() })),
      totalBurned: (agg._sum.qsdBurned ?? 0n).toString(),
      qsdMint: process.env.QSD_TOKEN_MINT?.trim() || null,
    };
    return json(res);
  });
}
