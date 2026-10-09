/**
 * QSD design tokens — the single typed source of truth.
 *
 * Aesthetic: a quantum computer rendered as light in a void. Dark-field
 * laboratory. Glass and refraction. Clinical restraint in the chrome,
 * spectacle in the chamber.
 *
 * `tokens.css` mirrors these values as CSS custom properties and
 * `tailwind.preset.ts` exposes them as Tailwind theme entries. If you change
 * a value here, change it there too — the test suite asserts that every hex
 * in this file appears in `tokens.css`.
 */

export const colors = {
  /** Page background. The void the chamber sits in. */
  void: '#06080A',
  /** Raised surface for panels and cards. */
  panel: '#0D1117',
  /** 1px rules and 2px card borders. */
  border: '#1C2430',
  /** Cyan. Superposition, probability, verified proofs, "alive". */
  probability: '#4DD0E1',
  /** Magenta. Collapse, invalid proofs, the one thing that snaps. */
  collapse: '#E91E63',
  /** Amber. Decay in progress, pending, warnings. */
  decay: '#FFB300',
  /** Near-white. Tunnelling — the coin that came back as itself. */
  tunnel: '#F0F4F8',
  /** Grey. Dead, unavailable, disabled. */
  dead: '#3A4049',
  /** Body text. */
  text: '#D7DEE6',
  /** Secondary text, eyebrows, labels. */
  muted: '#6B7684',
} as const;

export type ColorToken = keyof typeof colors;

/** Translucent cyan used for the refractive edge of glass panels. */
export const glassEdge = 'rgba(77,208,225,0.35)' as const;

/**
 * The computation glow: magenta → white. Applied as a box-shadow stack while
 * a real operation (hash chain, QRNG draw, signature) is in flight.
 */
export const glow = {
  computeInner: '#FF5CD6',
  computeOuter: '#FFFFFF',
  /** Full box-shadow value. Mirrors `--glow-compute` in tokens.css. */
  compute:
    '0 0 2px #FFFFFF, 0 0 8px rgba(255,92,214,0.9), 0 0 24px rgba(255,92,214,0.55), 0 0 64px rgba(255,92,214,0.25)',
} as const;

export const fonts = {
  /** ALL numbers, hashes, proofs, logs, labels. */
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  /** Headings only, weight 600. */
  heading: "'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif",
  headingWeight: 600,
} as const;

/** Type scale in rem. Tabular-nums everywhere. */
export const typeScale = {
  xs: '0.6875rem', // 11px — eyebrows, dense labels
  sm: '0.8125rem', // 13px — data rows, hashes
  base: '0.9375rem', // 15px — body
  lg: '1.125rem', // 18px — panel titles
  xl: '1.5rem', // 24px — section headings
  '2xl': '2.25rem', // 36px — page headings
  '3xl': '3.5rem', // 56px — the one big number in the chamber
} as const;

export type TypeScaleToken = keyof typeof typeScale;

export const motion = {
  /** Slow, physical, viscous. Everything uses this. */
  easeViscous: 'cubic-bezier(0.4, 0, 0.2, 1)',
  /** Default duration. Nothing is faster than this except a collapse. */
  durSlow: '700ms',
  /** Longer transitions — panel reveals, lineage growth. */
  durSlower: '1400ms',
  /** The one thing that snaps. */
  durCollapse: '120ms',
} as const;

export const shape = {
  /** Data cards are square-cornered, slide-mount framed. */
  cardRadius: '0px',
  cardBorderWidth: '2px',
  ruleWidth: '1px',
  /** Quantum objects are circles and ellipses. */
  quantumRadius: '9999px',
} as const;

export const spacing = {
  rule: '1px',
  hairline: '2px',
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2.5rem',
  '2xl': '4rem',
} as const;

export const tokens = {
  colors,
  glassEdge,
  glow,
  fonts,
  typeScale,
  motion,
  shape,
  spacing,
} as const;

export type Tokens = typeof tokens;

/**
 * The quantum states a coin can be in, mapped to the colour that represents
 * them everywhere in the UI (lineage dots, badges, the chamber itself).
 */
export const quantumStateColor = {
  superposed: colors.probability,
  'measured-alive': colors.probability,
  collapsed: colors.collapse,
  tunnelled: colors.tunnel,
  decaying: colors.decay,
  dead: colors.dead,
} as const;

export type QuantumState = keyof typeof quantumStateColor;

/** Every hex literal in the spec, for tests and for the Tokens story. */
export const specHexes: readonly string[] = [
  colors.void,
  colors.panel,
  colors.border,
  colors.probability,
  colors.collapse,
  colors.decay,
  colors.tunnel,
  colors.dead,
  colors.text,
  colors.muted,
];
