import 'server-only';
import { isMeasurable, type Coin, type Measurement } from '@qsd/protocol';
import { QuantumEventBus, type VerifyBundleOptions } from '@qsd/quantum';
import { measureCoin, productionVerifyOptions, type MeasurementJournalDoc } from '@qsd/solana';
import { getChain } from './chain';
import { coinFromDb, insertMeasurement, loadCoin, saveCoinState } from './coins';
import { logEvent } from './events';
import { publish } from './redis';
import { enqueue } from './queues';
import { qrngClient, qrngStatus } from './qrng';
import { formatPercent } from '@/lib/format';
import { nowSeconds } from '@/lib/format';

export class MeasureError extends Error {
  override readonly name = 'MeasureError';
}

/** Whether the daughter launch that follows a collapse outcome was handed to the collapse worker. */
export type DaughterLaunchStatus = { status: 'scheduled'; reason: null } | { status: 'not-scheduled'; reason: string };

export interface PerformedMeasurement {
  coin: Coin;
  measurement: Measurement;
  index: number;
  precommitTx: string;
  proofTx: string;
  /** Slot of the proof anchor (the collapse snapshot slot); null when the RPC could not report it. */
  proofSlot: number | null;
  /** Only for a collapse outcome; null otherwise. */
  daughterLaunch: DaughterLaunchStatus | null;
}

/** Verify options: trusted witness keys in production; dev randomness is only ever possible under the quantum package's guard. */
export function verifyOptions(): VerifyBundleOptions {
  const q = qrngStatus();
  if (q.providerId === 'UNSAFE_DEV_RANDOM') return { allowUnsafeDev: true };
  return productionVerifyOptions();
}

/**
 * Measure a coin through @qsd/solana `measureCoin` (pre-commit anchor → QRNG
 * draw → proof anchor → applyMeasurement), persist the result, log it,
 * publish it, and enqueue the collapse execution when the outcome is collapse.
 */
export async function performMeasurement(ca: string, by: string, bus?: QuantumEventBus): Promise<PerformedMeasurement> {
  const row = await loadCoin(ca);
  if (!row) throw new MeasureError('no such coin');
  const coin = coinFromDb(row);
  if (!isMeasurable(coin.state)) throw new MeasureError('this coin is collapsed and cannot be measured');
  const chain = getChain();
  const { anchor } = await chain.withCreator();
  const client = qrngClient(bus);
  const at = nowSeconds();
  const index = coin.measurements.length;
  const journal = chain.journal<MeasurementJournalDoc>(`measure-${ca}-${index}`);
  const result = await measureCoin(coin, { by, at }, { client, anchor, journal, verify: verifyOptions() });
  const proofSlot = await anchorSlot(chain, result.proof.txSignature);

  await insertMeasurement(ca, result.measurement, index, { precommitTx: result.precommit.txSignature, proofTx: result.proof.txSignature, ...(proofSlot !== null ? { proofSlot } : {}) });
  await saveCoinState(result.coin);

  const kind = result.outcome.kind;
  const type = kind === 'collapse' ? 'collapse' : kind === 'tunnel' ? 'tunnel' : 'survive';
  await logEvent({
    type,
    coinCa: ca,
    refId: result.measurement.id,
    tx: result.proof.txSignature,
    summary: `${coin.ticker} measured by ${by === 'protocol' ? 'the protocol' : by}: ${kind} (collapse probability was ${formatPercent(result.measurement.decayBefore)}; ${result.bundle.draw.attestation.kind})`,
    data: { index, attestationKind: result.bundle.draw.attestation.kind, precommitTx: result.precommit.txSignature, proofSlot },
  });
  await publish({ type: 'measurement', ca, measurementId: result.measurement.id, outcome: kind, at });
  await publish({ type: 'coin', ca });

  let daughterLaunch: DaughterLaunchStatus | null = null;
  if (kind === 'collapse') {
    const sched: { value: DaughterLaunchStatus } = { value: { status: 'scheduled', reason: null } };
    await enqueue('collapse', { ca }, { jobId: `collapse-${ca}`, attempts: 50, backoff: { type: 'exponential', delay: 10_000 }, onFailure: (reason) => void (sched.value = { status: 'not-scheduled', reason }) });
    daughterLaunch = sched.value;
    if (daughterLaunch.status === 'not-scheduled') {
      // Surface it: the mother is collapsed in the database; the reconciliation job (src/server/reconcile.ts) picks her up.
      await logEvent({ type: 'collapse-pending', coinCa: ca, refId: result.measurement.id, summary: `${coin.ticker} collapsed but the daughter launch was not scheduled: ${daughterLaunch.reason}`, data: { reason: daughterLaunch.reason } });
    }
  }

  return { coin: result.coin, measurement: result.measurement, index, precommitTx: result.precommit.txSignature, proofTx: result.proof.txSignature, proofSlot, daughterLaunch };
}

/** The slot the proof anchor landed in, read back from the RPC; null (never a guess) when it cannot be read. */
async function anchorSlot(chain: ReturnType<typeof getChain>, txSignature: string): Promise<number | null> {
  try {
    const tx = await chain.connection.getTransaction(txSignature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    return tx?.slot ?? null;
  } catch {
    return null;
  }
}
