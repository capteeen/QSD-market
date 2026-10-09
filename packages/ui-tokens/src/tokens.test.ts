// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fontLinks, fontLinksHtml } from './fonts.js';
import { preset } from './tailwind.preset.js';
import { colors, glassEdge, glow, motion, quantumStateColor, specHexes } from './tokens.js';

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

describe('tokens.css', () => {
  const spec = {
    void: '#06080A',
    panel: '#0D1117',
    border: '#1C2430',
    probability: '#4DD0E1',
    collapse: '#E91E63',
    decay: '#FFB300',
    tunnel: '#F0F4F8',
    dead: '#3A4049',
    text: '#D7DEE6',
    muted: '#6B7684',
  } as const;

  for (const [name, hex] of Object.entries(spec)) {
    it(`contains ${name} ${hex}`, () => {
      expect(css.toUpperCase()).toContain(hex.toUpperCase());
      expect(colors[name as keyof typeof colors]).toBe(hex);
    });
  }

  it('contains every hex exported from tokens.ts', () => {
    for (const hex of specHexes) expect(css.toUpperCase()).toContain(hex.toUpperCase());
  });

  it('contains the glass edge and glow tokens', () => {
    expect(css).toContain(glassEdge);
    expect(css).toContain('--glow-compute');
    expect(css).toContain(glow.computeInner);
    expect(css).toContain(glow.computeOuter);
  });

  it('contains the motion tokens', () => {
    expect(css).toContain('--ease-viscous: cubic-bezier(0.4, 0, 0.2, 1)');
    expect(css).toContain('--dur-slow: 700ms');
    expect(css).toContain('--dur-collapse: 120ms');
    expect(motion.durSlow).toBe('700ms');
    expect(motion.durCollapse).toBe('120ms');
  });

  it('imports both fonts and has a brightfield override', () => {
    expect(css).toContain('JetBrains+Mono');
    expect(css).toContain('Space+Grotesk');
    expect(css).toContain('[data-theme="brightfield"]');
    expect(css).toContain('tabular-nums');
  });
});

describe('tailwind preset', () => {
  it('exposes every colour token as a CSS variable and a hex', () => {
    const c = preset.theme.extend.colors;
    for (const name of Object.keys(colors) as (keyof typeof colors)[]) {
      expect(c[name]).toBe(`var(--qsd-${name})`);
      expect(c[`${name}-hex`]).toBe(colors[name]);
    }
  });
  it('exposes motion and glow', () => {
    expect(preset.theme.extend.transitionTimingFunction.viscous).toBe(motion.easeViscous);
    expect(preset.theme.extend.transitionDuration.collapse).toBe('120ms');
    expect(preset.theme.extend.boxShadow['glow-compute']).toBe(glow.compute);
  });
  it('uses JetBrains Mono and Space Grotesk', () => {
    expect(preset.theme.extend.fontFamily.mono[0]).toBe("'JetBrains Mono'");
    expect(preset.theme.extend.fontFamily.heading[0]).toBe("'Space Grotesk'");
    expect(preset.theme.extend.fontWeight.heading).toBe('600');
  });
});

describe('quantumStateColor', () => {
  it('maps states to spec colours', () => {
    expect(quantumStateColor.superposed).toBe(colors.probability);
    expect(quantumStateColor.collapsed).toBe(colors.collapse);
    expect(quantumStateColor.tunnelled).toBe(colors.tunnel);
    expect(quantumStateColor.decaying).toBe(colors.decay);
    expect(quantumStateColor.dead).toBe(colors.dead);
  });
});

describe('fontLinks', () => {
  it('returns preconnects and a stylesheet', () => {
    const links = fontLinks();
    expect(links.map((l) => l.rel)).toEqual(['preconnect', 'preconnect', 'stylesheet']);
    expect(links[2]?.href).toContain('JetBrains+Mono');
    expect(fontLinksHtml()).toContain('<link rel="stylesheet"');
  });
});
