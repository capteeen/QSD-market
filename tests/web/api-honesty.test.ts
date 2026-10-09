/**
 * Agent H — the API never answers a failed query with a number (SPEC §2
 * l.96-97, README "a failed query is not available (reason), never 0"). The
 * REAL server modules (db.ts, unavailable.ts, stats.ts, burns route, coin
 * route, apiGet) run against Agent H's in-memory Prisma stand-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DbDown, fakeDb } from './fakeDb';

// 'server-only' and '@prisma/client' are aliased in vitest.config.ts (see prisma-stub.ts).

const g = globalThis as unknown as { __qsdPrisma?: unknown; __qsdChain?: unknown; __qsdQrng?: unknown };

beforeEach(() => {
  fakeDb.reset();
  delete g.__qsdPrisma;
  delete g.__qsdChain;
  delete g.__qsdQrng;
  delete process.env.REDIS_URL;
  delete process.env.QSD_TOKEN_MINT;
});
afterEach(() => vi.unstubAllGlobals());

describe('GET /api/stats', () => {
  it('a database connection failure yields HTTP 503 { unavailable: { reason } } with no counters', async () => {
    fakeDb.down = new DbDown();
    const { GET } = await import('@/app/api/stats/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['unavailable']);
    expect((body['unavailable'] as { reason: string }).reason).toMatch(/not reachable|not configured/);
    expect(JSON.stringify(body)).not.toMatch(/counters|"superposed"/);
  });

  it('a non-connection error yields HTTP 500 { error } with no counters and no stack; the client turns it into an unavailable value', async () => {
    fakeDb.down = new Error('boom: relation "Coin" is broken');
    const { GET } = await import('@/app/api/stats/route');
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['error']);
    expect(String(body['error'])).not.toMatch(/\n\s+at /);
    // client side
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 500, headers: { 'content-type': 'application/json' } })));
    const { apiGet, isUnavailable } = await import('@/lib/api');
    const v = await apiGet<unknown>('/api/stats');
    expect(isUnavailable(v)).toBe(true);
    expect((v as { unavailable: { reason: string } }).unavailable.reason).toBe('boom: relation "Coin" is broken');
  });

  it('a non-JSON or network failure on the client is an unavailable value with the cause, never a thrown error or a number', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502</html>', { status: 502 })));
    const { apiGet, isUnavailable } = await import('@/lib/api');
    const v = await apiGet<unknown>('/api/stats');
    expect(isUnavailable(v)).toBe(true);
    expect((v as { unavailable: { reason: string } }).unavailable.reason).toBe('HTTP 502 with a non-JSON body');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const w = await apiGet<unknown>('/api/stats');
    expect((w as { unavailable: { reason: string } }).unavailable.reason).toBe('network error: Failed to fetch');
  });

  it('empty tables → counters are real zeros, qsdBurned "0", nextBurnAt null (no burn job configured), health reflects configuration', async () => {
    const { GET } = await import('@/app/api/stats/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { counters: Record<string, unknown>; nextBurnAt: string | null; health: { db: boolean; redis: boolean; qrng: { configured: boolean }; chain: { configured: boolean } } };
    expect(body.counters).toEqual({ superposed: 0, measurementsToday: 0, collapses: 0, daughters: 0, tunnels: 0, qsdBurned: '0' });
    expect(body.nextBurnAt).toBeNull();
    expect(body.health.db).toBe(true);
    expect(body.health.redis).toBe(false);
    expect(body.health.qrng.configured).toBe(false);
    expect(body.health.chain.configured).toBe(false);
  });

  it('H-W8 (fixed): the countdown comes from the scheduler — computeStats reports burnSchedule.scheduledBurnAt() (BullMQ repeatable job `next`), null without Redis; the env-only helper is no longer what the page shows', async () => {
    const fs = await import('node:fs');
    const stats = fs.readFileSync(new URL('../../apps/web/src/server/stats.ts', import.meta.url), 'utf8');
    const sched = fs.readFileSync(new URL('../../apps/web/src/server/burnSchedule.ts', import.meta.url), 'utf8');
    expect(stats).toMatch(/scheduledBurnAt\(\)/);
    expect(stats).toMatch(/nextBurnAt: burnAt/);
    expect(sched).toMatch(/getRepeatableJobs/);
    // no Redis → no countdown, even with the env set
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    process.env.QSD_TOKEN_MINT = 'So11111111111111111111111111111111111111112';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { scheduledBurnAt } = await import('@/server/burnSchedule');
    await expect(scheduledBurnAt()).resolves.toBeNull();
    warn.mockRestore();
    delete process.env.REDIS_URL;
    delete process.env.QSD_TOKEN_MINT;
  }, 30_000);
});

describe('other handlers', () => {
  it('GET /api/burns: empty → totalBurned "0" (sum over no rows) and qsdMint null when unconfigured; DB down → 503', async () => {
    const { GET } = await import('@/app/api/burns/route');
    const ok = (await (await GET()).json()) as { burns: unknown[]; totalBurned: string; qsdMint: string | null };
    expect(ok).toEqual({ burns: [], totalBurned: '0', qsdMint: null });
    fakeDb.down = new DbDown();
    expect((await GET()).status).toBe(503);
  });

  it('GET /api/coin/[ca]: unknown coin → 404 { error: "no such coin" }; DB down → 503', async () => {
    const { GET } = await import('@/app/api/coin/[ca]/route');
    const r = await GET(new Request('http://x/api/coin/abc'), { params: { ca: 'abc' } });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'no such coin' });
    fakeDb.down = new DbDown();
    expect((await GET(new Request('http://x/api/coin/abc'), { params: { ca: 'abc' } })).status).toBe(503);
  });

  it('GET /api/coins and /api/log: empty arrays, never fabricated rows', async () => {
    const coins = await import('@/app/api/coins/route');
    expect(await (await coins.GET()).json()).toMatchObject({ coins: [] });
    const log = await import('@/app/api/log/route');
    const { NextRequest } = await import('next/server');
    expect(await (await log.GET(new NextRequest('http://x/api/log?limit=10'))).json()).toEqual({ entries: [] });
  });

  it('isDbUnavailable classifies connection failures and not data errors (real db.ts)', async () => {
    const { isDbUnavailable, dbUnavailableReason } = await import('@/server/db');
    expect(isDbUnavailable(new DbDown())).toBe(true);
    expect(isDbUnavailable(Object.assign(new Error('x'), { code: 'P1001' }))).toBe(true);
    expect(isDbUnavailable(Object.assign(new Error('x'), { code: 'P2021' }))).toBe(true);
    expect(isDbUnavailable(Object.assign(new Error('x'), { code: 'P2002' }))).toBe(false);
    expect(isDbUnavailable(new Error('relation does not exist in the current database'))).toBe(true);
    expect(isDbUnavailable(new Error('division by zero'))).toBe(false);
    expect(isDbUnavailable('string')).toBe(false);
    delete process.env.DATABASE_URL;
    expect(dbUnavailableReason(new Error('x'))).toBe('the database is not configured (DATABASE_URL is unset)');
    process.env.DATABASE_URL = 'postgresql://u:p@h/db';
    expect(dbUnavailableReason(new Error('first line\nsecond line'))).toBe('the database is not reachable (first line)');
  });

  it('H-W7 (fixed): a collapse still hands the daughter launch to `enqueue` (which cannot throw), but the measurement now reports whether it was scheduled, and the worker runs reconcileCollapses (collapsed mothers without a daughter are re-enqueued)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { enqueue } = await import('@/server/queues');
    const failures: string[] = [];
    await expect(enqueue('collapse', { ca: 'abc' }, { jobId: 'collapse-abc', onFailure: (reason: string) => void failures.push(reason) })).resolves.toBeUndefined();
    expect(failures.length).toBe(1);
    expect(failures[0]).toMatch(/REDIS_URL/);
    warn.mockRestore();
    const fs = await import('node:fs');
    const worker = fs.readFileSync(new URL('../../apps/web/src/workers/index.ts', import.meta.url), 'utf8');
    const measure = fs.readFileSync(new URL('../../apps/web/src/server/measure.ts', import.meta.url), 'utf8');
    const reconcile = fs.readFileSync(new URL('../../apps/web/src/server/reconcile.ts', import.meta.url), 'utf8');
    expect(measure).toMatch(/onFailure: \(reason\) => void \(sched\.value = \{ status: 'not-scheduled'/);
    expect(worker).toMatch(/reconcileCollapses\(/);
    expect(reconcile).toMatch(/where: \{ state: 'collapsed', daughterCa: null \}/);
    const { collapsedWithoutDaughter } = await import('@/server/reconcile');
    await fakeDb.coin.create({ data: { ca: 'm1', name: 'M', ticker: 'M', imageUri: '', imageHash: 'a', imageLineage: 'b', lineageId: 'l', generation: 1, identityRoot: 'r', halfLifeSec: 3600, decayProgress: 1, supplyMin: 1n, supplyMax: 2n, totalUnits: 1n, remainingUnits: 1n, decimals: 0, state: 'collapsed', lastActivityAt: 1, bornAt: 1, collapsedAt: 5, launchPath: 'devnet-spl', launchTx: 'x', daughterCa: null } });
    await fakeDb.coin.create({ data: { ca: 'm2', name: 'M', ticker: 'M', imageUri: '', imageHash: 'a', imageLineage: 'b', lineageId: 'l', generation: 1, identityRoot: 'r', halfLifeSec: 3600, decayProgress: 1, supplyMin: 1n, supplyMax: 2n, totalUnits: 1n, remainingUnits: 1n, decimals: 0, state: 'collapsed', lastActivityAt: 1, bornAt: 1, collapsedAt: 3, launchPath: 'devnet-spl', launchTx: 'y', daughterCa: 'd2' } });
    expect((await collapsedWithoutDaughter()).map((c) => c.ca)).toEqual(['m1']);
  });

  it('H-W13 (fixed): executeCollapse receives the proof-anchor slot of the collapsing measurement (collapseSlotSource "proof-anchor"); the holders route uses the same slot', async () => {
    const fs = await import('node:fs');
    const collapse = fs.readFileSync(new URL('../../apps/web/src/server/collapse.ts', import.meta.url), 'utf8');
    const holders = fs.readFileSync(new URL('../../apps/web/src/app/api/coin/[ca]/holders/route.ts', import.meta.url), 'utf8');
    expect(collapse).toMatch(/const collapseSlot = proofAnchorSlot\(row\)/);
    expect(collapse).toMatch(/\.\.\.\(collapseSlot !== null \? \{ collapseSlot \} : \{\}\)/);
    expect(holders).toMatch(/proofAnchorSlot\(row\)/);
    const { proofAnchorSlot } = await import('@/server/collapse');
    expect(proofAnchorSlot({ measurements: [{ index: 0, outcomeKind: 'survive', proofSlot: 10 }, { index: 1, outcomeKind: 'collapse', proofSlot: 42 }] })).toBe(42);
    expect(proofAnchorSlot({ measurements: [{ index: 0, outcomeKind: 'survive', proofSlot: 10 }] })).toBeNull();
    expect(proofAnchorSlot({ measurements: [{ index: 0, outcomeKind: 'collapse', proofSlot: null }] })).toBeNull();
  });
});
