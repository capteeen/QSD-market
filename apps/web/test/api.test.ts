import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

const ingestBuy = vi.fn(async (_buy: unknown) => ({ stored: true, applied: true }));
const enqueue = vi.fn(async () => undefined);
vi.mock('@/server/trades', () => ({ ingestBuy }));
vi.mock('@/server/queues', () => ({ enqueue }));
vi.mock('@/server/db', () => ({ isDbUnavailable: () => false, db: () => ({}), dbUnavailableReason: () => 'x' }));

const verifyChallenge = vi.fn();
vi.mock('@/server/auth', () => ({ AuthError: class AuthError extends Error {}, verifyChallenge }));
vi.mock('@/server/measure', () => ({ MeasureError: class MeasureError extends Error {}, performMeasurement: vi.fn() }));
vi.mock('@/server/coins', () => ({ coinToDto: vi.fn(), loadCoin: vi.fn(), measurementToDto: vi.fn() }));
vi.mock('@/server/chain', () => ({ chainStatus: () => ({ configured: false, cluster: null, reason: 'unset' }) }));
vi.mock('@/server/qrng', () => ({ qrngStatus: () => ({ configured: false, providerId: null, reason: 'unset' }) }));

const fixture = JSON.parse(readFileSync(path.resolve(__dirname, '../../../packages/solana/test/fixtures/helius-enhanced-swap.json'), 'utf8')) as { payload: unknown[] };

function post(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
}

describe('POST /api/webhooks/helius', () => {
  beforeEach(() => {
    ingestBuy.mockClear();
    process.env.QSD_WEBHOOK_SECRET = 'test-secret';
  });

  it('refuses a Helius delivery with or without the old secret, and stores nothing', async () => {
    const { POST } = await import('@/app/api/webhooks/helius/route');
    for (const headers of [{}, { authorization: 'wrong' }, { authorization: 'test-secret' }]) {
      const res = await POST(post('/api/webhooks/helius', fixture.payload, headers));
      expect(res.status).toBe(501);
      expect(await res.json()).toEqual({ error: 'Trade indexing is not configured. No trade was stored.' });
    }
    expect(ingestBuy).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('POST /api/measure', () => {
  it('refuses without wallet authentication', async () => {
    const { POST } = await import('@/app/api/measure/route');
    const res = await POST(post('/api/measure', { ca: 'So11111111111111111111111111111111111111112' }));
    expect(res.status).toBe(401);
    expect(verifyChallenge).not.toHaveBeenCalled();
  });

  it('refuses a signature that does not verify', async () => {
    const { AuthError } = await import('@/server/auth');
    verifyChallenge.mockRejectedValueOnce(new AuthError('signature does not verify for this wallet'));
    const { POST } = await import('@/app/api/measure/route');
    const res = await POST(post('/api/measure', { ca: 'x', wallet: 'w', nonce: 'n', signature: 'deadbeef' }));
    expect(res.status).toBe(401);
  });
});
