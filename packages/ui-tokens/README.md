# @qsd/ui-tokens

The QSD design system: tokens, a Tailwind preset, CSS variables, a small React
component kit and a Storybook.

Aesthetic: a quantum computer rendered as light in a void. Dark-field
laboratory. Glass and refraction. Clinical restraint in the chrome, spectacle
in the chamber.

```
pnpm --filter @qsd/ui-tokens test             # vitest + testing-library + jsdom
pnpm --filter @qsd/ui-tokens typecheck
pnpm --filter @qsd/ui-tokens storybook        # dev server on :6006
pnpm --filter @qsd/ui-tokens build-storybook  # → storybook-static/
```

## Tokens

Source of truth: `src/tokens.ts` (typed) mirrored by `src/tokens.css`
(custom properties). The test suite asserts every hex below appears in the CSS.

| Token | CSS var | Value | Use |
| --- | --- | --- | --- |
| `colors.void` | `--qsd-void` | `#06080A` | Page background |
| `colors.panel` | `--qsd-panel` | `#0D1117` | Raised surfaces |
| `colors.border` | `--qsd-border` | `#1C2430` | 1px rules, 2px card borders |
| `colors.probability` | `--qsd-probability` | `#4DD0E1` | Superposition, verified, alive |
| `colors.collapse` | `--qsd-collapse` | `#E91E63` | Collapse, invalid |
| `colors.decay` | `--qsd-decay` | `#FFB300` | Decay in progress, pending |
| `colors.tunnel` | `--qsd-tunnel` | `#F0F4F8` | Tunnelled (came back as itself) |
| `colors.dead` | `--qsd-dead` | `#3A4049` | Dead, unavailable, disabled |
| `colors.text` | `--qsd-text` | `#D7DEE6` | Body text |
| `colors.muted` | `--qsd-muted` | `#6B7684` | Labels, eyebrows, reasons |
| `glassEdge` | `--qsd-glass-edge` | `rgba(77,208,225,0.35)` | Refractive inner edge of panels |
| `glow.compute` | `--glow-compute` | magenta `#FF5CD6` → white `#FFFFFF` box-shadow stack | Live computation |
| — | `--glow-compute-radial` | radial-gradient of the same | Quantum objects while computing |
| `fonts.mono` | `--font-mono` | JetBrains Mono | **All** numbers, hashes, proofs, logs, labels |
| `fonts.heading` | `--font-heading` | Space Grotesk 600 | Headings only |
| `typeScale.xs…3xl` | `--text-xs…--text-3xl` | 11 / 13 / 15 / 18 / 24 / 36 / 56 px | Type scale |
| `motion.easeViscous` | `--ease-viscous` | `cubic-bezier(0.4, 0, 0.2, 1)` | Every transition |
| `motion.durSlow` | `--dur-slow` | `700ms` | Default duration |
| `motion.durSlower` | `--dur-slower` | `1400ms` | Reveals, lineage growth |
| `motion.durCollapse` | `--dur-collapse` | `120ms` | The one thing that snaps |
| `shape.cardRadius` | `--radius-card` | `0px` | Data cards: square-cornered |
| `shape.quantumRadius` | `--radius-quantum` | `9999px` | Quantum objects: circles |
| `shape.cardBorderWidth` | `--border-card` | `2px` | Slide-mount framing |
| `shape.ruleWidth` | `--border-rule` | `1px` | Rules |

`quantumStateColor` maps `superposed | measured-alive | collapsed | tunnelled |
decaying | dead` to the colour above; `LineageBreadcrumb` and `ProofBadge`
use it.

Dark ("darkfield") is the default. The optional light mode is enabled with
`<html data-theme="brightfield">`; it overrides the field colours only, so
Tailwind classes that resolve to the CSS variables switch without a rebuild.
`prefers-reduced-motion` zeroes the durations.

## Consuming in apps/web

```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss';
import { preset } from '@qsd/ui-tokens';

export default {
  presets: [preset],
  content: ['./app/**/*.{ts,tsx}', '../../packages/ui-tokens/src/**/*.{ts,tsx}'],
} satisfies Config;
```

```tsx
// app/layout.tsx
import '@qsd/ui-tokens/tokens.css';
import { fontLinks } from '@qsd/ui-tokens';

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-qsd>
      <head>{fontLinks().map((l) => <link key={l.rel + l.href} {...l} />)}</head>
      <body data-qsd>{children}</body>
    </html>
  );
}
```

`tokens.css` already `@import`s the Google Fonts stylesheet; `fontLinks()` is
for apps that prefer `<link>` + preconnect in the head. Use either.

Tailwind classes the preset adds: `bg-void`, `text-probability`,
`border-collapse`, … (CSS-var backed); `*-hex` variants with raw hex for canvas
and WebGL; `font-mono`, `font-heading`, `font-heading` weight; `border-rule`,
`border-card`; `rounded-card`, `rounded-quantum`; `shadow-glow-compute`,
`shadow-glass-edge`; `bg-glow-compute-radial`; `ease-viscous`;
`duration-slow`, `duration-slower`, `duration-collapse`; `backdrop-blur-glass`.

## Component API

All components are in `src/components/` and re-exported from the package
index. They are styled by class names defined in `tokens.css` (prefix `qsd-`),
so the CSS must be loaded; Tailwind is not required to use them.

### `Unavailable`
`{ reason: string; label?: string }` — the one honest fallback: `—  not
available (reason)`. Contains no digits by construction. Everything below
delegates to it.

### `Panel`
`{ eyebrow?, title?, computing?, unavailable?: { reason, label? }, children }`
plus `<section>` attributes. Glass surface, 2px square border, cyan inner
edge. `computing` adds `--glow-compute` and `aria-busy`. `unavailable`
replaces the children with the dashed unavailable state.

### `DataRow`
`{ label, value?: string | number, unit?, unavailable?: { reason, label? },
format? }`. Value is mono + tabular-nums. When `value` is `undefined`,
`null` or `NaN` the row renders the unavailable state and **never a digit**.
`0` is rendered as `0` because `0` is a real value.

### `HashDisplay`
`{ hash?, head = 8, tail = 6, full?, copyable = true, unavailable?,
onCopied?, feedbackMs = 1400 }`. Middle-ellipsis truncation, full hash in
`title`/`aria-label`, copy button via `navigator.clipboard` with
`copied` / `copy failed` feedback that fades back after `feedbackMs`. Empty
or undefined → `—  no hash (reason)`. Helper: `truncateMiddle(s, head, tail)`.

### `ProofBadge`
`{ status: 'verified' | 'unverified' | 'invalid' | 'pending' | 'unavailable',
reason?, label? }`. Colour mapping (exported as `proofStatusToken`):

| status | token | colour |
| --- | --- | --- |
| verified | probability | cyan |
| pending | decay | amber (dot pulses) |
| invalid | collapse | magenta |
| unverified | muted | grey text |
| unavailable | dead | dead grey, dashed |

Every non-verified status shows its reason (or "no reason given").

### `MeasureButton`
`{ reward?, risk?, disabledReason?, measuring?, label = 'Measure' }` plus
`<button>` attributes. Reward and risk are opaque, already-formatted strings
from the protocol layer and are shown only when provided. `disabledReason`
disables the button and renders `Measurement unavailable: <reason>`.
`measuring` disables it, sets `aria-busy`, and lights the computation glow.
`:active` is the one interaction that snaps (`--dur-collapse`).

### `Countdown`
`{ target?: ISO string, unavailable?, elapsedLabel = '00:00:00', onElapsed?,
now?, size = 'md' }`. Mono `HH:MM:SS` (hours grow past 99) ticking at 1 Hz
with a slow fade on each change. `undefined` or an unparsable timestamp →
`—  no scheduled time (reason)`. `now` is injectable for tests. Helpers:
`formatHMS(ms)`, `parseTarget(iso)`.

### `LineageBreadcrumb`
`{ nodes?: { label, href?, generation, state: QuantumState }[], unavailable?,
renderLink? }`. Renders `g0 MOTHER → g1 DAUGHTER → g2 CURRENT` with a circle
in each node's state colour; the last node is `aria-current="page"`.
`renderLink` lets Next.js supply `<Link>`. Empty or undefined →
`—  no lineage yet (reason)`.

### `EmptyState`
`{ eyebrow, sentence, action?: { label, href? | onClick? } }`. Icon-less:
mono eyebrow, one sentence, optional single action. This is what every page
renders when there is no live data.

## The "no placeholder numbers" rule

SPEC §2: *Nothing invented. If a holder count, a price, or a proof is
unavailable, the UI says so. No placeholder numbers, ever.*

How each component honours it:

- **`Unavailable`** is the only fallback and renders no digits. Tests assert
  `/\d/` never matches its output.
- **`DataRow`** has no default for `value`. `undefined`/`null`/`NaN` →
  `Unavailable`. The test "never renders a digit when value is undefined"
  guards this, with and without a `reason`.
- **`HashDisplay`** renders `no hash` for empty input. It never shows a
  dummy hash or zero-padded placeholder.
- **`ProofBadge`** has an explicit `unavailable` status (dead grey) and
  always surfaces a reason for anything that is not `verified`.
- **`MeasureButton`** shows reward/risk only when the caller passes them,
  and replaces its label with the disabled reason when measurement is
  impossible — it does not grey out silently.
- **`Countdown`** renders `no scheduled time` for `undefined` and for
  unparsable input instead of `00:00:00`. It reaches `00:00:00` only when a
  real target has elapsed.
- **`LineageBreadcrumb`** renders `no lineage yet` for an empty chain
  instead of a lone genesis node.
- **`EmptyState`** exists so pages have something honest to render.
- **Stories** use labelled example input only. The example hash is the
  SHA-256 of `"qsd"`, computed in the browser with WebCrypto at story time,
  never typed in; the countdown story targets 90 s after mount and says so.

## Files

```
src/
  tokens.ts            typed tokens + quantumStateColor + specHexes
  tokens.css           CSS variables, brightfield override, component classes
  tailwind.preset.ts   `preset` for Tailwind 3.4
  fonts.ts             fontLinks() / fontLinksHtml() for Next.js heads
  index.ts             public API
  components/          Panel, DataRow, HashDisplay, ProofBadge, MeasureButton,
                       Countdown, LineageBreadcrumb, EmptyState, Unavailable
  stories/             one story file per component + Tokens (colours, glow,
                       type scale, motion)
.storybook/            Storybook 8, react-vite, darkfield/brightfield toolbar
```
