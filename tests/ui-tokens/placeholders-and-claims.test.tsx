/**
 * Spec §6: "Every component has an honest empty/unavailable state. No
 * component ever shows a placeholder number." Spec §2: "No placeholder
 * numbers, ever." Spec §10: compare physics/trust claims in user-facing
 * strings against /docs/physics.md.
 *
 * Independent of packages/ui-tokens/src/components/components.test.tsx:
 * server-renders every component with nothing supplied and asserts no digit
 * appears; scans component + story source for hard-coded numeric copy and
 * for claims physics.md forbids.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Panel,
  DataRow,
  HashDisplay,
  ProofBadge,
  MeasureButton,
  Countdown,
  LineageBreadcrumb,
  EmptyState,
  Unavailable,
  colors,
  motion,
  fonts,
  shape,
  glassEdge,
  quantumStateColor,
} from '@qsd/ui-tokens';

const PKG = new URL('../../packages/ui-tokens/src/', import.meta.url).pathname;

function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? allFiles(join(dir, d.name)) : [join(dir, d.name)]));
}
const componentFiles = allFiles(join(PKG, 'components')).filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'));
const storyFiles = allFiles(join(PKG, 'stories'));

const DIGIT = /\d/;
/** Names of standards are not numbers; strip them before the digit check. */
const STANDARD_NAMES = /ISO-?8601|SHA-?256|RFC ?\d+|Ed25519|base58/g;
const textOf = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(STANDARD_NAMES, '');
/** JSX text-node candidates that are actually code fragments (`{i > 0 ? (`), not copy. */
const looksLikeCode = (t: string): boolean => /[?(){}=;]|&&|\|\|/.test(t) || !/[a-zA-Z]/.test(t);

describe('empty / unavailable states contain no digits', () => {
  const cases: Array<[string, () => string]> = [
    ['Panel unavailable', () => renderToStaticMarkup(createElement(Panel, { eyebrow: 'holders', unavailable: { reason: 'indexer unreachable' } }))],
    ['Panel with no children', () => renderToStaticMarkup(createElement(Panel, {}))],
    ['DataRow no value', () => renderToStaticMarkup(createElement(DataRow, { label: 'holders' }))],
    ['DataRow NaN', () => renderToStaticMarkup(createElement(DataRow, { label: 'x', value: Number.NaN }))],
    ['HashDisplay no hash', () => renderToStaticMarkup(createElement(HashDisplay, {}))],
    ['HashDisplay empty string', () => renderToStaticMarkup(createElement(HashDisplay, { hash: '' }))],
    ['ProofBadge unavailable', () => renderToStaticMarkup(createElement(ProofBadge, { status: 'unavailable', reason: 'no bundle' }))],
    ['ProofBadge pending w/o reason', () => renderToStaticMarkup(createElement(ProofBadge, { status: 'pending' }))],
    ['MeasureButton no reward/risk', () => renderToStaticMarkup(createElement(MeasureButton, {}))],
    ['MeasureButton disabled', () => renderToStaticMarkup(createElement(MeasureButton, { disabledReason: 'QRNG unreachable' }))],
    ['Countdown no target', () => renderToStaticMarkup(createElement(Countdown, {}))],
    ['Countdown invalid target', () => renderToStaticMarkup(createElement(Countdown, { target: 'nope' }))],
    ['LineageBreadcrumb empty', () => renderToStaticMarkup(createElement(LineageBreadcrumb, { nodes: [] }))],
    ['LineageBreadcrumb undefined', () => renderToStaticMarkup(createElement(LineageBreadcrumb, {}))],
    ['EmptyState', () => renderToStaticMarkup(createElement(EmptyState, { eyebrow: 'no live coins', sentence: 'Nothing has launched.' }))],
    ['Unavailable', () => renderToStaticMarkup(createElement(Unavailable, { reason: 'because' }))],
  ];
  for (const [name, render] of cases) {
    it(name, () => {
      const html = render();
      expect(textOf(html), html).not.toMatch(DIGIT);
    });
  }

  it('DataRow with a real value renders exactly that value and nothing else numeric', () => {
    const html = renderToStaticMarkup(createElement(DataRow, { label: 'half-life', value: 3600, unit: 's' }));
    const text = html.replace(/<[^>]+>/g, ' ');
    expect(text.match(/\d+/g)).toEqual(['3600']);
  });

  it('Countdown with a target in the past renders the elapsed label only (default "00:00:00" is a real zero, not a placeholder)', () => {
    const html = renderToStaticMarkup(createElement(Countdown, { target: '2000-01-01T00:00:00.000Z', now: () => Date.parse('2000-01-01T01:00:00.000Z') }));
    expect(html.replace(/<[^>]+>/g, ' ').trim()).toContain('00:00:00');
  });
});

describe('source scan: no hard-coded numeric copy in components; stories label examples', () => {
  it('component JSX text nodes contain no digits (except the countdown zero label and CSS)', () => {
    for (const f of componentFiles) {
      const src = readFileSync(f, 'utf8');
      // text between > and < inside JSX, crude but adequate for this kit
      const texts = Array.from(src.matchAll(/>([^<>{}]+)</g), (m) => m[1]!.trim()).filter(Boolean).filter((t) => !looksLikeCode(t));
      const numeric = texts.filter((t) => DIGIT.test(t.replace(STANDARD_NAMES, '')));
      expect(numeric, `${f}: ${numeric.join(' | ')}`).toEqual([]);
    }
  });

  it('every story that renders a number or coin label calls it an example', () => {
    for (const f of storyFiles) {
      const src = readFileSync(f, 'utf8');
      const hasFakeCoin = /EXAMPLE-|generation:\s*\d|Date\.now\(\)/.test(src);
      if (hasFakeCoin) expect(src, f).toMatch(/example/i);
    }
  });

  it('LOW H-U1: ProofBadge story copy says "awaiting provider attestation" but the live attestation is witness-signed (physics.md: never describe witness-signed as provider-signed)', () => {
    const src = readFileSync(join(PKG, 'stories', 'ProofBadge.stories.tsx'), 'utf8');
    expect(src).not.toMatch(/provider attestation/);
  });

  it('LOW H-U2: the kit has no way to show the attestation kind that physics.md promises on every collapse', () => {
    // physics.md: "The UI shows the attestation kind on every collapse." ProofBadge has status + reason only.
    const src = readFileSync(join(PKG, 'components', 'ProofBadge.tsx'), 'utf8');
    expect(src).toMatch(/attestationKind|witness-signed|provider-signed/);
  });
});

describe('tokens match spec §6 exactly', () => {
  it('colour hexes', () => {
    expect(colors).toEqual({
      void: '#06080A', panel: '#0D1117', border: '#1C2430', probability: '#4DD0E1', collapse: '#E91E63',
      decay: '#FFB300', tunnel: '#F0F4F8', dead: '#3A4049', text: '#D7DEE6', muted: '#6B7684',
    });
    expect(glassEdge).toBe('rgba(77,208,225,0.35)');
  });
  it('motion: cubic-bezier(0.4,0,0.2,1), ≥700ms, only collapse snaps', () => {
    expect(motion.easeViscous.replace(/\s/g, '')).toBe('cubic-bezier(0.4,0,0.2,1)');
    expect(parseInt(motion.durSlow, 10)).toBeGreaterThanOrEqual(700);
    expect(parseInt(motion.durSlower, 10)).toBeGreaterThanOrEqual(700);
    expect(parseInt(motion.durCollapse, 10)).toBeLessThan(700);
  });
  it('fonts and shape', () => {
    expect(fonts.mono).toMatch(/JetBrains Mono/);
    expect(fonts.heading).toMatch(/Space Grotesk/);
    expect(fonts.headingWeight).toBe(600);
    expect(shape.cardBorderWidth).toBe('2px');
    expect(shape.cardRadius).toBe('0px');
    expect(shape.ruleWidth).toBe('1px');
  });
  it('INFO: quantumStateColor adds states ("decaying", "dead") that are not in the spec §5 Coin.state union', () => {
    expect(Object.keys(quantumStateColor).sort()).toEqual(['collapsed', 'dead', 'decaying', 'measured-alive', 'superposed', 'tunnelled']);
  });
});
