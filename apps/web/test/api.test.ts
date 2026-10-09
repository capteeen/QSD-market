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

  it('rejects a missing or wrong Authorization header', async () => {
    const { POST } = await import('@/app/api/webhooks/helius/route');
    expect((await POST(post('/api/webhooks/helius', fixture.payload))).status).toBe(401);
    expect((await POST(post('/api/webhooks/helius', fixture.payload, { authorization: 'wrong' }))).status).toBe(401);
    expect(ingestBuy).not.toHaveBeenCalled();
  });

  it('stores a trade from the documented fixture shape', async () => {
    const { POST } = await import('@/app/api/webhooks/helius/route');
    const res = await POST(post('/api/webhooks/helius', fixture.payload, { authorization: 'test-secret' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { received: number; stored: number };
    expect(body.received).toBeGreaterThan(0);
    expect(body.stored).toBe(body.received);
    const buy = ingestBuy.mock.calls[0]![0] as unknown as { mint: string; buyer: string; lamports: bigint; signature: string };
    expect(buy.mint).toBe('DUSTawucrTsGU8hcqRdHDCbuYhCPADMLM2VcCb8VnFnQ');
    expect(buy.buyer).toBe('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    expect(buy.lamports).toBe(500000000n);
    expect(buy.signature).toMatch(/^5h6xBEau/);
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
