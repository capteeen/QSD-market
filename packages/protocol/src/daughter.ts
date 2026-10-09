/**
 * Daughter derivation: the daughter's launch parameters are a fixed,
 * monotonic, bounded function of the mother's final state.
 *
 * Longevity score (bps, 0..10 000):
 *   fL = min(1, lifetime / (LIFETIME_REF × T))      lifetime = collapseAt − bornAt
 *   fM = min(1, survived / MEASUREMENTS_REF)
 *   fS = supplyRemaining / supplyTotal
 *   longevity = wL·fL + wM·fM + wS·fS                (weights sum to 1)
 *
 * Half-life: lerp over the channel's range by longevity, then the generation
 * penalty min(cap, 5 % × (generation − 1)), then clamp to the global bounds.
 * Band: width = max − (max − min) × longevity (as a fraction of the channel's
 * pool range), centred on the channel's midpoint; a fast death gets the
 * widest band, a long survival the tightest.
 *
 * All integer arithmetic; floors are documented in economics.md.
 */
import { sha256 } from '@qsd/crypto';
import { collapseMeasurement } from './measurement.js';
import { InvalidStateError, ProtocolError } from './errors.js';
import { BPS, BPS_BIG, PROTOCOL_PARAMS } from './params.js';
import type { Channel, Coin, DaughterParams, Hex, MotherFinalState, ParamRanges, UnixSeconds } from './types.js';

const P = PROTOCOL_PARAMS;

/** Middle dot U+00B7 between the base name and the generation. */
export const GENERATION_SEPARATOR = '·';

/** Strip an existing `·N` suffix and append `·generation`. Generation 1 is the bare name. */
export function daughterName(name: string, generation: number): string {
  if (!Number.isInteger(generation) || generation < 1) throw new ProtocolError('generation must be a positive integer');
  const base = baseName(name);
  return generation === 1 ? base : `${base}${GENERATION_SEPARATOR}${generation}`;
}

export function baseName(name: string): string {
  const idx = name.lastIndexOf(GENERATION_SEPARATOR);
  if (idx > 0 && /^[0-9]+$/.test(name.slice(idx + 1))) return name.slice(0, idx);
  return name;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^([0-9a-f]{2})*$/.test(hex)) throw new ProtocolError(`not lowercase hex: ${hex.slice(0, 16)}…`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

const LINEAGE_DOMAIN = new TextEncoder().encode('qsd/image-lineage/v1');

/** Generation-1 lineage: sha256("qsd/image-lineage/v1" ‖ imageHash). */
export function initialImageLineage(imageHashHex: Hex): Hex {
  return bytesToHex(sha256(concatBytes(LINEAGE_DOMAIN, hexToBytes(imageHashHex))));
}

/** Daughter lineage: sha256(motherLineage ‖ motherImageHash). */
export function nextImageLineage(motherLineageHex: Hex, motherImageHashHex: Hex): Hex {
  return bytesToHex(sha256(concatBytes(hexToBytes(motherLineageHex), hexToBytes(motherImageHashHex))));
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function bpsOf(num: number, den: number): number {
  if (den <= 0) return BPS;
  return clampInt(Math.floor((num * BPS) / den), 0, BPS);
}

/** The longevity score in bps, 0..10 000. Non-decreasing in each input. */
export function longevityBps(m: MotherFinalState): number {
  const fL = bpsOf(m.lifetimeSec, P.DAUGHTER_LIFETIME_REF_HALF_LIVES * m.halfLifeSec);
  const fM = bpsOf(m.measurementsSurvived, P.DAUGHTER_MEASUREMENTS_REF);
  const fS = clampInt(m.supplyRemainingBps, 0, BPS);
  return Math.floor((P.DAUGHTER_W_LIFETIME_BPS * fL + P.DAUGHTER_W_MEASUREMENTS_BPS * fM + P.DAUGHTER_W_SUPPLY_BPS * fS) / BPS);
}

/** Generation penalty in bps: min(cap, PENALTY × (generation − 1)). */
export function generationPenaltyBps(generation: number): number {
  return Math.min(P.DAUGHTER_GENERATION_PENALTY_CAP_BPS, P.DAUGHTER_GENERATION_PENALTY_BPS * Math.max(0, generation - 1));
}

/** Daughter half-life in seconds from the longevity score and the channel's range. */
export function daughterHalfLifeSec(longevity: number, generation: number, range: ParamRanges['halfLifeSec']): number {
  const lo = clampInt(range.min, P.HALF_LIFE_MIN_SEC, P.HALF_LIFE_MAX_SEC);
  const hi = clampInt(range.max, P.HALF_LIFE_MIN_SEC, P.HALF_LIFE_MAX_SEC);
  if (hi < lo) throw new ProtocolError('halfLifeSec range max < min');
  const lerp = lo + Math.floor(((hi - lo) * longevity) / BPS);
  const penalised = Math.floor((lerp * (BPS - generationPenaltyBps(generation))) / BPS);
  return clampInt(penalised, P.HALF_LIFE_MIN_SEC, P.HALF_LIFE_MAX_SEC);
}

/** Band width as a fraction of the channel's pool range, bps: max − (max − min) × longevity. */
export function bandWidthBps(longevity: number): number {
  const span = P.DAUGHTER_BAND_WIDTH_MAX_BPS - P.DAUGHTER_BAND_WIDTH_MIN_BPS;
  return P.DAUGHTER_BAND_WIDTH_MAX_BPS - Math.floor((span * longevity) / BPS);
}

/** The daughter's superposition band inside the channel's pool range. */
export function daughterBand(longevity: number, pool: ParamRanges['poolUnits']): { supplyMin: bigint; supplyMax: bigint } {
  if (pool.min < 0n || pool.max < pool.min) throw new ProtocolError('poolUnits range invalid');
  const range = pool.max - pool.min;
  const width = (range * BigInt(bandWidthBps(longevity))) / BPS_BIG;
  const mid = pool.min + range / 2n;
  let supplyMin = mid - width / 2n;
  let supplyMax = supplyMin + width;
  if (supplyMin < pool.min) supplyMin = pool.min;
  if (supplyMax > pool.max) supplyMax = pool.max;
  return { supplyMin, supplyMax };
}

/** The mapping on its own, for property tests: (final state, channel) → params. */
export function daughterParamsFrom(mother: MotherFinalState, channel: Channel, inherit: { name: string; imageLineage: Hex; imageHash: Hex; decayChannels: Channel[] }): DaughterParams {
  if (!Number.isInteger(mother.generation) || mother.generation < 1) throw new ProtocolError('generation must be >= 1');
  if (!Number.isInteger(mother.lifetimeSec) || mother.lifetimeSec < 0) throw new ProtocolError('lifetimeSec must be >= 0');
  if (!Number.isInteger(mother.measurementsSurvived) || mother.measurementsSurvived < 0) throw new ProtocolError('measurementsSurvived must be >= 0');
  const longevity = longevityBps(mother);
  const generation = mother.generation + 1;
  return {
    halfLifeSec: daughterHalfLifeSec(longevity, generation, channel.daughterParams.halfLifeSec),
    superposition: daughterBand(longevity, channel.daughterParams.poolUnits),
    decayChannels: inherit.decayChannels.map((c) => ({ ...c, daughterParams: { ...c.daughterParams } })),
    longevityBps: longevity,
    name: daughterName(inherit.name, generation),
    generation,
    imageLineage: nextImageLineage(inherit.imageLineage, inherit.imageHash),
  };
}

export function motherFinalState(mother: Coin, collapseAt: UnixSeconds): MotherFinalState {
  if (collapseAt < mother.bornAt) throw new ProtocolError('collapseAt is before bornAt');
  const total = mother.supply.totalUnits;
  const remaining = mother.supply.remainingUnits;
  if (total <= 0n || remaining < 0n || remaining > total) throw new ProtocolError('invalid supply');
  return {
    halfLifeSec: mother.halfLifeSec,
    lifetimeSec: collapseAt - mother.bornAt,
    measurementsSurvived: mother.measurements.filter((m) => m.outcome.kind === 'survive').length,
    supplyRemainingBps: Number((remaining * BPS_BIG) / total),
    generation: mother.generation,
  };
}

/**
 * Daughter parameters from a collapsed mother. The channel is the one the
 * collapse measurement selected; the daughter inherits the lineage's channel
 * table unchanged.
 */
export function deriveDaughterParams(mother: Coin, collapseAt: UnixSeconds): DaughterParams {
  if (mother.state !== 'collapsed') throw new InvalidStateError(`coin ${mother.ca} has not collapsed`, mother.state);
  const m = collapseMeasurement(mother);
  const channel = mother.decayChannels.find((c) => c.id === m.outcome.channelId);
  if (!channel) throw new ProtocolError(`collapse channel '${m.outcome.channelId}' is not in the mother's channel table`);
  return daughterParamsFrom(motherFinalState(mother, collapseAt), channel, {
    name: mother.name,
    imageLineage: mother.image.lineage,
    imageHash: mother.image.hash,
    decayChannels: mother.decayChannels,
  });
}

export interface DaughterBirth {
  ca: string;
  identityRoot: Hex;
  bornAt: UnixSeconds;
  /** Mint details of the daughter, supplied by the chain package. */
  supply: Coin['supply'];
  /** Image URI for the daughter (may be the mother's). */
  imageUri?: string;
}

/** Assemble the daughter Coin record once the chain has minted it. */
export function buildDaughterCoin(mother: Coin, params: DaughterParams, birth: DaughterBirth): Coin {
  return {
    ca: birth.ca,
    name: params.name,
    ticker: mother.ticker,
    image: { uri: birth.imageUri ?? mother.image.uri, hash: mother.image.hash, lineage: params.imageLineage },
    lineageId: mother.lineageId,
    generation: params.generation,
    motherCa: mother.ca,
    identityRoot: birth.identityRoot,
    halfLifeSec: params.halfLifeSec,
    decayProgress: 0,
    decayChannels: params.decayChannels,
    superposition: params.superposition,
    supply: birth.supply,
    state: 'superposed',
    lastActivityAt: birth.bornAt,
    measurements: [],
    bornAt: birth.bornAt,
  };
}
