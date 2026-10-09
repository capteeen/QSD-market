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

  it('LOW H-W8: nextBurnAt is derived from env presence (REDIS_URL + QSD_TOKEN_MINT), not from a scheduler that is known to run — the home page counts down to a burn no worker may perform', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.QSD_TOKEN_MINT = 'So11111111111111111111111111111111111111112';
    const { nextBurnAt } = await import('@/server/stats');
    const v = nextBurnAt();
    expect(v).not.toBeNull();
    // top of the next UTC hour, computed locally
    const d = new Date(v!);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getTime()).toBeGreaterThan(Date.now());
    // documents the limitation: no Redis call was made to find the scheduled job
    const src = (await import('node:fs')).readFileSync(new URL('../../apps/web/src/server/stats.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/getRepeatableJobs|getDelayed|Queue\(/);
  });
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

  it('MEDIUM H-W7: a collapse outcome enqueues the daughter launch through `enqueue`, which swallows every failure (REDIS_URL unset → warning only) — a collapsed mother with no queued job is never reconciled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { enqueue } = await import('@/server/queues');
    await expect(enqueue('collapse', { ca: 'abc' }, { jobId: 'collapse-abc' })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/REDIS_URL unset: job collapse not enqueued/));
    warn.mockRestore();
    // and nothing in the app looks for collapsed coins without a daughter
    const fs = await import('node:fs');
    const worker = fs.readFileSync(new URL('../../apps/web/src/workers/index.ts', import.meta.url), 'utf8');
    const measure = fs.readFileSync(new URL('../../apps/web/src/server/measure.ts', import.meta.url), 'utf8');
    expect(measure).toMatch(/await enqueue\('collapse'/);
    expect(worker).not.toMatch(/daughterCa: null|state: 'collapsed'/);
  });

  it('LOW H-W13: the app calls executeCollapse without `collapseSlot`, so the snapshot slot is the worker start slot (collapseSlotSource "orchestration-start"), not the proof-anchor slot the package accepts since the H-S6 fix; the holders route passes collapseSlot 0', async () => {
    const fs = await import('node:fs');
    const collapse = fs.readFileSync(new URL('../../apps/web/src/server/collapse.ts', import.meta.url), 'utf8');
    const holders = fs.readFileSync(new URL('../../apps/web/src/app/api/coin/[ca]/holders/route.ts', import.meta.url), 'utf8');
    const pkg = fs.readFileSync(new URL('../../packages/solana/src/collapse.ts', import.meta.url), 'utf8');
    expect(pkg).toMatch(/collapseSlotSource: deps\.collapseSlot !== undefined \? 'proof-anchor' : 'orchestration-start'/);
    // documents the gap; delete these two lines when the app passes the proof-anchor slot
    expect(collapse).not.toMatch(/collapseSlot/);
    expect(holders).toMatch(/collapseSlot: 0/);
  });
});
