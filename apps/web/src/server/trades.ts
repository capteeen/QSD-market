import 'server-only';
import { applyBuy, isMeasurable } from '@qsd/protocol';
import type { BuyEvent } from '@qsd/solana';
import { db } from './db';
import { coinFromDb, loadCoin, saveCoinState } from './coins';
import { logEvent } from './events';
import { publish } from './redis';
import { formatLamports } from '@/lib/format';

/**
 * Store a buy from the Helius webhook and apply the Zeno reset.
 *
 * Market cap for the reset is implied by the trade itself:
 *   price per base unit = lamports / tokenUnits (exact units when the webhook
 *   reports them, UI amount × 10^decimals otherwise)
 *   marketCapLamports  = price × remainingUnits
 * This is the only market-cap figure the app computes; it is documented in
 * the README and never shown as a "market cap" on any page.
 */
export async function ingestBuy(buy: BuyEvent): Promise<{ stored: boolean; applied: boolean }> {
  const row = await loadCoin(buy.mint);
  if (!row) return { stored: false, applied: false };
  const existing = await db().trade.findUnique({ where: { signature_mint_buyer: { signature: buy.signature, mint: buy.mint, buyer: buy.buyer } } });
  if (existing) return { stored: false, applied: false };

  const units = buy.tokenUnits ?? BigInt(Math.round(buy.tokenUiAmount * 10 ** row.decimals));
  await db().$transaction([
    db().trade.create({
      data: {
        signature: buy.signature,
        mint: buy.mint,
        buyer: buy.buyer,
        lamports: buy.lamports,
        tokenUnits: buy.tokenUnits ?? null,
        tokenUiAmount: buy.tokenUiAmount,
        slot: buy.slot,
        at: buy.timestamp,
        source: buy.source ?? null,
      },
    }),
    db().balanceChange.upsert({
      where: { signature_mint_wallet_kind: { signature: buy.signature, mint: buy.mint, wallet: buy.buyer, kind: 'buy' } },
      create: { signature: buy.signature, mint: buy.mint, wallet: buy.buyer, kind: 'buy', deltaUnits: units, deltaUi: buy.tokenUiAmount, slot: buy.slot, at: buy.timestamp },
      update: {},
    }),
  ]);

  const coin = coinFromDb(row);
  let applied = false;
  if (isMeasurable(coin.state) && units > 0n) {
    const marketCapLamports = (buy.lamports * coin.supply.remainingUnits) / units;
    if (marketCapLamports > 0n) {
      const next = applyBuy(coin, buy.lamports, marketCapLamports, buy.timestamp);
      await saveCoinState(next);
      applied = true;
    }
  }
  await logEvent({
    type: 'trade',
    at: new Date(buy.timestamp * 1000),
    coinCa: buy.mint,
    tx: buy.signature,
    summary: `${coin.ticker} bought for ${formatLamports(buy.lamports)} by ${buy.buyer}${applied ? ' — quiet clock reset (Zeno mechanic)' : ''}`,
  });
  await publish({ type: 'coin', ca: buy.mint });
  return { stored: true, applied };
}
