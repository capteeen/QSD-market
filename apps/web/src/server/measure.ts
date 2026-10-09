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

export interface PerformedMeasurement {
  coin: Coin;
  measurement: Measurement;
  index: number;
  precommitTx: string;
  proofTx: string;
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

  await insertMeasurement(ca, result.measurement, index, { precommitTx: result.precommit.txSignature, proofTx: result.proof.txSignature });
  await saveCoinState(result.coin);

  const kind = result.outcome.kind;
  const type = kind === 'collapse' ? 'collapse' : kind === 'tunnel' ? 'tunnel' : 'survive';
  await logEvent({
    type,
    coinCa: ca,
    refId: result.measurement.id,
    tx: result.proof.txSignature,
    summary: `${coin.ticker} measured by ${by === 'protocol' ? 'the protocol' : by}: ${kind} (collapse probability was ${formatPercent(result.measurement.decayBefore)}; ${result.bundle.draw.attestation.kind})`,
    data: { index, attestationKind: result.bundle.draw.attestation.kind, precommitTx: result.precommit.txSignature },
  });
  await publish({ type: 'measurement', ca, measurementId: result.measurement.id, outcome: kind, at });
  await publish({ type: 'coin', ca });
  if (kind === 'collapse') await enqueue('collapse', { ca }, { jobId: `collapse-${ca}`, attempts: 50, backoff: { type: 'exponential', delay: 10_000 } });

  return { coin: result.coin, measurement: result.measurement, index, precommitTx: result.precommit.txSignature, proofTx: result.proof.txSignature };
}
