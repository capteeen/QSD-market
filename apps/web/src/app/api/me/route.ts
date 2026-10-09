import { NextResponse, type NextRequest } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { db } from '@/server/db';
import { activityFor, summaryFromDb } from '@/server/coins';
import { guarded, json } from '@/server/unavailable';
import { nowSeconds } from '@/lib/format';
import type { MeResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return guarded(async () => {
    const wallet = req.nextUrl.searchParams.get('wallet') ?? '';
    try {
      new PublicKey(wallet);
    } catch {
      return NextResponse.json({ error: 'wallet query parameter must be a public key' }, { status: 400 });
    }
    const now = nowSeconds();
    const created = await db().coin.findMany({ where: { createdBy: wallet }, orderBy: { bornAt: 'desc' }, include: { _count: { select: { measurements: true } } } });
    const trades = await db().trade.groupBy({ by: ['mint'], where: { buyer: wallet }, _sum: { tokenUnits: true, tokenUiAmount: true }, _min: { at: true } });
    const heldRows = await db().coin.findMany({ where: { ca: { in: trades.map((t) => t.mint) } }, include: { _count: { select: { measurements: true } } } });
    const entries = await db().allocationEntry.findMany({ where: { wallet }, include: { table: { include: { airdrops: { where: { wallet } } } } } });
    const identities = await db().identity.findMany({ where: { coin: { createdBy: wallet } } });
    const res: MeResponse = {
      wallet,
      created: await Promise.all(created.map(async (c) => summaryFromDb(c, await activityFor(c.ca, now)))),
      held: await Promise.all(
        heldRows.map(async (c) => {
          const t = trades.find((x) => x.mint === c.ca)!;
          return {
            coin: summaryFromDb(c, await activityFor(c.ca, now)),
            tradedUnits: t._sum.tokenUnits?.toString() ?? null,
            tradedUiAmount: t._sum.tokenUiAmount ?? 0,
            firstAcquiredAt: t._min.at,
          };
        }),
      ),
      received: entries.map((e) => ({
        daughterCa: e.table.daughterCa,
        motherCa: e.table.motherCa,
        units: e.units.toString(),
        sharePpb: e.sharePpb,
        weightBps: e.weightBps,
        merkleRoot: e.table.merkleRoot,
        status: e.table.airdrops[0]?.status ?? null,
      })),
      identities: identities.map((i) => ({ coinCa: i.coinCa, root: i.root, nextIndex: i.nextIndex, remaining: i.remaining })),
      now,
    };
    return json(res);
  });
}
