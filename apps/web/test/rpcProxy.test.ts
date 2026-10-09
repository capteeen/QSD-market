// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { rpcProxyAllows } = await import('@/server/rpcProxy');

describe('rpcProxyAllows', () => {
  it('relays the calls a wallet payment needs and nothing else', () => {
    expect(rpcProxyAllows({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash' })).toBe(true);
    expect(rpcProxyAllows([{ method: 'getSignatureStatuses' }, { method: 'sendTransaction' }])).toBe(true);
    expect(rpcProxyAllows({ method: 'getProgramAccounts' })).toBe(false);
    expect(rpcProxyAllows([{ method: 'getBalance' }, { method: 'getProgramAccounts' }])).toBe(false);
    expect(rpcProxyAllows([])).toBe(false);
    expect(rpcProxyAllows(Array.from({ length: 11 }, () => ({ method: 'getBalance' })))).toBe(false);
    expect(rpcProxyAllows(null)).toBe(false);
  });
});
