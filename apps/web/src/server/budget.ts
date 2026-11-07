import 'server-only';

/**
 * Fixed-window spend limits for work the deployer wallet pays for.
 * Redis when REDIS_URL is set, so serverless instances share a counter;
 * otherwise this process's memory. Defaults are the limits that ship.
 * An env override can raise a limit up to a hard cap, never remove it.
 */

const mem = new Map<string, number>();

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const CHALLENGE_WINDOW_MS = 10 * 60 * 1000;

export const LAUNCH_IP_LIMIT_MESSAGE = 'too many launches from this network; try again later';
export const LAUNCH_WALLET_LIMIT_MESSAGE = 'too many launches from this wallet; try again tomorrow';
export const LAUNCH_GLOBAL_LIMIT_MESSAGE = 'too many launches right now; try again tomorrow';
export const MEASURE_LIMIT_MESSAGE = 'too many measurements; try again later';
export const CHALLENGE_LIMIT_MESSAGE = 'too many challenge requests; try again later';

/** Clears in-memory windows. Routes never call this. */
export function resetSpendBudget(): void {
  mem.clear();
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = fwd || req.headers.get('x-real-ip')?.trim() || 'unknown';
  return ip.slice(0, 64);
}

function cap(envName: string, fallback: number, max: number): number {
  const raw = process.env[envName]?.trim() ?? '';
  if (!/^[1-9]\d*$/.test(raw)) return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return fallback;
  return Math.min(n, max);
}

/** Launches one wallet may start per day. Default 1, hard cap 24. */
export function launchWalletLimit(): number {
  return cap('LAUNCH_MAX_PER_WALLET', 1, 24);
}

/** Launches the whole app may start per day. Default 8, hard cap 48. */
export function launchGlobalLimit(): number {
  return cap('LAUNCH_MAX_GLOBAL', 8, 48);
}

/** Launch posts one IP may make per hour. Default 3, hard cap 30. */
export function launchIpLimit(): number {
  return cap('LAUNCH_MAX_PER_IP', 3, 30);
}

/** Measurements one wallet may run per hour. Default 4, hard cap 24. */
export function measureWalletLimit(): number {
  return cap('MEASURE_MAX_PER_WALLET', 4, 24);
}

/** Measurements the whole app may run per hour. Default 20, hard cap 200. */
export function measureGlobalLimit(): number {
  return cap('MEASURE_MAX_GLOBAL', 20, 200);
}

/** Measurement posts one IP may make per hour. Default 8, hard cap 60. */
export function measureIpLimit(): number {
  return cap('MEASURE_MAX_PER_IP', 8, 60);
}

/** Challenge posts one IP may make per 10 minutes. Default 20, hard cap 120. */
export function challengeIpLimit(): number {
  return cap('CHALLENGE_MAX_PER_IP', 20, 120);
}

/** Challenge posts the whole app may make per 10 minutes. Default 200, hard cap 2000. */
export function challengeGlobalLimit(): number {
  return cap('CHALLENGE_MAX_GLOBAL', 200, 2000);
}

function storageKey(name: string, windowMs: number, now: number): string {
  return `qsd:spend:${name}:${Math.floor(now / windowMs)}`;
}

async function redisCount(key: string, add: number): Promise<number | null> {
  if (!process.env.REDIS_URL) return null;
  try {
    const { redis } = await import('./redis');
    const r = redis();
    if (r.status === 'wait') await r.connect();
    if (add === 0) {
      const v = await r.get(key);
      return v ? Number(v) : 0;
    }
    const n = await r.incrby(key, add);
    if (n === add) await r.expire(key, 60 * 60 * 26);
    return n;
  } catch {
    return null;
  }
}

/** Current count in the window, without incrementing. */
export async function budgetUsed(name: string, windowMs: number, now = Date.now()): Promise<number> {
  const key = storageKey(name, windowMs, now);
  const fromRedis = await redisCount(key, 0);
  if (fromRedis !== null) return fromRedis;
  return mem.get(key) ?? 0;
}

/** True when another spend would still be inside `limit`. */
export async function budgetOpen(name: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  return (await budgetUsed(name, windowMs, now)) < limit;
}

/**
 * Counts one spend. Returns true while the window is within `limit`.
 * A refused call still counts, so a flood stays closed until the window rolls.
 */
export async function spendBudget(name: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  const key = storageKey(name, windowMs, now);
  const fromRedis = await redisCount(key, 1);
  if (fromRedis !== null) return fromRedis <= limit;
  if (mem.size > 20_000) mem.clear();
  const n = (mem.get(key) ?? 0) + 1;
  mem.set(key, n);
  return n <= limit;
}

/** Challenge issuance cap shared by launch and measure. False when either window is full. */
export async function takeChallengeBudget(ip: string): Promise<boolean> {
  if (!(await spendBudget(`challenge:ip:${ip}`, challengeIpLimit(), CHALLENGE_WINDOW_MS))) return false;
  return spendBudget('challenge:global', challengeGlobalLimit(), CHALLENGE_WINDOW_MS);
}
