/**
 * Agent H — the Helius trade webhook (SPEC §9 l.391-393): constant-time auth,
 * 401 on bad auth, idempotent on duplicate delivery. The REAL route handler,
 * trades.ts (ingestBuy + Zeno reset through @qsd/protocol applyBuy),
 * events.ts and coins.ts run against the in-memory Prisma stand-in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  it('auth: missing, empty, wrong, prefix, suffix, case-different and unset-secret all → 401 and nothing is stored', async () => {
    const { POST } = await import('@/app/api/webhooks/helius/route');
    await seedCoin();
    for (const h of [undefined, '', 'wrong', 'agent-h-webhook-secre', 'agent-h-webhook-secretX', 'AGENT-H-WEBHOOK-SECRET', 'Bearer agent-h-webhook-secret']) {
      const r = await POST(post(delivery, h));
      expect(r.status, `auth=${String(h)}`).toBe(401);
    }
    delete process.env.QSD_WEBHOOK_SECRET;
    expect((await POST(post(delivery, 'agent-h-webhook-secret'))).status).toBe(401);
    expect(fakeDb.trade.rows.length).toBe(0);
    expect(fakeDb.eventLog.rows.length).toBe(0);
  });

  it('auth is compared in constant time (the comparison in @qsd/solana is timingSafeEqual over equal-length buffers; no `===` on the secret) — source', () => {
    const src = readFileSync(path.join(ROOT, 'packages/solana/src/webhooks.ts'), 'utf8');
    expect(src).toMatch(/timingSafeEqual/);
    expect(src).not.toMatch(/secret\s*===|===\s*secret|authHeader\s*===|===\s*authHeader/);
  });

  it('a malformed body → 400, not 500; a non-array JSON body → 400', async () => {
    const { POST } = await import('@/app/api/webhooks/helius/route');
    expect((await POST(post('{not json', 'agent-h-webhook-secret'))).status).toBe(400);
    expect((await POST(post({ a: 1 }, 'agent-h-webhook-secret'))).status).toBe(400);
  });

  it('one delivery → exactly one Trade, one BalanceChange, one trade log entry, the Zeno reset applied once', async () => {
    const { POST } = await import('@/app/api/webhooks/helius/route');
    await seedCoin();
    const before = fakeDb.coin.rows[0]!['lastActivityAt'] as number;
    const r = await POST(post(delivery, 'agent-h-webhook-secret'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ received: 1, stored: 1, applied: 1, queued: 0 });
    expect(fakeDb.trade.rows.length).toBe(1);
    // tokenUnits is null: the parser takes the ui amount from tokenTransfers and does not read accountData.rawTokenAmount; the units are recomputed from ui × 10^decimals
    expect(fakeDb.trade.rows[0]).toMatchObject({ signature: SIG, mint: MINT, buyer: BUYER, lamports: 250_000_000n, tokenUnits: null, tokenUiAmount: 1000, at: 1_700_003_600 });
    expect(fakeDb.balanceChange.rows.length).toBe(1);
    expect(fakeDb.balanceChange.rows[0]).toMatchObject({ kind: 'buy', wallet: BUYER, deltaUnits: 1_000_000_000n });
    expect(fakeDb.eventLog.rows.map((e) => e['type'])).toEqual(['trade']);
    const after = fakeDb.coin.rows[0]!['lastActivityAt'] as number;
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThanOrEqual(1_700_003_600);
  });

  it('the SAME delivery twice (Helius retry) → still one Trade row, one BalanceChange, one log entry, the coin unchanged by the second', async () => {
    const { POST } = await import('@/app/api/webhooks/helius/route');
    await seedCoin();
    await POST(post(delivery, 'agent-h-webhook-secret'));
    const snapshot = JSON.stringify(fakeDb.coin.rows[0], (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    const r2 = await POST(post(delivery, 'agent-h-webhook-secret'));
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ received: 1, stored: 0, applied: 0, queued: 0 });
    expect(fakeDb.trade.rows.length).toBe(1);
    expect(fakeDb.balanceChange.rows.length).toBe(1);
    expect(fakeDb.eventLog.rows.length).toBe(1);
    expect(JSON.stringify(fakeDb.coin.rows[0], (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(snapshot);
  });

  it('two CONCURRENT identical deliveries → one Trade row (the unique index catches the race; the second is reported, not stored twice)', async () => {
    const { POST } = await import('@/app/api/webhooks/helius/route');
    await seedCoin();
    const origFind = fakeDb.trade.findUnique.bind(fakeDb.trade);
    fakeDb.trade.findUnique = async (args) => {
      await new Promise((r) => setImmediate(r));
      return origFind(args);
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const [a, b] = await Promise.all([POST(post(delivery, 'agent-h-webhook-secret')), POST(post(delivery, 'agent-h-webhook-secret'))]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(fakeDb.trade.rows.length).toBe(1);
    expect(fakeDb.balanceChange.rows.length).toBe(1);
    err.mockRestore();
  });

  it('a buy of a coin the protocol does not know is ignored, not invented', async () => {
    const { POST } = await import('@/app/api/webhooks/helius/route');
    const r = await POST(post(delivery, 'agent-h-webhook-secret'));
    expect(await r.json()).toEqual({ received: 1, stored: 0, applied: 0, queued: 0 });
    expect(fakeDb.trade.rows.length).toBe(0);
    expect(fakeDb.coin.rows.length).toBe(0);
  });
});
