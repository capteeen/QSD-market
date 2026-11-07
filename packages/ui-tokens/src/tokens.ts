/**
 * QSD design tokens — the single typed source of truth.
 *
 * Aesthetic (2026-10, modelled on animejs.com): a warm near-black machine
 * room, off-white type, one mechanical object drawn solid with a peach rim
 * light on dark sections and as grey line-art on warm paper sections. Mono
 * for every number, big sans headlines with one accent per section.
 *
 * `tokens.css` mirrors these values as CSS custom properties and
 * `tailwind.preset.ts` exposes them as Tailwind theme entries. If you change
 * a value here, change it there too — the test suite asserts that every hex
 * in this file appears in `tokens.css`.
 */

export const colors = {
  /** Page background. A warm near-black, never blue. */
  void: '#252423',
  /** Raised surface for panels, cards and terminals. */
  panel: '#2E2D2C',
  /** 1px rules and card borders. */
  border: '#3D3B39',
  /** Lime. Superposition, probability, verified proofs, "alive", the live dot. */
  probability: '#BFEF5A',
  /** Coral red. Collapse, invalid proofs, the one thing that snaps. */
  collapse: '#FF6B5E',
  /** Amber. Decay in progress, pending, warnings. */
  decay: '#F5B04B',
  /** Near-white. Tunnelling — the coin that came back as itself. */
  tunnel: '#F5F2EC',
  /** Grey. Dead, unavailable, disabled. */
  dead: '#57544F',
  /** Body text. Off-white, not pure white. */
  text: '#F2EFE9',
  /** Secondary text, eyebrows, labels. Quiet warm grey. */
  muted: '#9A958D',
  /** Warm gold. The glowing core of the quantum stack (3D scene). */
  gold: '#F0A845',
  /** Cool blue. The qubit at the centre of the core; the fifth dial arc. */
  ice: '#6FA2FF',
  /** Light-section background: warm paper grey. */
  paper: '#D9D7D2',
  /** Text on paper. */
  ink: '#262524',
  /** Line-art strokes on paper (the exploded blueprint). */
  line: '#8A8781',
  /** Peach rim light on the dark machine. */
  rim: '#F6C9A6',
  /** Teal. The fourth dial arc; measurement in flight. */
  teal: '#5CDFB4',
  /** Violet. The sixth dial arc; lineage. */
  violet: '#B18BFF',
} as const;

export type ColorToken = keyof typeof colors;

/** Faint warm-white hairline used for the inner edge of panels. */
export const glassEdge = 'rgba(245,242,236,0.06)' as const;

/**
 * The computation glow: peach → white. Applied as a box-shadow stack while
 * a real operation (hash chain, QRNG draw, signature) is in flight.
 */
export const glow = {
  computeInner: '#F6C9A6',
  computeOuter: '#FFFFFF',
  /** Full box-shadow value. Mirrors `--glow-compute` in tokens.css. */
  compute:
    '0 0 2px #FFFFFF, 0 0 8px rgba(246,201,166,0.9), 0 0 24px rgba(246,201,166,0.55), 0 0 64px rgba(246,201,166,0.25)',
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
  /** Cards, terminals and buttons share one soft radius. */
  cardRadius: '8px',
  cardBorderWidth: '1px',
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
  colors.gold,
  colors.ice,
  colors.paper,
  colors.ink,
  colors.line,
  colors.rim,
  colors.teal,
  colors.violet,
];
