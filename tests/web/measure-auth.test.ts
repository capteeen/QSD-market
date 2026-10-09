/**
 * Agent H — measurement API security (SPEC §8 /coin MEASURE, §9 l.391-393,
 * README "POST /api/measure/challenge … single use"). The REAL auth.ts,
 * measure.ts (verifyOptions / performMeasurement), qrng.ts and the route
 * handlers run against the in-memory Prisma stand-in; signatures are made
 * with a real Ed25519 key (@noble/curves), wallets are its base58 public key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { NextRequest } from 'next/server';
import { fakeDb } from './fakeDb';

const g = globalThis as unknown as { __qsdPrisma?: unknown; __qsdChain?: unknown; __qsdQrng?: unknown };

// The chain is not reachable in this sandbox; only `chainStatus` / `getChain` are needed and are controlled per test.
const chainMock = { configured: false as boolean, getChainCalls: 0 };
vi.mock('@/server/chain', () => ({
  chainStatus: () => (chainMock.configured ? { configured: true, cluster: 'devnet', reason: null } : { configured: false, cluster: null, reason: 'agent h: no chain' }),
  getChain: () => {
    chainMock.getChainCalls++;
    throw new Error('agent h: getChain must not be reached by this test');
  },
  serverCluster: () => 'devnet',
}));

const sk = new Uint8Array(32).fill(5);
const pk = ed25519.getPublicKey(sk);
const WALLET = bs58.encode(pk);
const CA = 'So11111111111111111111111111111111111111112';
const sign = (msg: string): string => Buffer.from(ed25519.sign(new TextEncoder().encode(msg), sk)).toString('hex');

beforeEach(() => {
  fakeDb.reset();
  delete g.__qsdPrisma;
  delete g.__qsdQrng;
  delete g.__qsdChain;
  chainMock.configured = false;
  chainMock.getChainCalls = 0;
  Object.assign(process.env, { NODE_ENV: 'test' });
  process.env.QSD_QRNG_PROVIDER = 'UNSAFE_DEV_RANDOM';
  delete process.env.QSD_WITNESS_PUBLIC_KEYS;
});
afterEach(() => vi.useRealTimers());

describe('challenge / signature (auth.ts)', () => {
  it('happy path: the wallet signs the exact challenge message; the nonce is consumed', async () => {
    const { issueChallenge, verifyChallenge } = await import('@/server/auth');
    const ch = await issueChallenge('measure', WALLET, CA);
    expect(ch.message).toBe(`qsd.market\npurpose: measure\nwallet: ${WALLET}\nsubject: ${CA}\nnonce: ${ch.nonce}`);
    expect(ch.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(Date.parse(ch.expiresAt) - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
    await expect(verifyChallenge({ purpose: 'measure', wallet: WALLET, subject: CA, nonce: ch.nonce, signature: sign(ch.message) })).resolves.toBeUndefined();
    expect(fakeDb.authChallenge.rows[0]!['usedAt']).toBeInstanceOf(Date);
  });

  it('replay of a used challenge is rejected', async () => {
    const { issueChallenge, verifyChallenge, AuthError } = await import('@/server/auth');
    const ch = await issueChallenge('measure', WALLET, CA);
    const sig = sign(ch.message);
    await verifyChallenge({ purpose: 'measure', wallet: WALLET, subject: CA, nonce: ch.nonce, signature: sig });
    await expect(verifyChallenge({ purpose: 'measure', wallet: WALLET, subject: CA, nonce: ch.nonce, signature: sig })).rejects.toThrow(AuthError);
    await expect(verifyChallenge({ purpose: 'measure', wallet: WALLET, subject: CA, nonce: ch.nonce, signature: sig })).rejects.toThrow(/already used/);
  });

  it('an expired challenge is rejected even with a valid signature', async () => {
    const { issueChallenge, verifyChallenge, CHALLENGE_TTL_MS } = await import('@/server/auth');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
    const ch = await issueChallenge('measure', WALLET, CA);
    vi.setSystemTime(new Date(Date.parse('2026-10-09T10:00:00Z') + CHALLENGE_TTL_MS + 1));
    await expect(verifyChallenge({ purpose: 'measure', wallet: WALLET, subject: CA, nonce: ch.nonce, signature: sign(ch.message) })).rejects.toThrow(/expired/);
    expect(fakeDb.authChallenge.rows[0]!['usedAt']).toBeNull();
  });

  it('the signature must be by the CLAIMED wallet over the EXACT message: another key, another wallet, another coin, another purpose, a changed nonce, a malformed signature are all rejected', async () => {
    const { issueChallenge, verifyChallenge } = await import('@/server/auth');
    const ch = await issueChallenge('measure', WALLET, CA);
    const otherSk = new Uint8Array(32).fill(9);
    const otherWallet = bs58.encode(ed25519.getPublicKey(otherSk));
    const signWith = (k: Uint8Array, msg: string) => Buffer.from(ed25519.sign(new TextEncoder().encode(msg), k)).toString('hex');
    const cases: { name: string; args: Parameters<typeof verifyChallenge>[0]; re: RegExp }[] = [
      { name: 'another key signs for the claimed wallet', args: { purpose: 'measure', wallet: WALLET, subject: CA, nonce: ch.nonce, signature: signWith(otherSk, ch.message) }, re: /does not verify/ },
      { name: 'another wallet claims the challenge', args: { purpose: 'measure', wallet: otherWallet, subject: CA, nonce: ch.nonce, signature: signWith(otherSk, ch.message.replace(WALLET, otherWallet)) }, re: /unknown challenge/ },
      { name: 'the message is for another coin', args: { purpose: 'measure', wallet: WALLET, subject: 'OtherCoin1111111111111111111111111111111111', nonce: ch.nonce, signature: sign(ch.message) }, re: /does not verify/ },
      { name: 'another purpose', args: { purpose: 'launch', wallet: WALLET, subject: CA, nonce: ch.nonce, signature: sign(ch.message) }, re: /unknown challenge/ },
      { name: 'a nonce that was never issued', args: { purpose: 'measure', wallet: WALLET, subject: CA, nonce: 'f'.repeat(32), signature: sign(ch.message) }, re: /unknown challenge/ },
      { name: 'the signature covers a different nonce', args: { purpose: 'measure', wallet: WALLET, subject: CA, nonce: ch.nonce, signature: sign(ch.message.replace(ch.nonce, 'e'.repeat(32))) }, re: /does not verify/ },
      { name: 'malformed signature', args: { purpose: 'measure', wallet: WALLET, subject: CA, nonce: ch.nonce, signature: 'not-hex-not-base58-0OIl' }, re: /malformed/ },
      { name: 'empty signature', args: { purpose: 'measure', wallet: WALLET, subject: CA, nonce: ch.nonce, signature: '' }, re: /required/ },
      { name: 'signature of the wrong length', args: { purpose: 'measure', wallet: WALLET, subject: CA, nonce: ch.nonce, signature: 'ab'.repeat(10) }, re: /does not verify|malformed/ },
    ];
    for (const c of cases) await expect(verifyChallenge(c.args), c.name).rejects.toThrow(c.re);
    // none of those consumed the nonce; the honest signature still works exactly once
    expect(fakeDb.authChallenge.rows[0]!['usedAt']).toBeNull();
    await expect(verifyChallenge({ purpose: 'measure', wallet: WALLET, subject: CA, nonce: ch.nonce, signature: sign(ch.message) })).resolves.toBeUndefined();
  });

  it('FINDING H-W6 (MEDIUM): nonce consumption is check-then-set (findUnique … update), not an atomic conditional update — two concurrent requests with the same signed challenge both pass', async () => {
    const { issueChallenge, verifyChallenge } = await import('@/server/auth');
    const ch = await issueChallenge('measure', WALLET, CA);
    const sig = sign(ch.message);
    // Two real Postgres round trips: each read returns a SNAPSHOT of the row and takes time; each write takes time.
    const origFind = fakeDb.authChallenge.findUnique.bind(fakeDb.authChallenge);
    fakeDb.authChallenge.findUnique = async (args) => {
      const row = await origFind(args);
      const snapshot = row ? { ...row } : row;
      await new Promise((r) => setImmediate(r));
      return snapshot;
    };
    const origUpdate = fakeDb.authChallenge.update.bind(fakeDb.authChallenge);
    fakeDb.authChallenge.update = async (args) => {
      await new Promise((r) => setImmediate(r));
      return origUpdate(args);
    };
    const results = await Promise.allSettled([
      verifyChallenge({ purpose: 'measure', wallet: WALLET, subject: CA, nonce: ch.nonce, signature: sig }),
      verifyChallenge({ purpose: 'measure', wallet: WALLET, subject: CA, nonce: ch.nonce, signature: sig }),
    ]);
    const accepted = results.filter((r) => r.status === 'fulfilled').length;
    expect(accepted).toBe(1);
  });
});

describe('POST /api/measure and /api/measure/challenge', () => {
  const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

  it('challenge: refuses a missing or invalid wallet; issues a single-use nonce otherwise', async () => {
    const { POST } = await import('@/app/api/measure/challenge/route');
    expect((await POST(post('/api/measure/challenge', {}))).status).toBe(400);
    expect((await POST(post('/api/measure/challenge', { wallet: 'nope', ca: CA }))).status).toBe(400);
    const ok = await POST(post('/api/measure/challenge', { wallet: WALLET, ca: CA }));
    expect(ok.status).toBe(200);
    expect(fakeDb.authChallenge.rows.length).toBe(1);
  });

  it('measure: without wallet auth → 401 before anything else; a bad signature → 401; a valid signature on a coin that does not exist → 409 (the nonce is spent)', async () => {
    const { issueChallenge } = await import('@/server/auth');
    const { POST } = await import('@/app/api/measure/route');
    expect((await POST(post('/api/measure', { ca: CA }))).status).toBe(401);
    expect((await POST(post('/api/measure', { ca: CA, wallet: WALLET, nonce: 'x', signature: 'y' }))).status).toBe(401);
    const ch = await issueChallenge('measure', WALLET, CA);
    chainMock.configured = true;
    const r = await POST(post('/api/measure', { ca: CA, wallet: WALLET, nonce: ch.nonce, signature: sign(ch.message) }));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'no such coin' });
    expect(fakeDb.authChallenge.rows[0]!['usedAt']).toBeInstanceOf(Date);
  });

  it('measure: the QRNG provider and the chain must be configured, otherwise 503 unavailable with the reason (no fallback)', async () => {
    const { issueChallenge } = await import('@/server/auth');
    const { POST } = await import('@/app/api/measure/route');
    process.env.QSD_QRNG_PROVIDER = 'anu-quantum-numbers';
    delete process.env.QSD_QRNG_API_KEY;
    const ch = await issueChallenge('measure', WALLET, CA);
    const r = await POST(post('/api/measure', { ca: CA, wallet: WALLET, nonce: ch.nonce, signature: sign(ch.message) }));
    expect(r.status).toBe(503);
    expect(((await r.json()) as { unavailable: { reason: string } }).unavailable.reason).toMatch(/quantum random number provider is not configured/);
    expect(chainMock.getChainCalls).toBe(0);
  });

  it('a collapsed coin cannot be measured: performMeasurement throws MeasureError before touching the chain or the provider', async () => {
    const { performMeasurement, MeasureError } = await import('@/server/measure');
    await fakeDb.coin.create({
      data: {
        ca: CA, name: 'PHOTON', ticker: 'PHO', imageUri: '', imageHash: 'ab'.repeat(32), imageLineage: 'cd'.repeat(32), lineageId: 'l', generation: 1, identityRoot: 'ef'.repeat(32), halfLifeSec: 3600, decayProgress: 1,
        supplyMin: 1n, supplyMax: 2n, totalUnits: 100n, remainingUnits: 100n, decimals: 0, state: 'collapsed', lastActivityAt: 1, bornAt: 1, collapsedAt: 2, launchPath: 'devnet-spl', launchTx: 'x',
      },
    });
    await expect(performMeasurement(CA, WALLET)).rejects.toThrow(MeasureError);
    await expect(performMeasurement(CA, WALLET)).rejects.toThrow(/collapsed and cannot be measured/);
    expect(chainMock.getChainCalls).toBe(0);
  });
});

describe('verify options on the server (measure.ts verifyOptions)', () => {
  it('a real provider → productionVerifyOptions(): the published witness keys + requireInputBinding, never allowUnsafeDev', async () => {
    process.env.QSD_QRNG_PROVIDER = 'anu-quantum-numbers';
    process.env.QSD_QRNG_API_KEY = 'agent-h-not-a-real-key';
    process.env.QSD_WITNESS_SECRET_KEY = '11'.repeat(32);
    process.env.QSD_WITNESS_PUBLIC_KEYS = 'aa'.repeat(32) + ',' + 'bb'.repeat(32);
    const { verifyOptions } = await import('@/server/measure');
    const { productionVerifyOptions } = await import('@qsd/solana');
    const o = verifyOptions();
    expect(o).toEqual(productionVerifyOptions(process.env));
    expect(o.requireInputBinding).toBe(true);
    expect(o.trustedWitnessKeys).toEqual(['aa'.repeat(32), 'bb'.repeat(32)]);
    expect('allowUnsafeDev' in o).toBe(false);
  });

  it('UNSAFE_DEV_RANDOM is only constructible under the quantum guard: with NODE_ENV=production the provider does not exist, so verifyOptions() can never be { allowUnsafeDev } in production', async () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env.QSD_QRNG_PROVIDER = 'UNSAFE_DEV_RANDOM';
    const { qrngStatus } = await import('@/server/qrng');
    const s = qrngStatus();
    expect(s.configured).toBe(false);
    expect(s.reason).toMatch(/production|NODE_ENV/i);
    Object.assign(process.env, { NODE_ENV: 'test' });
  });

  it('with NODE_ENV=test and UNSAFE_DEV_RANDOM, verifyOptions() is { allowUnsafeDev: true } (documented dev path)', async () => {
    const { verifyOptions } = await import('@/server/measure');
    expect(verifyOptions()).toEqual({ allowUnsafeDev: true });
  });
});
