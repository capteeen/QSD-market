import 'server-only';
import { hourlyBuyAndBurn, type BurnJournalDoc } from '@qsd/solana';
import { getChain } from './chain';
import { db } from './db';
import { logEvent } from './events';
import { publish } from './redis';
import { formatLamports, formatUnits } from '@/lib/format';

/** One hourly buy-and-burn run; the Burn row is written only when a burn transaction exists. */
export async function runHourlyBurn(log: (line: string) => void = console.log): Promise<void> {
  const chain = getChain();
  const feeWallet = chain.config.feeWallet;
  if (!feeWallet) throw new Error('QSD_FEE_WALLET is unset');
  const { sender, reader } = await chain.withCreator();
  const report = await hourlyBuyAndBurn({
    feeWallet,
    qsdMint: chain.config.qsdTokenMint,
    sender,
    reader,
    ledger: chain.feeLedger,
    journal: chain.journal<BurnJournalDoc>('burn'),
    jupiterApiUrl: chain.config.jupiterApiUrl,
    ...(chain.config.jupiterApiKey ? { jupiterApiKey: chain.config.jupiterApiKey } : {}),
    observer: chain.observer,
    log,
  });
  if (!report.burnSignature) {
    log(`burn: nothing burned (tallied ${report.lamportsTallied} lamports, swapped=${report.swapped})`);
    return;
  }
  const existing = await db().burn.findUnique({ where: { tx: report.burnSignature } });
  if (existing) return;
  const at = new Date();
  await db().burn.create({ data: { tx: report.burnSignature, swapTx: report.swapSignature ?? null, lamportsIn: report.lamportsTallied, qsdBurned: report.qsdUnitsBurned, at } });
  await logEvent({ type: 'burn', at, tx: report.burnSignature, summary: `hourly burn: ${formatLamports(report.lamportsTallied)} of fees → ${formatUnits(report.qsdUnitsBurned, 6)} $QSD burned` });
  await publish({ type: 'burn', tx: report.burnSignature });
}
