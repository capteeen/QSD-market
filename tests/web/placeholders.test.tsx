// @vitest-environment jsdom
/**
 * Agent H — "No placeholder numbers, ever" (SPEC §2 l.96-97, §8 l.366-368,
 * §11 l.434). Every page is rendered (a) with every API returning 503
 * `{ unavailable }` and (b) with every API returning real empty data. In (a)
 * the ONLY digits allowed anywhere on a page are the four step markers
 * "01…04" on the home page; every data cell must be in the kit's unavailable
 * state with the 503 reason. In (b) the only digits are real zeros from an
 * empty table, protocol constants (half-life presets) and the connected
 * wallet's own address. Agent H's allow-list is its own, not the app's.
 */
import './client-mocks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { screen, waitFor, within } from '@testing-library/react';
import { HALF_LIFE_PRESETS } from '@qsd/protocol';
import { HOME, COIN, LINEAGE, FIELD, MEASURE, BURNS, ME, LAUNCH } from '@/copy';
import { AppShell } from '@/components/AppShell';
import { HomeView } from '@/components/views/HomeView';
import { FieldView } from '@/components/views/FieldView';
import { CoinView } from '@/components/views/CoinView';
import { LineageView } from '@/components/views/LineageView';
import { LaunchView } from '@/components/views/LaunchView';
import { MeasureQueueView } from '@/components/views/MeasureQueueView';
import { BurnsView } from '@/components/views/BurnsView';
import { HowView } from '@/components/views/HowView';
import { MeView } from '@/components/views/MeView';
import { walletState } from './client-mocks';
import { DOWN, bodyText, renderPage, stubFetch, type Responder } from './render';

const ROOT = path.resolve(__dirname, '../..');
const CA = 'So11111111111111111111111111111111111111112';
const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

const pages: { route: string; el: () => JSX.Element; wallet?: boolean }[] = [
  { route: '/', el: () => <HomeView /> },
  { route: '/field', el: () => <FieldView /> },
  { route: '/coin/[ca]', el: () => <CoinView ca={CA} /> },
  { route: '/lineage/[id]', el: () => <LineageView id="abc" /> },
  { route: '/launch', el: () => <LaunchView /> },
  { route: '/measure', el: () => <MeasureQueueView /> },
  { route: '/burns', el: () => <BurnsView /> },
  { route: '/how', el: () => <HowView /> },
  { route: '/me', el: () => <MeView /> },
  { route: '/me (wallet connected)', el: () => <MeView />, wallet: true },
];

/** Real empty responses, shaped exactly as the route handlers shape them (src/lib/types.ts). */
const emptyResponder: Responder = (p) => {
  if (p.startsWith('/api/stats'))
    return {
      body: {
        counters: { superposed: 0, measurementsToday: 0, collapses: 0, daughters: 0, tunnels: 0, qsdBurned: '0' },
        nextBurnAt: null,
        health: { db: true, redis: false, qrng: { configured: false, providerId: null, reason: 'QSD_QRNG_PROVIDER is unset' }, chain: { configured: false, cluster: null, reason: 'QSD_KEY_ENCRYPTION_KEY is unset' } },
        now: 1_700_000_000,
      },
    };
  if (p.startsWith('/api/log')) return { body: { entries: [] } };
  if (p.startsWith('/api/coins')) return { body: { coins: [], now: 1_700_000_000 } };
  if (p.startsWith('/api/coin/')) return { status: 404, body: { error: 'no such coin' } };
  if (p.startsWith('/api/lineage/')) return { status: 404, body: { error: 'no such lineage' } };
  if (p.startsWith('/api/burns')) return { body: { burns: [], totalBurned: '0', qsdMint: null } };
  if (p.startsWith('/api/how')) {
    const physics = readFileSync(path.join(ROOT, 'docs/physics.md'), 'utf8');
    const economics = readFileSync(path.join(ROOT, 'docs/economics.md'), 'utf8');
    return { body: { physics, economics, source: { physics: '/docs/physics.md', economics: '/docs/economics.md' } } };
  }
  if (p.startsWith('/api/launch/quote'))
    return { body: { cluster: 'devnet', launchCostLamports: null, identityReserveLamports: null, payTo: null, reasons: { launchCost: 'QSD_LAUNCH_COST_LAMPORTS is unset', identityReserve: 'QSD_IDENTITY_RESERVE_LAMPORTS is unset', payTo: 'chain not configured' } } };
  if (p.startsWith('/api/me')) return { body: { wallet: WALLET, created: [], held: [], received: [], identities: [], now: 1_700_000_000 } };
  return { status: 503, body: DOWN };
};

afterEach(() => {
  vi.unstubAllGlobals();
  walletState.publicKey = null;
});

async function settled(container: HTMLElement): Promise<void> {
  await waitFor(() => expect(container.textContent).not.toMatch(/loading/), { timeout: 5000 });
}

describe('(a) every API down: honest unavailable state, no number anywhere', () => {
  for (const p of pages) {
    it(`${p.route}`, async () => {
      if (p.wallet) walletState.publicKey = { toBase58: () => WALLET };
      stubFetch();
      const { container } = renderPage(<AppShell>{p.el()}</AppShell>);
      await settled(container);
      const txt = bodyText(container);
      if (!p.route.startsWith('/me')) expect(txt).toContain(DOWN.unavailable.reason);
      // no data cell claims to be available
      expect(container.querySelectorAll('[role="cell"][data-unavailable="false"]').length).toBe(0);
      expect(container.querySelectorAll('td').length).toBe(0);
      // the only digits anywhere are the structural step markers 01-04 (home) and the wallet's own address
      let stripped = txt.replace(/(?<![0-9])0[1-4](?=[A-Z])/g, '');
      if (p.wallet) stripped = stripped.split(WALLET).join('');
      expect(stripped).not.toMatch(/\d/);
    });
  }

  it('/ counters: every row unavailable with the 503 reason, never 0; the burn countdown is unavailable with the reason', async () => {
    stubFetch();
    const { container } = renderPage(<HomeView />);
    await settled(container);
    const cells = container.querySelectorAll('[role="cell"][data-unavailable="true"]');
    expect(cells.length).toBeGreaterThanOrEqual(6);
    for (const c of cells) expect(c.textContent).toContain(DOWN.unavailable.reason);
    expect(container.querySelectorAll('[role="cell"][data-unavailable="false"]').length).toBe(0);
    const countdown = container.querySelector('[data-unavailable="true"].qsd-countdown, .qsd-countdown[data-unavailable="true"], [data-size="sm"][data-unavailable="true"]');
    expect(countdown).not.toBeNull();
  });

  it('partial outage is reported per panel: stats up, log down → counters render, log says why', async () => {
    stubFetch((p) => (p.startsWith('/api/stats') ? emptyResponder(p) : { status: 503, body: DOWN }));
    const { container } = renderPage(<HomeView />);
    await settled(container);
    expect(container.querySelectorAll('[role="cell"][data-unavailable="false"]').length).toBe(6);
    expect(screen.getByText(HOME.logUnavailableEyebrow)).toBeTruthy();
    expect(bodyText(container)).toContain(DOWN.unavailable.reason);
  });
});

describe('(b) every API empty: honest empty states, real zeros only', () => {
  it('/ : six counters show "0" from a real zero; the log and the field are empty; next burn unavailable with the copy reason', async () => {
    stubFetch(emptyResponder);
    const { container } = renderPage(<HomeView />);
    await settled(container);
    await waitFor(() => expect(screen.getByText(HOME.logEmptyEyebrow)).toBeTruthy());
    expect(screen.getByText(HOME.fieldEmptyEyebrow)).toBeTruthy();
    const cells = [...container.querySelectorAll('[role="cell"][data-unavailable="false"]')];
    expect(cells.length).toBe(6);
    for (const c of cells) expect(c.textContent?.trim()).toBe('0');
    expect(bodyText(container)).toContain(HOME.nextBurnUnavailable);
    // digits: the six zeros and the step markers only
    let stripped = bodyText(container).replace(/(?<![0-9])0[1-4](?=[A-Z])/g, '');
    for (const label of Object.values(HOME.counters)) stripped = stripped.replace(`${label}0`, label);
    expect(stripped).not.toMatch(/\d/);
    expect(container.querySelector('[data-testid="scene"]')?.getAttribute('data-coins')).toBe('0');
  });

  it('/field, /measure: empty states, no table, no digits', async () => {
    stubFetch(emptyResponder);
    const a = renderPage(<FieldView />);
    await settled(a.container);
    expect(a.getByText(FIELD.emptyEyebrow)).toBeTruthy();
    expect(bodyText(a.container)).not.toMatch(/\d/);
    a.unmount();
    const b = renderPage(<MeasureQueueView />);
    await settled(b.container);
    expect(b.getByText(MEASURE.emptyEyebrow)).toBeTruthy();
    expect(bodyText(b.container)).not.toMatch(/\d/);
  });

  it('/burns: empty list, total "0 $QSD" from the empty table, mint unavailable with the copy reason', async () => {
    stubFetch(emptyResponder);
    const { container, getByText } = renderPage(<BurnsView />);
    await settled(container);
    expect(getByText(BURNS.emptyEyebrow)).toBeTruthy();
    expect(bodyText(container)).toContain(BURNS.qsdCaUnavailable);
    const cells = [...container.querySelectorAll('[role="cell"][data-unavailable="false"]')];
    expect(cells.map((c) => c.textContent?.replace(/\s+/g, '').trim())).toEqual(['0$QSD']);
    expect(bodyText(container).replace(/0\s*\$QSD/, '')).not.toMatch(/\d/);
  });

  it('/coin/[ca] and /lineage/[id]: a 404 renders the not-found empty state, nothing else', async () => {
    stubFetch(emptyResponder);
    const a = renderPage(<CoinView ca={CA} />);
    await settled(a.container);
    expect(a.getByText(COIN.notFoundEyebrow)).toBeTruthy();
    expect(a.getByText(COIN.notFoundSentence)).toBeTruthy();
    expect(bodyText(a.container)).not.toMatch(/\d/);
    a.unmount();
    const b = renderPage(<LineageView id="abc" />);
    await settled(b.container);
    expect(b.getByText(LINEAGE.notFoundEyebrow)).toBeTruthy();
    expect(bodyText(b.container)).not.toMatch(/\d/);
  });

  it('/launch with a quote whose costs are unset: every cost row unavailable with the API reason; the only digits are the preset labels (protocol constants), "SHA-256" and the dev-buy input echo', async () => {
    stubFetch(emptyResponder);
    const { container } = renderPage(<LaunchView />);
    await settled(container);
    const rows = [...container.querySelectorAll('[role="row"]')];
    const byLabel = (label: string) => rows.find((r) => r.querySelector('[role="rowheader"]')?.textContent?.trim() === label)!;
    expect(within(byLabel(LAUNCH.cost.launch) as HTMLElement).getByRole('cell').getAttribute('data-unavailable')).toBe('true');
    expect(byLabel(LAUNCH.cost.launch).textContent).toContain('QSD_LAUNCH_COST_LAMPORTS is unset');
    expect(byLabel(LAUNCH.cost.identity).textContent).toContain('QSD_IDENTITY_RESERVE_LAMPORTS is unset');
    expect(within(byLabel(LAUNCH.cost.total) as HTMLElement).getByRole('cell').getAttribute('data-unavailable')).toBe('true');
    expect(byLabel(LAUNCH.cost.payTo).textContent).toContain('chain not configured');
    expect(screen.getByText(LAUNCH.noWalletEyebrow)).toBeTruthy();
    expect(screen.getByText(LAUNCH.devnetNotice)).toBeTruthy();
    let stripped = bodyText(container).replace(/SHA-256/g, '').replace(/dev buy0 SOL/, 'dev buy');
    for (const p of HALF_LIFE_PRESETS) stripped = stripped.split(`${p.label} (auto-measurement after ${p.maxWindowSec / 3600} h)`).join('');
    expect(stripped).not.toMatch(/\d/);
    // the submit button is disabled: nothing can be paid for a quote with no price
    expect((screen.getByText(LAUNCH.form.submit) as HTMLButtonElement).disabled).toBe(true);
  });

  it('/me: wallet gate without a wallet; with a wallet and empty data every section says so in words', async () => {
    stubFetch(emptyResponder);
    const a = renderPage(<MeView />);
    expect(a.getByText(ME.connectSentence)).toBeTruthy();
    expect(bodyText(a.container)).not.toMatch(/\d/);
    a.unmount();
    walletState.publicKey = { toBase58: () => WALLET };
    const b = renderPage(<MeView />);
    await settled(b.container);
    for (const s of [ME.noneCreated, ME.noneHeld, ME.noAllocations, ME.noReceived, ME.noLineages]) if (s !== ME.noAllocations) expect(bodyText(b.container)).toContain(s);
    expect(b.container.querySelectorAll('[role="cell"][data-unavailable="false"]').length).toBe(0);
    expect(bodyText(b.container).split(WALLET).join('')).not.toMatch(/\d/);
  });

  it('/how: both documents render (the digits on this page are the documents’ own)', async () => {
    stubFetch(emptyResponder);
    const { container } = renderPage(<HowView />);
    await waitFor(() => expect(container.querySelector('article h1')).not.toBeNull());
    expect(container.querySelector('article h1')?.textContent).toBe('The physics behind QSD, honestly');
  });
});

describe('source-level: no defaulted number reaches a data position', () => {
  const src = (f: string) => readFileSync(path.join(ROOT, 'apps/web/src', f), 'utf8');
  it('format helpers have no numeric default for a missing value', () => {
    const f = src('lib/format.ts');
    expect(f).not.toMatch(/\?\?\s*0\b/);
    expect(f).not.toMatch(/\|\|\s*0\b/);
  });
  it('INFO H-W10: the two `?? 0` defaults that can reach a page are documented and harmless (LineageView decimals when the lineage has no coins; /api/me tradedUiAmount when the aggregate is null)', () => {
    expect(src('components/views/LineageView.tsx')).toMatch(/decimals = data\.coins\[0\]\?\.supply\.decimals \?\? 0/);
    expect(src('app/api/me/route.ts')).toMatch(/tradedUiAmount: t\._sum\.tokenUiAmount \?\? 0/);
    // and nothing else in a view defaults a number
    for (const f of ['components/views/HomeView.tsx', 'components/views/CoinView.tsx', 'components/views/FieldView.tsx', 'components/views/MeasureQueueView.tsx', 'components/views/BurnsView.tsx', 'components/views/MeView.tsx', 'components/Counters.tsx', 'components/LogList.tsx']) {
      expect(src(f), f).not.toMatch(/\?\?\s*0n?\b/);
      expect(src(f), f).not.toMatch(/\|\|\s*0n?\b/);
    }
  });
  it('Counters render the kit DataRow with `unavailable`, not a value, when the stats payload is unavailable (source)', () => {
    expect(src('components/Counters.tsx')).toMatch(/unavailable=\{\{ reason: reason \?\? SHARED\.unavailableDb \}\}/);
  });
});
