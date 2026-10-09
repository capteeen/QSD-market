/**
 * The measurement resolver: the pure rule that turns 32 draw bytes plus the
 * coin's inputs into an outcome. Its id is embedded in every proof bundle and
 * @qsd/quantum's verify() re-runs it, so this file must stay deterministic
 * and must never read anything but its arguments.
 *
 * Byte usage (all big-endian unsigned 64-bit, u = integer in [0, 2^64)):
 *
 *   bytes  0..7   u0  survive / collapse:  collapse iff u0 × 1e9 < decayProgressPpb × 2^64
 *   bytes  8..15  u1  tunnel (only if collapse): tunnel iff u1 × 1e6 < tunnelProbabilityPpm × 2^64
 *   bytes 16..23  u2  channel (only if collapse and not tunnel):
 *                     x = floor(u2 × 1e6 / 2^64) ∈ [0, 1e6); the first channel whose
 *                     cumulative probability (ppm) exceeds x is selected
 *   bytes 24..31  u3  pool point (only if collapse and not tunnel):
 *                     poolPointPpm = floor(u3 × 1e6 / 2^64) ∈ [0, 999 999]
 *
 * Every comparison is exact integer arithmetic (bigint); there is no float
 * anywhere in the resolver. The thresholds are inclusive on the low side, so
 * decayProgressPpb = 1e9 always collapses and 0 never does.
 */
import type { OutcomeResolver } from '@qsd/quantum';
import { ProtocolError } from './errors.js';
import { PPB, PPM, PPM_BIG, PPB_BIG } from './params.js';
import type { Channel, MeasurementInputs, MeasurementOutcome } from './types.js';

export const MEASUREMENT_RESOLVER_ID = 'qsd/measurement/v1';
export const RESOLVER_DRAW_BYTES = 32;

const TWO_64 = 1n << 64n;

export function readU64(bytes: Uint8Array, offset: number): bigint {
  if (bytes.length < offset + 8) throw new ProtocolError(`draw too short: need ${offset + 8} bytes, got ${bytes.length}`);
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(bytes[offset + i]!);
  return v;
}

/** Validate a channel table: non-empty, unique ids, positive ppm, sums to exactly 1 000 000. */
export function validateChannels(channels: readonly Pick<Channel, 'id' | 'probabilityPpm'>[]): void {
  if (!Array.isArray(channels) || channels.length === 0) throw new ProtocolError('channels must be a non-empty array');
  const ids = new Set<string>();
  let sum = 0;
  for (const c of channels) {
    if (typeof c.id !== 'string' || c.id.length === 0) throw new ProtocolError('channel id must be a non-empty string');
    if (ids.has(c.id)) throw new ProtocolError(`duplicate channel id '${c.id}'`);
    ids.add(c.id);
    if (!Number.isInteger(c.probabilityPpm) || c.probabilityPpm <= 0 || c.probabilityPpm > PPM) {
      throw new ProtocolError(`channel '${c.id}' probabilityPpm must be an integer in 1..${PPM}`);
    }
    sum += c.probabilityPpm;
  }
  if (sum !== PPM) throw new ProtocolError(`channel probabilities must sum to ${PPM} ppm, got ${sum}`);
}

export function validateMeasurementInputs(inputs: unknown): asserts inputs is MeasurementInputs {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw new ProtocolError('inputs must be an object');
  const i = inputs as Record<string, unknown>;
  if (typeof i['ca'] !== 'string' || i['ca'].length === 0) throw new ProtocolError('inputs.ca must be a non-empty string');
  const ppb = i['decayProgressPpb'];
  if (!Number.isInteger(ppb) || (ppb as number) < 0 || (ppb as number) > PPB) {
    throw new ProtocolError(`inputs.decayProgressPpb must be an integer in 0..${PPB}`);
  }
  const t = i['tunnelProbabilityPpm'];
  if (!Number.isInteger(t) || (t as number) < 0 || (t as number) > PPM) {
    throw new ProtocolError(`inputs.tunnelProbabilityPpm must be an integer in 0..${PPM}`);
  }
  if (!Number.isInteger(i['measurementIndex']) || (i['measurementIndex'] as number) < 0) {
    throw new ProtocolError('inputs.measurementIndex must be a non-negative integer');
  }
  validateChannels(i['channels'] as Channel[]);
}

/** Pure decision from (bytes, inputs). Exported so tests can drive it with chosen bytes. */
export function resolveMeasurement(bytes: Uint8Array, inputs: MeasurementInputs): MeasurementOutcome {
  validateMeasurementInputs(inputs);
  if (bytes.length < RESOLVER_DRAW_BYTES) {
    throw new ProtocolError(`measurement needs ${RESOLVER_DRAW_BYTES} draw bytes, got ${bytes.length}`);
  }
  const u0 = readU64(bytes, 0);
  const collapse = u0 * PPB_BIG < BigInt(inputs.decayProgressPpb) * TWO_64;
  if (!collapse) return { kind: 'survive' };

  const u1 = readU64(bytes, 8);
  const tunnel = u1 * PPM_BIG < BigInt(inputs.tunnelProbabilityPpm) * TWO_64;
  if (tunnel) return { kind: 'tunnel' };

  const u2 = readU64(bytes, 16);
  const x = Number((u2 * PPM_BIG) / TWO_64); // 0 .. 999 999
  let cumulative = 0;
  let channelIndex = -1;
  for (let k = 0; k < inputs.channels.length; k++) {
    cumulative += inputs.channels[k]!.probabilityPpm;
    if (x < cumulative) {
      channelIndex = k;
      break;
    }
  }
  if (channelIndex < 0) throw new ProtocolError('channel selection fell through (probabilities do not sum to 1e6)');

  const u3 = readU64(bytes, 24);
  const poolPointPpm = Number((u3 * PPM_BIG) / TWO_64);
  return { kind: 'collapse', channelId: inputs.channels[channelIndex]!.id, channelIndex, poolPointPpm };
}

export function outcomeLabel(outcome: MeasurementOutcome): string {
  switch (outcome.kind) {
    case 'survive':
      return 'survive';
    case 'tunnel':
      return 'tunnel';
    case 'collapse':
      return `collapse:${outcome.channelId}`;
  }
}

/** The resolver @qsd/quantum embeds by id. */
export const measurementResolver: OutcomeResolver<MeasurementInputs> = {
  id: MEASUREMENT_RESOLVER_ID,
  resolve(bytes, inputs) {
    const outcome = resolveMeasurement(bytes, inputs);
    return { value: outcome, label: outcomeLabel(outcome) };
  },
};

/** Parse an outcome value out of a bundle, rejecting anything that is not one of ours. */
export function parseOutcome(value: unknown): MeasurementOutcome {
  if (!value || typeof value !== 'object') throw new ProtocolError('outcome is not an object');
  const v = value as Record<string, unknown>;
  switch (v['kind']) {
    case 'survive':
      return { kind: 'survive' };
    case 'tunnel':
      return { kind: 'tunnel' };
    case 'collapse': {
      const { channelId, channelIndex, poolPointPpm } = v;
      if (typeof channelId !== 'string' || !Number.isInteger(channelIndex) || !Number.isInteger(poolPointPpm)) {
        throw new ProtocolError('malformed collapse outcome');
      }
      return { kind: 'collapse', channelId, channelIndex: channelIndex as number, poolPointPpm: poolPointPpm as number };
    }
    default:
      throw new ProtocolError(`unknown outcome kind '${String(v['kind'])}'`);
  }
}
