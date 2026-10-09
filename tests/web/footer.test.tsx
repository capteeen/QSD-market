// @vitest-environment jsdom
/**
 * Agent H — the footer disclaimer, verbatim per SPEC §8 l.371-374, on EVERY
 * route (§11 l.436): each route's page component is rendered through the real
 * RootLayout (apps/web/src/app/layout.tsx → Providers → AppShell → Footer),
 * not through a hand-assembled shell. 404 and error pages are checked for
 * existence: Next's built-in error page replaces the whole document, so a
 * missing error.tsx / global-error.tsx means a route without the disclaimer.
 */
import './client-mocks';
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { FOOTER_DISCLAIMER } from '@/copy';
import RootLayout from '@/app/layout';
import Home from '@/app/page';
import Field from '@/app/field/page';
import Coin from '@/app/coin/[ca]/page';
import Lineage from '@/app/lineage/[id]/page';
import Launch from '@/app/launch/page';
import Measure from '@/app/measure/page';
import Burns from '@/app/burns/page';
import How from '@/app/how/page';
import Me from '@/app/me/page';

const ROOT = path.resolve(__dirname, '../..');
const APP = path.join(ROOT, 'apps/web/src/app');

/** The disclaimer as SPEC.md §8 states it (lines wrapped in the spec; whitespace normalised). */
function specDisclaimer(): string {
  const spec = readFileSync(path.join(ROOT, 'SPEC.md'), 'utf8');
  const m = spec.match(/Footer on every page: "([\s\S]*?)"/);
  if (!m) throw new Error('SPEC.md has no footer sentence');
  return m[1]!.replace(/\s+/g, ' ').trim();
}

const routes: { route: string; el: () => React.ReactElement }[] = [
  { route: '/', el: () => <Home /> },
  { route: '/field', el: () => <Field /> },
  { route: '/coin/[ca]', el: () => <Coin params={{ ca: 'So11111111111111111111111111111111111111112' }} /> },
  { route: '/lineage/[id]', el: () => <Lineage params={{ id: 'abc' }} /> },
  { route: '/launch', el: () => <Launch /> },
  { route: '/measure', el: () => <Measure /> },
  { route: '/burns', el: () => <Burns /> },
  { route: '/how', el: () => <How /> },
  { route: '/me', el: () => <Me /> },
];

describe('footer disclaimer (SPEC §8 l.371-374, §11 l.436)', () => {
  it('copy.ts FOOTER_DISCLAIMER is the SPEC sentence verbatim', () => {
    expect(FOOTER_DISCLAIMER).toBe(specDisclaimer());
    expect(FOOTER_DISCLAIMER).toBe('A daughter coin is a new coin and can fail. QSD guarantees a share of the next attempt, not a return. Coins launch on pump.fun (Solana). A meme, not an investment.');
  });

  it('every page.tsx under src/app is in the route list (a new route cannot slip past this test)', () => {
    const found: string[] = [];
    const walk = (dir: string, rel: string): void => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory() && ent.name !== 'api') walk(path.join(dir, ent.name), `${rel}/${ent.name}`);
        else if (ent.name === 'page.tsx') found.push(rel === '' ? '/' : rel);
      }
    };
    walk(APP, '');
    expect(found.sort()).toEqual(routes.map((r) => r.route).sort());
  });

  for (const r of routes) {
    it(`${r.route}: the real RootLayout renders the disclaimer exactly once, verbatim`, () => {
      const html = renderToStaticMarkup(<RootLayout>{r.el()}</RootLayout>);
      const occurrences = html.split(FOOTER_DISCLAIMER).length - 1;
      expect(occurrences).toBe(1);
      expect(html).toMatch(/<footer[^>]*data-testid="footer"/);
    });
  }

  it('FINDING H-W2 (MEDIUM): no not-found.tsx, error.tsx or global-error.tsx exists under src/app — an unknown route and a render error fall back to Next’s built-in pages, and the built-in error page replaces the root layout, so those pages carry no disclaimer', () => {
    const files = ['not-found.tsx', 'error.tsx', 'global-error.tsx'].map((f) => path.join(APP, f));
    const missing = files.filter((f) => !existsSync(f));
    expect(missing.map((f) => path.basename(f))).toEqual([]);
  });
});
