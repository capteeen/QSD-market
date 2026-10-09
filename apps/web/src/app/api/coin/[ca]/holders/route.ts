import { NextResponse } from 'next/server';
import { loadCoin, coinFromDb } from '@/server/coins';
import { TradeLogHoldingHistory, holdersFromTradeLog } from '@/server/holdingHistory';
import { guarded, json } from '@/server/unavailable';
import { nowSeconds } from '@/lib/format';
import type { HoldersResponse, HolderDto } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Holders reconstructed from the trade log with their holding facts, for the
 * projected-allocation ghost. The chain snapshot at the collapse block is the
 * authoritative input at collapse; this is the app's best live view and is
 * labelled as such. `holders: null` when no trade has been seen.
 */
export async function GET(_req: Request, { params }: { params: { ca: string } }): Promise<NextResponse> {
  return guarded(async () => {
    const row = await loadCoin(params.ca);
    if (!row) return NextResponse.json({ error: 'no such coin' }, { status: 404 });
    const coin = coinFromDb(row);
    const now = coin.collapsedAt ?? nowSeconds();
    const balances = await holdersFromTradeLog(coin.ca, now);
    let holders: HolderDto[] | null = null;
    if (balances) {
      const history = new TradeLogHoldingHistory();
      holders = [];
      for (const b of balances) {
        try {
          const facts = await history.factsFor(b.wallet, b.balance, {
            mint: coin.ca,
            bornAt: coin.bornAt,
            collapseAt: now,
            collapseSlot: 0,
            quietPeriodStart: coin.lastActivityAt,
            measurements: coin.measurements,
          });
          holders.push({ wallet: b.wallet, balance: b.balance.toString(), ...facts });
        } catch {
          /* a wallet with inconsistent history is left out rather than guessed */
        }
      }
    }
    const res: HoldersResponse = {
      ca: coin.ca,
      holders,
      bornAt: coin.bornAt,
      quietPeriodStart: coin.lastActivityAt,
      measurements: coin.measurements.map((m) => ({ id: m.id, outcome: m.outcome })),
      superposition: { supplyMin: coin.superposition.supplyMin.toString(), supplyMax: coin.superposition.supplyMax.toString() },
      now,
      source: 'trade-log',
    };
    return json(res);
  });
}
