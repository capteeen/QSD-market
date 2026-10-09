/**
 * Every protocol constant, in one object. /docs/economics.md quotes these
 * numbers and a test checks the document against this file, so a change here
 * without a change there fails the build.
 *
 * Units:
 *   *_BPS  basis points (1 bps = 0.01 %, 10 000 bps = 100 %)
 *   *_PPM  parts per million (1 000 000 = 100 %)
 *   *_PPB  parts per billion (1 000 000 000 = 100 %)
 *   *_SEC  seconds
 * Integers only, so every derived quantity can be computed exactly.
 */
export const PROTOCOL_PARAMS = {
  /** Version string of this parameter set; bump when any number changes. */
  VERSION: 'qsd-protocol-params/v1',

  // ----------------------------------------------------------------- decay
  /** Smallest half-life any coin (mother or daughter) can have. 1 hour. */
  HALF_LIFE_MIN_SEC: 3_600,
  /** Largest half-life any coin can have. 7 days. */
  HALF_LIFE_MAX_SEC: 604_800,
  /**
   * Auto-measurement window, in half-lives. If nobody measures a coin within
   * AUTO_MEASURE_HALF_LIVES × halfLifeSec of quiet time, the protocol does.
   * At 2 half-lives decayProgress = 1 − 2^-2 = 0.75.
   */
  AUTO_MEASURE_HALF_LIVES: 2,

  // ------------------------------------------------------------ Zeno (buys)
  /**
   * Zeno gain k: a buy of fraction x of market cap removes min(cap, k·x) of
   * the accumulated quiet time. k = 4 means a buy worth 1 % of market cap
   * removes 4 % of the quiet time.
   */
  ZENO_K: 4,
  /** Maximum fraction of quiet time one buy can remove. 50 %. */
  ZENO_RESET_CAP_BPS: 5_000,

  // ------------------------------------------------------------ measurement
  /** Fraction of quiet time removed when a measurement resolves to survive. 75 %. */
  SURVIVE_RESET_BPS: 7_500,
  /** Probability that a collapse tunnels (coin re-emerges as itself). 2.5 %. */
  TUNNEL_PROBABILITY_PPM: 25_000,
  /**
   * On collapse this fraction of the mother's remaining supply is removed
   * from circulation (taken from the protocol reserve). 1 %.
   */
  COLLAPSE_BURN_BPS: 100,
  /**
   * Of the removed amount, this share is paid to the measurer; the rest is
   * burned. 20 % of 1 % = 0.2 % of remaining supply to the measurer.
   */
  MEASURER_SHARE_OF_BURN_BPS: 2_000,
  /** On survive, this fraction of the measurement fee is rebated to the measurer. 10 %. */
  SURVIVE_FEE_REBATE_BPS: 1_000,
  /** Identifier recorded as `by` when the protocol auto-measures. */
  AUTO_MEASURER_ID: 'protocol',

  // --------------------------------------------------------------- daughter
  /** Lifetime (in mother half-lives) at which the lifetime score saturates at 1. */
  DAUGHTER_LIFETIME_REF_HALF_LIVES: 6,
  /** Survived measurements at which the measurement score saturates at 1. */
  DAUGHTER_MEASUREMENTS_REF: 5,
  /** Weight of the lifetime score in the longevity score. */
  DAUGHTER_W_LIFETIME_BPS: 5_000,
  /** Weight of the survived-measurements score in the longevity score. */
  DAUGHTER_W_MEASUREMENTS_BPS: 3_000,
  /** Weight of the supply-remaining score in the longevity score. */
  DAUGHTER_W_SUPPLY_BPS: 2_000,
  /** Half-life penalty per generation after the first. 5 % per generation. */
  DAUGHTER_GENERATION_PENALTY_BPS: 500,
  /** Cap on the total generation penalty. 50 %. */
  DAUGHTER_GENERATION_PENALTY_CAP_BPS: 5_000,
  /** Narrowest superposition band, as a fraction of the channel's full range. 20 %. */
  DAUGHTER_BAND_WIDTH_MIN_BPS: 2_000,
  /** Widest superposition band, as a fraction of the channel's full range. 100 %. */
  DAUGHTER_BAND_WIDTH_MAX_BPS: 10_000,

  // ------------------------------------------------------------- allocation
  /** Largest entanglement weight (1.5×). The smallest is always 1.0×. */
  ENTANGLEMENT_WEIGHT_MAX_BPS: 15_000,
  /** Weight of the duration-held score. */
  ALLOC_W_DURATION_BPS: 5_000,
  /** Weight of the measurements-held-through score. */
  ALLOC_W_MEASUREMENTS_BPS: 3_000,
  /** Weight of the held-through-quiet-period score. */
  ALLOC_W_QUIET_BPS: 2_000,
} as const;

export type ProtocolParams = typeof PROTOCOL_PARAMS;
export type ProtocolParamName = keyof ProtocolParams;

/** Half-life presets offered at launch (seconds) with their auto-measure window. */
export interface HalfLifePreset {
  id: '1h' | '6h' | '24h' | '72h' | '7d';
  label: string;
  halfLifeSec: number;
  maxWindowSec: number;
}

/** maxWindowSec for any half-life: AUTO_MEASURE_HALF_LIVES × halfLifeSec. */
export function maxWindowSec(halfLifeSec: number): number {
  return PROTOCOL_PARAMS.AUTO_MEASURE_HALF_LIVES * halfLifeSec;
}

export const HALF_LIFE_PRESETS: readonly HalfLifePreset[] = [
  { id: '1h', label: '1 hour', halfLifeSec: 3_600, maxWindowSec: maxWindowSec(3_600) },
  { id: '6h', label: '6 hours', halfLifeSec: 21_600, maxWindowSec: maxWindowSec(21_600) },
  { id: '24h', label: '24 hours', halfLifeSec: 86_400, maxWindowSec: maxWindowSec(86_400) },
  { id: '72h', label: '72 hours', halfLifeSec: 259_200, maxWindowSec: maxWindowSec(259_200) },
  { id: '7d', label: '7 days', halfLifeSec: 604_800, maxWindowSec: maxWindowSec(604_800) },
] as const;

export const BPS = 10_000;
export const PPM = 1_000_000;
export const PPB = 1_000_000_000;
export const BPS_BIG = 10_000n;
export const PPM_BIG = 1_000_000n;
export const PPB_BIG = 1_000_000_000n;
