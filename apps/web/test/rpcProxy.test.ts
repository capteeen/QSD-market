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

describe('rpcProxyWithinLimit', () => {
  it('allows 60 calls per IP per minute, then refuses until the next minute', async () => {
    delete process.env.REDIS_URL;
    const { rpcProxyWithinLimit, RPC_PROXY_PER_MINUTE } = await import('@/server/rpcProxy');
    const t = 1_700_000_000_000;
    for (let i = 0; i < RPC_PROXY_PER_MINUTE; i++) expect(await rpcProxyWithinLimit('1.2.3.4', 1, t)).toBe(true);
    expect(await rpcProxyWithinLimit('1.2.3.4', 1, t)).toBe(false);
    expect(await rpcProxyWithinLimit('5.6.7.8', 1, t)).toBe(true);
    expect(await rpcProxyWithinLimit('1.2.3.4', 1, t + 60_000)).toBe(true);
  });
});
