import './setup-mocks';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { FOOTER_DISCLAIMER } from '@/copy';
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
import { mockFetch, renderWithQuery, textWithoutFooter, UNAVAILABLE } from './helpers';

const pages: { name: string; el: () => JSX.Element }[] = [
  { name: '/', el: () => <HomeView /> },
  { name: '/field', el: () => <FieldView /> },
  { name: '/coin/[ca]', el: () => <CoinView ca="11111111111111111111111111111111" /> },
  { name: '/lineage/[id]', el: () => <LineageView id="abc" /> },
  { name: '/launch', el: () => <LaunchView /> },
  { name: '/measure', el: () => <MeasureQueueView /> },
  { name: '/burns', el: () => <BurnsView /> },
  { name: '/how', el: () => <HowView /> },
  { name: '/me', el: () => <MeView /> },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('footer on every route', () => {
  for (const p of pages) {
    it(`${p.name} renders the disclaimer`, async () => {
      mockFetch();
      const { container } = renderWithQuery(<AppShell>{p.el()}</AppShell>);
      await waitFor(() => expect(container.querySelector('[data-testid="footer"]')).toBeInTheDocument());
      expect(screen.getByTestId('footer')).toHaveTextContent(FOOTER_DISCLAIMER);
    });
  }
});

describe('honest unavailable state against { unavailable }', () => {
  for (const p of pages) {
    it(`${p.name} shows the unavailable reason and no numeric data`, async () => {
      mockFetch();
      const { container } = renderWithQuery(<AppShell>{p.el()}</AppShell>);
      // Wait until every query has settled: the reason text or the wallet gate appears.
      await waitFor(() => {
        const txt = container.textContent ?? '';
        expect(txt.includes('not available') || txt.includes('Connect a wallet')).toBe(true);
      });
      await waitFor(() => expect(container.textContent).not.toContain('loading'), { timeout: 3000 });
      const txt = textWithoutFooter(container);
      // The reason from the 503 is surfaced verbatim (except on the wallet-gated /me).
      if (p.name !== '/me') expect(txt).toContain(UNAVAILABLE.unavailable.reason);
      // No digit anywhere except the structural copy listed here.
      const allowed = [
        /0[1-4](?=[A-Z])/g, // the "01 … 04" step numbers on the home page
        /auto-measurement after \d+ h/g, // half-life preset labels on /launch (protocol constants, not data)
        /1\.0 and 1\.5/g, // the entanglement weight bounds quoted from economics.md in copy
        /SHA-256/g,
        /11111111111111111111111111111111/g, // the test coin address in the page header
      ];
      let stripped = txt;
      for (const re of allowed) stripped = stripped.replace(re, '');
      expect(stripped).not.toMatch(/\d/);
    });
  }
});

describe('honest empty state against empty arrays', () => {
  it('/ renders the empty log and zero counters from a real zero', async () => {
    mockFetch((path) => {
      if (path.startsWith('/api/stats'))
        return {
          body: {
            counters: { superposed: 0, measurementsToday: 0, collapses: 0, daughters: 0, tunnels: 0, qsdBurned: '0' },
            nextBurnAt: null,
            health: { db: true, redis: false, qrng: { configured: false, providerId: null, reason: 'unset' }, chain: { configured: false, cluster: null, reason: 'unset' } },
            now: 1,
          },
        };
      if (path.startsWith('/api/log')) return { body: { entries: [] } };
      if (path.startsWith('/api/coins')) return { body: { coins: [], now: 1 } };
      return { status: 503, body: UNAVAILABLE };
    });
    renderWithQuery(<HomeView />);
    await waitFor(() => expect(screen.getByText('NO EVENTS YET')).toBeInTheDocument());
    expect(screen.getByText('NO LIVE COINS')).toBeInTheDocument();
    const cells = screen.getAllByRole('cell').filter((c) => c.getAttribute('data-unavailable') === 'false');
    expect(cells.length).toBe(6);
    for (const c of cells) expect(c.textContent).toBe('0');
  });

  it('/field, /measure, /burns render their empty states', async () => {
    mockFetch((path) => {
      if (path.startsWith('/api/coins')) return { body: { coins: [], now: 1 } };
      if (path.startsWith('/api/burns')) return { body: { burns: [], totalBurned: '0', qsdMint: null } };
      return { status: 503, body: UNAVAILABLE };
    });
    const a = renderWithQuery(<FieldView />);
    await waitFor(() => expect(a.getByText('NO LIVE COINS')).toBeInTheDocument());
    a.unmount();
    const b = renderWithQuery(<MeasureQueueView />);
    await waitFor(() => expect(b.getByText('NOTHING TO MEASURE')).toBeInTheDocument());
    b.unmount();
    const c = renderWithQuery(<BurnsView />);
    await waitFor(() => expect(c.getByText('NO BURNS YET')).toBeInTheDocument());
    expect(c.container.textContent).toContain('no $QSD mint is configured');
  });

  it('counters render unavailable on 503, not 0', async () => {
    mockFetch();
    const { container } = renderWithQuery(<HomeView />);
    await waitFor(() => expect(container.textContent).toContain(UNAVAILABLE.unavailable.reason));
    const cells = container.querySelectorAll('[role="cell"][data-unavailable="true"]');
    expect(cells.length).toBeGreaterThanOrEqual(6);
    expect(container.querySelectorAll('[role="cell"][data-unavailable="false"]').length).toBe(0);
  });

  it('/me is wallet-gated', async () => {
    mockFetch();
    renderWithQuery(<MeView />);
    expect(screen.getByText('Connect a wallet to see your positions.')).toBeInTheDocument();
  });
});
