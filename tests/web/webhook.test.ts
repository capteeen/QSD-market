/**
 * The old Helius webhook is not an Elysium indexer. The route must refuse
 * every delivery, write nothing, and the Solana package's auth comparison
 * stays constant-time for the code that still exists there.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { fakeDb } from './fakeDb';

const g = globalThis as unknown as { __qsdPrisma?: unknown };
const ROOT = path.resolve(__dirname, '../..');

// A delivery of Agent H's own shape (Helius enhanced-transaction fields as documented), not the package fixture.
const MINT = 'MintAgentH11111111111111111111111111111111111';
const BUYER = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const SIG = '3'.repeat(87);
const delivery = [
  {
    description: 'buy',
    type: 'SWAP',
    source: 'PUMP_FUN',
    fee: 5000,
    feePayer: BUYER,
    signature: SIG,
    slot: 300_000_000,
    timestamp: 1_700_003_600,
    nativeTransfers: [{ amount: 250_000_000, fromUserAccount: BUYER, toUserAccount: 'PoolAgentH1111111111111111111111111111111111' }],
    tokenTransfers: [{ fromUserAccount: 'PoolAgentH1111111111111111111111111111111111', toUserAccount: BUYER, tokenAmount: 1000, mint: MINT, tokenStandard: 'Fungible' }],
    accountData: [{ account: BUYER, nativeBalanceChange: -250_005_000, tokenBalanceChanges: [{ userAccount: BUYER, tokenAccount: 'TokAgentH111111111111111111111111111111111111', mint: MINT, rawTokenAmount: { tokenAmount: '1000000000', decimals: 6 } }] }],
  },
];

async function seedCoin(): Promise<void> {
  await fakeDb.coin.create({
    data: {
      ca: MINT, name: 'PHOTON', ticker: 'PHO', imageUri: '', imageHash: 'ab'.repeat(32), imageLineage: 'cd'.repeat(32), lineageId: 'l', generation: 1, identityRoot: 'ef'.repeat(32), halfLifeSec: 3600, decayProgress: 0,
      supplyMin: 1n, supplyMax: 2n, totalUnits: 1_000_000_000_000n, remainingUnits: 1_000_000_000_000n, decimals: 6, state: 'superposed', lastActivityAt: 1_700_000_000, bornAt: 1_700_000_000, launchPath: 'devnet-spl', launchTx: 'x',
    },
  });
}

const post = (body: unknown, auth?: string) =>
  new NextRequest('http://localhost/api/webhooks/helius', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', ...(auth !== undefined ? { authorization: auth } : {}) } });

beforeEach(() => {
  fakeDb.reset();
  delete g.__qsdPrisma;
  delete process.env.REDIS_URL;
  process.env.QSD_WEBHOOK_SECRET = 'agent-h-webhook-secret';
});

describe('POST /api/webhooks/helius', () => {
  it('a well-formed Helius delivery, with or without the old secret, is refused and stores nothing', async () => {
    const { POST } = await import('@/app/api/webhooks/helius/route');
    await seedCoin();
    const before = JSON.stringify(fakeDb.coin.rows[0], (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    for (const h of [undefined, '', 'wrong', 'agent-h-webhook-secret']) {
      const r = await POST(post(delivery, h));
      expect(r.status, `auth=${String(h)}`).toBe(501);
      expect(await r.json()).toEqual({ error: 'Trade indexing is not configured. No trade was stored.' });
    }
    expect(fakeDb.trade.rows.length).toBe(0);
    expect(fakeDb.balanceChange.rows.length).toBe(0);
    expect(fakeDb.eventLog.rows.length).toBe(0);
    expect(JSON.stringify(fakeDb.coin.rows[0], (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(before);
  });

  it('auth is compared in constant time (the comparison in @qsd/solana is timingSafeEqual over equal-length buffers; no `===` on the secret) — source', () => {
    const src = readFileSync(path.join(ROOT, 'packages/solana/src/webhooks.ts'), 'utf8');
    expect(src).toMatch(/timingSafeEqual/);
    expect(src).not.toMatch(/secret\s*===|===\s*secret|authHeader\s*===|===\s*authHeader/);
  });

  it('a malformed body and a non-array body are also refused, and invent no coin', async () => {
    const { POST } = await import('@/app/api/webhooks/helius/route');
    expect((await POST(post('{not json', 'agent-h-webhook-secret'))).status).toBe(501);
    expect((await POST(post({ a: 1 }, 'agent-h-webhook-secret'))).status).toBe(501);
    expect(fakeDb.trade.rows.length).toBe(0);
    expect(fakeDb.coin.rows.length).toBe(0);
  });

  it('two concurrent deliveries of a known coin still write nothing', async () => {
    const { POST } = await import('@/app/api/webhooks/helius/route');
    await seedCoin();
    const [a, b] = await Promise.all([POST(post(delivery, 'agent-h-webhook-secret')), POST(post(delivery, 'agent-h-webhook-secret'))]);
    expect(a.status).toBe(501);
    expect(b.status).toBe(501);
    expect(fakeDb.trade.rows.length).toBe(0);
    expect(fakeDb.balanceChange.rows.length).toBe(0);
    expect(fakeDb.eventLog.rows.length).toBe(0);
  });

  it('a buy of a coin the protocol does not know is not invented', async () => {
    const { POST } = await import('@/app/api/webhooks/helius/route');
    const r = await POST(post(delivery, 'agent-h-webhook-secret'));
    expect(r.status).toBe(501);
    expect(fakeDb.trade.rows.length).toBe(0);
    expect(fakeDb.coin.rows.length).toBe(0);
  });
});
