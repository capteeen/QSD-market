/**
 * FieldScene model: a pure, bounded mapping from what the app knows about a
 * coin to how its vessel is drawn. No randomness, no time: the same input
 * always gives the same vessel. Everything the app cannot supply is
 * represented by its absence (an empty `coins` array renders an empty
 * chamber), never by an invented number.
 */
import type { QuantumState } from '@qsd/ui-tokens';

export interface FieldCoin {
  /** Contract address — used as the stable key and for the live-measurement flash. */
  ca: string;
  /** 0..1 from the superposition width (supplyMax − supplyMin) / supplyMax. */
  uncertainty: number;
  /** 0..1 trading activity (the app's own normalisation of recent volume). */
  activity: number;
  /** 0..1 decay progress from the protocol package. */
  decayProgress: number;
  state: QuantumState;
}

export interface VesselParams {
  /** Cloud radius multiplier, 0.25..1.75: uncertainty spreads the cloud. */
  spread: number;
  /** Emissive intensity 0.05..1: activity makes the vessel bright and tight. */
  brightness: number;
  /** Ambient drift amplitude 0..1: untouched, near-collapse coins drift. */
  drift: number;
  /** Cloud point opacity 0.1..1. */
  density: number;
  /** Hex colour of the coin's quantum state (from ui-tokens). */
  tint: string;
  /** 1 when the coin is no longer in superposition (collapsed/dead): the cloud is gone. */
  settled: number;
}

export const STATE_HEX: Readonly<Record<QuantumState, string>> = {
  superposed: '#BFEF5A',
  'measured-alive': '#BFEF5A',
  collapsed: '#FF6B5E',
  tunnelled: '#F5F2EC',
  decaying: '#F5B04B',
  dead: '#57544F',
};

export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Pure, total, bounded: every output is finite and inside its documented range for any input. */
export function vesselParams(coin: FieldCoin): VesselParams {
  const u = clamp01(coin.uncertainty);
  const a = clamp01(coin.activity);
  const d = clamp01(coin.decayProgress);
  const settled = coin.state === 'collapsed' || coin.state === 'dead' ? 1 : 0;
  // Uncertainty widens the cloud; activity tightens it.
  const spread = 0.25 + 1.5 * clamp01(u * (1 - 0.5 * a));
  // Activity brightens; near-collapse untouched coins dim.
  const brightness = 0.05 + 0.95 * clamp01(0.15 + 0.85 * a - 0.3 * d * (1 - a));
  // Untouched and near collapse → drifting.
  const drift = clamp01((1 - a) * d);
  const density = 0.1 + 0.9 * clamp01(0.3 + 0.7 * a);
  return { spread, brightness, drift, density, tint: STATE_HEX[coin.state] ?? STATE_HEX.dead, settled };
}

/**
 * Deterministic vessel placement on a Vogel (sunflower) spiral: index → (x, z)
 * with uniform area density, so 300+ vessels fill a disc with no overlaps.
 */
export function vesselPosition(index: number, count: number, radius: number): [number, number, number] {
  const n = Math.max(1, count);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const r = radius * Math.sqrt((index + 0.5) / n);
  const theta = index * golden;
  return [r * Math.cos(theta), 0, r * Math.sin(theta)];
}

/** Live-measurement notification for the field: the vessel with `ca` flashes. */
export interface LiveMeasurement {
  ca: string;
  /** ISO timestamp from the measurement event. */
  at: string;
  outcomeLabel?: string;
}
