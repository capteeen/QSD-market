import 'server-only';

/** JSON-RPC methods the browser may relay through /api/rpc: what a wallet payment and its confirmation use. */
export const RPC_PROXY_METHODS: ReadonlySet<string> = new Set([
  'getLatestBlockhash',
  'getFeeForMessage',
  'getSignatureStatuses',
  'getBlockHeight',
  'getBalance',
  'getAccountInfo',
  'getMinimumBalanceForRentExemption',
  'simulateTransaction',
  'sendTransaction',
  'isBlockhashValid',
]);

/** True when `body` is one JSON-RPC call (or a batch of at most 10) using only relayed methods. */
export function rpcProxyAllows(body: unknown): boolean {
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 10) return false;
  return calls.every((c) => typeof c === 'object' && c !== null && RPC_PROXY_METHODS.has(String((c as { method?: unknown }).method)));
}

/** Relayed calls allowed per client IP per minute. A launch payment needs about 30 (blockhash, send, ~90 s of status polls). */
export const RPC_PROXY_PER_MINUTE = 60;

const local = new Map<string, number>();

/**
 * Per-IP fixed-window counter: Redis when configured (shared across serverless
 * instances), else this instance's memory. Returns true while `ip` is within
 * RPC_PROXY_PER_MINUTE calls this minute.
 */
export async function rpcProxyWithinLimit(ip: string, calls: number, now = Date.now()): Promise<boolean> {
  const key = `qsd:rpc:${ip}:${Math.floor(now / 60_000)}`;
  if (process.env.REDIS_URL) {
    try {
      const { redis } = await import('./redis');
      const r = redis();
      const n = await r.incrby(key, calls);
      if (n === calls) await r.expire(key, 120);
      return n <= RPC_PROXY_PER_MINUTE;
    } catch {
      // fall through to the in-memory window
    }
  }
  if (local.size > 10_000) local.clear();
  const n = (local.get(key) ?? 0) + calls;
  local.set(key, n);
  return n <= RPC_PROXY_PER_MINUTE;
}
