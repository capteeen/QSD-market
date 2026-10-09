/**
 * Decay and the Zeno mechanic.
 *
 * A coin's quiet time is t = now − lastActivityAt. Survival over quiet time t
 * is 2^(−t/T) for half-life T; the probability mass that has already decayed
 * is
 *
 *     decayProgress(t) = 1 − 2^(−t/T)          clamped to [0, 1]
 *
 * It is a half-life, not a timer: nothing happens at t = T. The number only
 * becomes an event when a measurement resolves it — at that moment the
 * collapse probability equals decayProgress.
 *
 * Buys (the Zeno mechanic) and survives do not touch decayProgress directly;
 * they remove a fraction of the accumulated quiet time by moving
 * lastActivityAt forward. Every function here is pure and takes `now`.
 */
import { InvalidStateError, ProtocolError } from './errors.js';
import { BPS, BPS_BIG, PPB, PROTOCOL_PARAMS, maxWindowSec } from './params.js';
import type { Coin, CoinState, UnixSeconds } from './types.js';

/** States in which the coin is decaying and may be measured. */
export const MEASURABLE_STATES: readonly CoinState[] = ['superposed', 'measured-alive', 'tunnelled'];

export function isMeasurable(state: CoinState): boolean {
  return MEASURABLE_STATES.includes(state);
}

function assertTime(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 0) throw new ProtocolError(`${name} must be a non-negative integer (unix seconds), got ${String(v)}`);
}

export function assertHalfLife(halfLifeSec: number): void {
  if (!Number.isInteger(halfLifeSec) || halfLifeSec <= 0) {
    throw new ProtocolError(`halfLifeSec must be a positive integer, got ${String(halfLifeSec)}`);
  }
}

/** Quiet seconds accumulated at `now`. Never negative; a `now` before lastActivityAt counts as 0. */
export function quietSeconds(coin: Pick<Coin, 'lastActivityAt'>, now: UnixSeconds): number {
  assertTime('now', now);
  assertTime('lastActivityAt', coin.lastActivityAt);
  return Math.max(0, now - coin.lastActivityAt);
}

/** 1 − 2^(−t/T) for raw numbers, clamped to [0, 1]. */
export function decayProgressFor(quietSec: number, halfLifeSec: number): number {
  assertHalfLife(halfLifeSec);
  if (!(quietSec >= 0)) return 0;
  const p = 1 - Math.pow(2, -quietSec / halfLifeSec);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/**
 * Live decay progress. For a collapsed coin it is 1; for any measurable
 * state it is 1 − 2^(−quiet/T).
 */
export function decayProgress(coin: Pick<Coin, 'lastActivityAt' | 'halfLifeSec' | 'state'>, now: UnixSeconds): number {
  if (coin.state === 'collapsed') return 1;
  return decayProgressFor(quietSeconds(coin, now), coin.halfLifeSec);
}

/**
 * decayProgress as an integer in parts per billion (floor), the form that is
 * hashed into a measurement's inputs. Independent re-computation on another
 * JS engine may differ by 1 ppb because Math.pow is not bit-exact across
 * engines; verifiers should allow that.
 */
export function decayProgressPpb(coin: Pick<Coin, 'lastActivityAt' | 'halfLifeSec' | 'state'>, now: UnixSeconds): number {
  const p = decayProgress(coin, now);
  const ppb = Math.floor(p * PPB);
  return ppb < 0 ? 0 : ppb > PPB ? PPB : ppb;
}

/** Time at which the protocol will measure the coin if nobody else has. `null` once collapsed. */
export function nextAutoMeasureAt(coin: Pick<Coin, 'lastActivityAt' | 'halfLifeSec' | 'state'>): UnixSeconds | null {
  if (!isMeasurable(coin.state)) return null;
  return coin.lastActivityAt + maxWindowSec(coin.halfLifeSec);
}

/** True when the auto-measurement window has elapsed at `now`. */
export function isAutoMeasureDue(coin: Pick<Coin, 'lastActivityAt' | 'halfLifeSec' | 'state'>, now: UnixSeconds): boolean {
  const at = nextAutoMeasureAt(coin);
  return at !== null && now >= at;
}

/**
 * Fraction of quiet time a buy removes, in basis points:
 *     min(ZENO_RESET_CAP_BPS, ZENO_K × buy / marketCap × 10 000)
 * Exact integer arithmetic; the division floors.
 */
export function zenoResetBps(buyLamports: bigint, marketCapLamports: bigint): number {
  if (buyLamports < 0n) throw new ProtocolError('buyLamports must be >= 0');
  if (marketCapLamports <= 0n) throw new ProtocolError('marketCapLamports must be > 0');
  const raw = (BigInt(PROTOCOL_PARAMS.ZENO_K) * buyLamports * BPS_BIG) / marketCapLamports;
  const cap = BigInt(PROTOCOL_PARAMS.ZENO_RESET_CAP_BPS);
  return Number(raw < cap ? raw : cap);
}

/**
 * Move the quiet-clock origin forward by `fractionBps` of the quiet time
 * accumulated at `now` (floored to whole seconds). Shared by buys and survives.
 */
export function resetQuietTime(coin: Pick<Coin, 'lastActivityAt'>, now: UnixSeconds, fractionBps: number): UnixSeconds {
  if (!Number.isInteger(fractionBps) || fractionBps < 0 || fractionBps > BPS) {
    throw new ProtocolError(`fractionBps must be an integer in 0..${BPS}, got ${String(fractionBps)}`);
  }
  const quiet = quietSeconds(coin, now);
  const removed = Math.floor((quiet * fractionBps) / BPS);
  return coin.lastActivityAt + removed;
}

/**
 * Zeno mechanic: a buy is a weak measurement that removes
 * min(cap, k × buy/marketCap) of the quiet time. Returns a new Coin; the
 * transient states 'measured-alive' and 'tunnelled' settle back to
 * 'superposed' on activity. Throws for a collapsed coin.
 */
export function applyBuy(coin: Coin, buyLamports: bigint, marketCapLamports: bigint, now: UnixSeconds): Coin {
  if (!isMeasurable(coin.state)) {
    throw new InvalidStateError(`cannot apply a buy to a coin in state '${coin.state}'`, coin.state);
  }
  const bps = zenoResetBps(buyLamports, marketCapLamports);
  const lastActivityAt = resetQuietTime(coin, now, bps);
  const next: Coin = { ...coin, state: 'superposed', lastActivityAt };
  return { ...next, decayProgress: decayProgress(next, now) };
}
