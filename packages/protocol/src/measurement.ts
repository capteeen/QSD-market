/**
 * Measurement: building the inputs a QRNG draw is applied to, and applying
 * the resulting proof bundle back to the coin.
 *
 * Flow for the chain package:
 *
 *   const at = nowSeconds();
 *   const inputs = measurementInputs(coin, at);
 *   const { bundle } = await client.measure(inputs, measurementResolver);   // @qsd/quantum
 *   const { coin: next, measurement } = applyMeasurement(coin, bundle, { at, by, verify: {...} });
 *
 * applyMeasurement never trusts the bundle's stated outcome: it re-runs the
 * resolver on the bundle's bytes and inputs, checks the inputs are exactly
 * what this coin would produce at `at`, and (when `verify` options are
 * given) runs @qsd/quantum's full verify() first.
 */
import { bundleHash, hexToBytes, verify, type VerifyBundleOptions } from '@qsd/quantum';
import { decayProgress, decayProgressPpb, isMeasurable, resetQuietTime } from './decay.js';
import { BundleMismatchError, InvalidStateError, ProtocolError } from './errors.js';
import { BPS_BIG, PPM_BIG, PROTOCOL_PARAMS } from './params.js';
import {
  MEASUREMENT_RESOLVER_ID,
  measurementResolver,
  outcomeLabel,
  parseOutcome,
  resolveMeasurement,
  validateChannels,
} from './resolver.js';
import type { Coin, Measurement, MeasurementBundle, MeasurementInputs, MeasurementOutcome, UnixSeconds } from './types.js';

/** The exact inputs a measurement of `coin` at `now` is applied to. Throws unless the coin is measurable. */
export function measurementInputs(coin: Coin, now: UnixSeconds): MeasurementInputs {
  if (!isMeasurable(coin.state)) {
    throw new InvalidStateError(`coin ${coin.ca} cannot be measured in state '${coin.state}'`, coin.state);
  }
  validateChannels(coin.decayChannels);
  return {
    ca: coin.ca,
    decayProgressPpb: decayProgressPpb(coin, now),
    channels: coin.decayChannels.map((c) => ({ id: c.id, probabilityPpm: c.probabilityPpm })),
    tunnelProbabilityPpm: PROTOCOL_PARAMS.TUNNEL_PROBABILITY_PPM,
    measurementIndex: coin.measurements.length,
  };
}

function sameInputs(a: MeasurementInputs, b: MeasurementInputs): boolean {
  if (a.ca !== b.ca) return false;
  if (a.decayProgressPpb !== b.decayProgressPpb) return false;
  if (a.tunnelProbabilityPpm !== b.tunnelProbabilityPpm) return false;
  if (a.measurementIndex !== b.measurementIndex) return false;
  if (a.channels.length !== b.channels.length) return false;
  for (let i = 0; i < a.channels.length; i++) {
    const x = a.channels[i]!;
    const y = b.channels[i]!;
    if (x.id !== y.id || x.probabilityPpm !== y.probabilityPpm) return false;
  }
  return true;
}

export interface ApplyMeasurementOptions {
  /** The time the inputs were built with (measurementInputs(coin, at)). */
  at: UnixSeconds;
  /** Measurer wallet, or PROTOCOL_PARAMS.AUTO_MEASURER_ID for auto-measurement. */
  by: string;
  /**
   * When present, @qsd/quantum verify() runs on the bundle with these
   * options (trusted witness keys, allowUnsafeDev) and a failure throws.
   * When absent only the pure checks run; the caller must have verified.
   */
  verify?: VerifyBundleOptions;
}

export interface ApplyMeasurementResult {
  coin: Coin;
  measurement: Measurement;
  outcome: MeasurementOutcome;
}

/**
 * Apply a measurement bundle to the coin. Returns the new coin and the
 * Measurement record. Pure: the input coin is not mutated.
 *
 *   survive  → quiet time reduced by SURVIVE_RESET_BPS, state 'measured-alive'
 *   tunnel   → quiet clock fully reset to `at`, state 'tunnelled', holders intact
 *   collapse → state 'collapsed', decayProgress 1, collapsedAt = at
 */
export function applyMeasurement(coin: Coin, bundle: MeasurementBundle, opts: ApplyMeasurementOptions): ApplyMeasurementResult {
  const { at, by } = opts;
  if (typeof by !== 'string' || by.length === 0) throw new ProtocolError('measurer `by` must be a non-empty string');
  if (bundle.resolverId !== MEASUREMENT_RESOLVER_ID) {
    throw new BundleMismatchError(`bundle resolverId '${bundle.resolverId}' is not '${MEASUREMENT_RESOLVER_ID}'`);
  }
  if (opts.verify) {
    const r = verify(bundle, measurementResolver, opts.verify);
    if (!r.ok) throw new BundleMismatchError(`bundle failed verification: ${r.reason}`);
  }
  const expected = measurementInputs(coin, at); // also asserts measurability
  if (!sameInputs(expected, bundle.inputs.value)) {
    throw new BundleMismatchError(
      `bundle inputs do not match coin ${coin.ca} at ${at}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(bundle.inputs.value)}`,
    );
  }
  const bytes = hexToBytes(bundle.draw.bytesHex);
  const outcome = resolveMeasurement(bytes, expected);
  const stated = parseOutcome(bundle.outcome.value);
  if (outcomeLabel(stated) !== outcomeLabel(outcome) || JSON.stringify(stated) !== JSON.stringify(outcome)) {
    throw new BundleMismatchError(`bundle outcome '${bundle.outcome.label}' does not match resolver result '${outcomeLabel(outcome)}'`);
  }
  if (bundle.outcome.label !== outcomeLabel(outcome)) {
    throw new BundleMismatchError(`bundle outcome label '${bundle.outcome.label}' is wrong for its value`);
  }

  const decayBefore = decayProgress(coin, at);
  let next: Coin;
  switch (outcome.kind) {
    case 'survive': {
      const lastActivityAt = resetQuietTime(coin, at, PROTOCOL_PARAMS.SURVIVE_RESET_BPS);
      next = { ...coin, state: 'measured-alive', lastActivityAt };
      break;
    }
    case 'tunnel': {
      next = { ...coin, state: 'tunnelled', lastActivityAt: at };
      break;
    }
    case 'collapse': {
      next = { ...coin, state: 'collapsed', collapsedAt: at };
      break;
    }
  }
  const decayAfter = decayProgress(next, at);
  const measurement: Measurement = {
    id: bundleHash(bundle),
    at,
    by,
    proofBundle: bundle,
    outcome,
    decayBefore,
    decayAfter,
  };
  next = { ...next, decayProgress: decayAfter, measurements: [...coin.measurements, measurement] };
  return { coin: next, measurement, outcome };
}

/** The collapse measurement of a collapsed coin (its last measurement). */
export function collapseMeasurement(coin: Coin): Measurement & { outcome: Extract<MeasurementOutcome, { kind: 'collapse' }> } {
  if (coin.state !== 'collapsed') throw new InvalidStateError(`coin ${coin.ca} is not collapsed`, coin.state);
  const last = coin.measurements[coin.measurements.length - 1];
  if (!last || last.outcome.kind !== 'collapse') throw new ProtocolError(`collapsed coin ${coin.ca} has no collapse measurement`);
  return last as Measurement & { outcome: Extract<MeasurementOutcome, { kind: 'collapse' }> };
}

/** Measurements that resolved to survive (held-through candidates for allocation). */
export function survivedMeasurementIds(measurements: readonly Pick<Measurement, 'id' | 'outcome'>[]): string[] {
  return measurements.filter((m) => m.outcome.kind === 'survive').map((m) => m.id);
}

/**
 * Resolve the mother's superposition band to the daughter pool size:
 *     supplyMin + (supplyMax − supplyMin) × poolPointPpm / 1e6   (floor)
 */
export function resolvePoolUnits(superposition: { supplyMin: bigint; supplyMax: bigint }, poolPointPpm: number): bigint {
  const { supplyMin, supplyMax } = superposition;
  if (supplyMin < 0n || supplyMax < supplyMin) throw new ProtocolError('invalid superposition band');
  if (!Number.isInteger(poolPointPpm) || poolPointPpm < 0 || poolPointPpm >= 1_000_000) {
    throw new ProtocolError('poolPointPpm must be an integer in 0..999999');
  }
  return supplyMin + ((supplyMax - supplyMin) * BigInt(poolPointPpm)) / PPM_BIG;
}

export interface CollapseRewards {
  /** Units taken out of circulation: remainingUnits × COLLAPSE_BURN_BPS / 10 000 (floor). */
  removedUnits: bigint;
  /** Paid to the measurer: removedUnits × MEASURER_SHARE_OF_BURN_BPS / 10 000 (floor). */
  measurerUnits: bigint;
  /** Burned: removedUnits − measurerUnits. */
  burnedUnits: bigint;
}

/** Collapse economics for a mother with `remainingUnits` in circulation. Exact bigint. */
export function collapseRewards(remainingUnits: bigint): CollapseRewards {
  if (remainingUnits < 0n) throw new ProtocolError('remainingUnits must be >= 0');
  const removedUnits = (remainingUnits * BigInt(PROTOCOL_PARAMS.COLLAPSE_BURN_BPS)) / BPS_BIG;
  const measurerUnits = (removedUnits * BigInt(PROTOCOL_PARAMS.MEASURER_SHARE_OF_BURN_BPS)) / BPS_BIG;
  return { removedUnits, measurerUnits, burnedUnits: removedUnits - measurerUnits };
}

/** Fee rebated to the measurer on survive: fee × SURVIVE_FEE_REBATE_BPS / 10 000 (floor). */
export function surviveRebate(measurementFeeLamports: bigint): bigint {
  if (measurementFeeLamports < 0n) throw new ProtocolError('measurementFeeLamports must be >= 0');
  return (measurementFeeLamports * BigInt(PROTOCOL_PARAMS.SURVIVE_FEE_REBATE_BPS)) / BPS_BIG;
}
