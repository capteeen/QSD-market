/**
 * Spend limits for launch, measurement, and challenge issuance.
 * The defaults are what ships; an env value can raise a limit only up to a hard cap.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { DAY_MS, HOUR_MS, budgetOpen, launchWalletLimit, resetSpendBudget, spendBudget } from '@/server/budget';
import { fakeDb } from './fakeDb';

const g = globalThis as unknown as { __qsdPrisma?: unknown };

beforeEach(() => {
  fakeDb.reset();
  delete g.__qsdPrisma;
  resetSpendBudget();
  delete process.env.LAUNCH_MAX_PER_WALLET;
  delete process.env.LAUNCH_MAX_PER_IP;
  delete process.env.LAUNCH_MAX_GLOBAL;
  delete process.env.CHALLENGE_MAX_PER_IP;
  delete process.env.REDIS_URL;
});

describe('spend windows', () => {
  it('allows `limit` spends in a window and then refuses, and an env value cannot remove the cap', async () => {
    expect(launchWalletLimit()).toBe(1);
    process.env.LAUNCH_MAX_PER_WALLET = '0';
    expect(launchWalletLimit()).toBe(1);
    process.env.LAUNCH_MAX_PER_WALLET = '1000';
    expect(launchWalletLimit()).toBe(24);
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await spendBudget('unit', 2, HOUR_MS, 0));
    expect(results).toEqual([true, true, false]);
    expect(await budgetOpen('unit', 2, HOUR_MS, 0)).toBe(false);
  });
});

describe('route caps', () => {
  const wallet = `0x${'11'.repeat(20)}`;

  it('POST /api/launch returns 429 once the IP window is full, before reading a launch', async () => {
    process.env.LAUNCH_MAX_PER_IP = '1';
    const { POST } = await import('@/app/api/launch/route');
    const call = () => POST(new NextRequest('http://localhost/api/launch', { method: 'POST', body: 'nope', headers: { 'content-type': 'text/plain' } }));
    const first = await call();
    expect(first.status).not.toBe(429);
    const second = await call();
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: 'too many launches from this network; try again later' });
  });

  it('POST /api/launch/challenge refuses a wallet that has already used its launch for the day', async () => {
    await spendBudget(`launch:wallet:${wallet}`, launchWalletLimit(), DAY_MS);
    const { POST } = await import('@/app/api/launch/challenge/route');
    const res = await POST(new NextRequest('http://localhost/api/launch/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet, ticker: 'PHO' }) }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'too many launches from this wallet; try again tomorrow' });
    expect(fakeDb.authChallenge.rows.length).toBe(0);
  });

  it('POST /api/measure/challenge returns 429 once the IP window is full', async () => {
    process.env.CHALLENGE_MAX_PER_IP = '1';
    const { POST } = await import('@/app/api/measure/challenge/route');
    const call = () => POST(new NextRequest('http://localhost/api/measure/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet, ca: 'ca' }) }));
    expect((await call()).status).toBe(200);
    const second = await call();
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: 'too many challenge requests; try again later' });
  });
});
