import 'server-only';
import type { HoldingHistory, HoldingContext, HoldingFacts } from '@qsd/solana';
import { db } from './db';

/**
 * The app's `HoldingHistory` for @qsd/solana `holderSnapshotAtSlot`, built
 * from the trade-ingestion tables:
 *
 * - `Trade` rows come from the Helius webhook (buys of a QSD mint).
 * - `BalanceChange` rows record every signed delta the app has seen for a
 *   wallet/mint: buys (+), observed sells/transfers out (−), airdrop credits (+).
 *
 * firstAcquiredAt = the time of the earliest change after the last moment the
 * wallet's running balance was zero (the start of the current unbroken
 * holding period). A wallet with no recorded history is refused: the chain
 * package must not receive invented facts, so the snapshot throws for it and
 * the collapse waits for ingestion to catch up rather than guessing.
 */
export class TradeLogHoldingHistory implements HoldingHistory {
  async factsFor(wallet: string, balance: bigint, ctx: HoldingContext): Promise<HoldingFacts> {
    const changes = await db().balanceChange.findMany({
      where: { mint: ctx.mint, wallet, at: { lte: ctx.collapseAt } },
      orderBy: [{ at: 'asc' }, { slot: 'asc' }],
    });
    if (changes.length === 0) {
      throw new Error(`no holding history for ${wallet} on ${ctx.mint}: the trade log has not seen this wallet`);
    }
    let running = 0n;
    let periodStart: number | null = null;
    for (const c of changes) {
      const delta = c.deltaUnits ?? BigInt(Math.round(c.deltaUi * 1e6));
      const before = running;
      running += delta;
      if (before <= 0n && running > 0n) periodStart = c.at;
      if (running <= 0n) periodStart = null;
    }
    if (periodStart === null) {
      if (balance > 0n) throw new Error(`holding history for ${wallet} on ${ctx.mint} ends at zero but the chain shows a balance; ingestion is behind`);
      periodStart = ctx.collapseAt;
    }
    const firstAcquiredAt = Math.max(ctx.bornAt, periodStart);
    const heldThroughMeasurementIds = ctx.measurements.filter((m) => m.at > firstAcquiredAt && m.at <= ctx.collapseAt).map((m) => m.id);
    const heldThroughQuietPeriod = firstAcquiredAt <= ctx.quietPeriodStart && balance > 0n;
    return { firstAcquiredAt, heldThroughMeasurementIds, heldThroughQuietPeriod };
  }
}

/** Holders reconstructed from the trade log alone (for the projected-allocation ghost; the chain snapshot is authoritative at collapse). */
export async function holdersFromTradeLog(mint: string, now: number): Promise<{ wallet: string; balance: bigint }[] | null> {
  const changes = await db().balanceChange.findMany({ where: { mint, at: { lte: now } }, orderBy: [{ at: 'asc' }, { slot: 'asc' }] });
  if (changes.length === 0) return null;
  const bal = new Map<string, bigint>();
  for (const c of changes) {
    const delta = c.deltaUnits ?? BigInt(Math.round(c.deltaUi * 1e6));
    bal.set(c.wallet, (bal.get(c.wallet) ?? 0n) + delta);
  }
  return [...bal.entries()].filter(([, b]) => b > 0n).map(([wallet, balance]) => ({ wallet, balance })).sort((a, b) => (a.wallet < b.wallet ? -1 : 1));
}
