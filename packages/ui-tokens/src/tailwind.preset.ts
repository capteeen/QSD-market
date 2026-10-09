import type { Config } from 'tailwindcss';
import { colors, fonts, glassEdge, glow, motion, shape, typeScale } from './tokens.js';

/**
 * Tailwind 3.4 preset. Consume in apps/web:
 *
 *   import { preset } from '@qsd/ui-tokens';
 *   export default { presets: [preset], content: [...] } satisfies Config;
 *
 * Colour classes resolve to the CSS variables from tokens.css so the
 * brightfield theme override works without rebuilding Tailwind. The raw hex
 * values are also exposed under `qsd-*-hex` for places that cannot use vars
 * (e.g. canvas / WebGL uniforms in the scene package).
 */
export const preset = {
  darkMode: ['selector', ':root:not([data-theme="brightfield"])'],
  theme: {
    extend: {
      colors: {
        void: 'var(--qsd-void)',
        panel: 'var(--qsd-panel)',
        border: 'var(--qsd-border)',
        probability: 'var(--qsd-probability)',
        collapse: 'var(--qsd-collapse)',
        decay: 'var(--qsd-decay)',
        tunnel: 'var(--qsd-tunnel)',
        dead: 'var(--qsd-dead)',
        text: 'var(--qsd-text)',
        muted: 'var(--qsd-muted)',
        gold: 'var(--qsd-gold)',
        ice: 'var(--qsd-ice)',
        paper: 'var(--qsd-paper)',
        ink: 'var(--qsd-ink)',
        line: 'var(--qsd-line)',
        rim: 'var(--qsd-rim)',
        teal: 'var(--qsd-teal)',
        violet: 'var(--qsd-violet)',
        glass: 'var(--qsd-glass)',
        'glass-edge': 'var(--qsd-glass-edge)',
        'glow-inner': glow.computeInner,
        'glow-outer': glow.computeOuter,
        'void-hex': colors.void,
        'panel-hex': colors.panel,
        'border-hex': colors.border,
        'probability-hex': colors.probability,
        'collapse-hex': colors.collapse,
        'decay-hex': colors.decay,
        'tunnel-hex': colors.tunnel,
        'dead-hex': colors.dead,
        'text-hex': colors.text,
        'muted-hex': colors.muted,
        'gold-hex': colors.gold,
        'ice-hex': colors.ice,
        'paper-hex': colors.paper,
        'ink-hex': colors.ink,
        'line-hex': colors.line,
        'rim-hex': colors.rim,
        'teal-hex': colors.teal,
        'violet-hex': colors.violet,
      },
      fontFamily: {
        mono: fonts.mono.split(',').map((s) => s.trim()),
        heading: fonts.heading.split(',').map((s) => s.trim()),
      },
      fontSize: {
        xs: typeScale.xs,
        sm: typeScale.sm,
        base: typeScale.base,
        lg: typeScale.lg,
        xl: typeScale.xl,
        '2xl': typeScale['2xl'],
        '3xl': typeScale['3xl'],
      },
      fontWeight: {
        heading: String(fonts.headingWeight),
      },
      borderWidth: {
        rule: shape.ruleWidth,
        card: shape.cardBorderWidth,
      },
      borderRadius: {
        card: shape.cardRadius,
        quantum: shape.quantumRadius,
      },
      boxShadow: {
        'glow-compute': glow.compute,
        'glass-edge': `inset 0 0 0 1px ${glassEdge}`,
      },
      backgroundImage: {
        'glow-compute-radial': 'var(--glow-compute-radial)',
      },
      transitionTimingFunction: {
        viscous: motion.easeViscous,
      },
      transitionDuration: {
        slow: motion.durSlow,
        slower: motion.durSlower,
        collapse: motion.durCollapse,
      },
      backdropBlur: {
        glass: 'var(--qsd-glass-blur)',
      },
    },
  },
  plugins: [],
} satisfies Partial<Config>;

export type QsdPreset = typeof preset;
