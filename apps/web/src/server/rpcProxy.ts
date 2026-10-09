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
