/**
 * Agent H — every user-facing string in apps/web vs /docs/physics.md
 * (SPEC §2 l.86-90, §10 l.413-414). Three mechanisms:
 *
 *  1. Every string that mentions a physics noun (superposition, measurement,
 *     collapse, Zeno, entanglement, tunnelling, quantum, random, proof,
 *     verify, guarantee, fair, provable, photon, half-life, decay …) — from
 *     copy.ts (walked at runtime, functions called with marker arguments),
 *     from JSX text / prop literals in every .tsx under src, and from the
 *     layout metadata — must appear in REVIEWED with the physics.md section
 *     it was checked against and a verdict. An unreviewed sentence fails.
 *  2. Every string whose verdict is `overclaims` / `contradicts` has a
 *     FINDING test that fails while the string is still shipped.
 *  3. User-facing prose that lives outside copy.ts is pinned (copy.ts claims
 *     to hold "every user-facing string").
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import * as copy from '@/copy';
import { jsxStrings } from './jsx-strings';
import { metadata } from '@/app/layout';

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'apps/web/src');
const physics = readFileSync(path.join(ROOT, 'docs/physics.md'), 'utf8');
const economics = readFileSync(path.join(ROOT, 'docs/economics.md'), 'utf8');

const PHYSICS_WORDS = /superpos|measur|collaps|zeno|entangl|tunnel|quantum|random|proof|verif|guarantee|\bfair|provabl|photon|physic|half-life|decay|attest|qrng|witness|deterministic|probab/i;

type Verdict = 'ok' | 'overclaims' | 'contradicts';
interface Review {
  section: string;
  verdict: Verdict;
  note?: string;
}

/**
 * Agent H's review. Key = the exact string (template functions called with
 * the marker arguments below). "section" cites the physics.md heading (or
 * economics.md §) the sentence must agree with.
 */
const REVIEWED: Record<string, Review> = {
  // ── layout
  'A pump.fun launchpad where a coin that stops trading decays into a daughter coin, resolved by attested quantum randomness.': { section: 'physics.md: Measurement and collapse; Why quantum randomness … where the trust actually sits', verdict: 'ok' },
  'Quantum State Decay': { section: 'name', verdict: 'ok' },
  'QSD — Quantum State Decay': { section: 'name', verdict: 'ok' },
  // ── footer
  'A daughter coin is a new coin and can fail. QSD guarantees a share of the next attempt, not a return. Coins launch on pump.fun (Solana). A meme, not an investment.': { section: 'SPEC §8 verbatim', verdict: 'ok' },
  // ── home
  'A coin that stops trading decays; when a measurement resolves to collapse, a daughter coin is born and every holder of the mother receives a share of it at birth.': {
    section: 'physics.md: Measurement and collapse (outcome: survive, collapse into channel k, or tunnel); Tunnelling',
    verdict: 'ok',
    note: '"resolves to collapse" names the resolver outcome `collapse`, which excludes `tunnel`; economics §6 "every holder of the mother at the collapse block gets a share".',
  },
  'A coin launches on pump.fun in the game state “superposed”: some of its parameters are published as ranges rather than single numbers, and the decision that resolves them has not been made yet.': { section: 'physics.md: Superposition — How QSD uses it', verdict: 'ok' },
  'Its decay progress rises with time since its last trade, according to a half-life published at launch. Every buy partially resets it — the Zeno mechanic, named after the quantum Zeno effect; the resemblance is in the shape only.': { section: 'physics.md: The quantum Zeno effect — How QSD uses it / does NOT claim', verdict: 'ok' },
  'Anyone can measure a superposed coin. A measurement draws bytes from a hardware quantum random number generator and feeds them through a public, deterministic resolver: survive, collapse, or tunnel. Every outcome ships with a proof bundle anyone can verify.': {
    section: 'physics.md: Measurement and collapse — How QSD uses it; the short version ("a proof bundle that anyone can check against QSD’s published witness key")',
    verdict: 'ok',
    note: 'In-browser verification needs NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS; the coin page says so when it is unset (COIN.verifyNoKeys).',
  },
  'On collapse a daughter is born. Each holder’s share is their bag fraction times an entanglement weight computed from how they held — a fixed public function of the holder snapshot, verifiable by recomputation.': { section: 'physics.md: Entanglement — How QSD uses it (2); Summary table row "Collapse"', verdict: 'ok' },
  'coins in superposition': { section: 'physics.md: Superposition — "Superposed is a word for undecided and bound to a future quantum draw"; SPEC §8 mandates this label', verdict: 'ok', note: 'A state label, counted over the superposed/measured-alive/tunnelled states (economics §1).' },
  'measurements today': { section: 'physics.md: Measurement', verdict: 'ok' },
  'collapses': { section: 'physics.md: Measurement and collapse', verdict: 'ok' },
  'tunnels': { section: 'physics.md: Tunnelling', verdict: 'ok' },
  'next $QSD burn': { section: 'n/a (economics)', verdict: 'ok' },
  'A half-life, not a timer. The number only becomes an event when someone measures the coin.': { section: 'economics.md §1 verbatim', verdict: 'ok' },
  // ── field
  'superposed': { section: 'state label', verdict: 'ok' },
  'collapsed': { section: 'state label', verdict: 'ok' },
  'tunnelled': { section: 'state label', verdict: 'ok' },
  'measured · alive': { section: 'state label (economics §1 measured-alive)', verdict: 'ok' },
  'uncertainty': { section: 'band width (max−min)/max; a published range, physics.md Superposition', verdict: 'ok' },
  'half-life': { section: 'economics §1', verdict: 'ok' },
  'decay progress': { section: 'economics §1', verdict: 'ok' },
  'auto-measure': { section: 'economics §3', verdict: 'ok' },
  'auto-measurement at': { section: 'economics §3', verdict: 'ok' },
  'auto-measurement in': { section: 'economics §3', verdict: 'ok' },
  'quiet since': { section: 'economics §1 quiet time', verdict: 'ok' },
  'supply band (daughter pool)': { section: 'physics.md Superposition (supply band)', verdict: 'ok' },
  'PROBABILITY BAND': { section: 'physics.md Superposition ("probability cloud")', verdict: 'ok' },
  'Published ranges, outcome not yet drawn': { section: 'physics.md Summary table, row Superposed, verbatim', verdict: 'ok' },
  'While the coin is superposed some of its parameters are published as ranges. The cloud is a visualisation of a probability distribution we wrote down, not a physical state.': { section: 'physics.md: Superposition — What QSD does NOT claim', verdict: 'ok' },
  'DECAY CHANNELS': { section: 'physics.md Superposition', verdict: 'ok' },
  'probability': { section: 'channel probability (classical, sums to 1)', verdict: 'ok' },
  'daughter half-life range': { section: 'economics §5', verdict: 'ok' },
  'DECAY': { section: 'economics §1', verdict: 'ok' },
  'MEASUREMENTS': { section: 'physics.md Measurement', verdict: 'ok' },
  'Measurement history with proof bundles': { section: 'physics.md Measurement — proof bundle', verdict: 'ok' },
  'NOT YET MEASURED': { section: 'state', verdict: 'ok' },
  'No measurement has been made on this coin.': { section: 'state', verdict: 'ok' },
  'decay before': { section: 'economics §1', verdict: 'ok' },
  'decay after': { section: 'economics §1/§3', verdict: 'ok' },
  'Verify in browser': { section: 'physics.md: "re-verify with verify() from the open-source @qsd/quantum package"', verdict: 'ok' },
  'verifying…': { section: 'ui state', verdict: 'ok' },
  'no witness public key is published to this build (NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS)': { section: 'physics.md: where the trust sits (published witness key)', verdict: 'ok' },
  'not verified yet': { section: 'ui state', verdict: 'ok' },
  'Verified means: these exact bytes were applied to these exact inputs and produced this exact outcome, and the bundle has not been altered since it was formed. It does not prove the photons.': { section: 'physics.md: What QSD does NOT claim — and where the trust actually sits (the three bullets + "not the photons")', verdict: 'ok' },
  'The daughter’s parameters are a deterministic function of the mother’s final state; your share is your bag fraction times an entanglement weight between 1.0 and 1.5.': { section: 'physics.md: Entanglement — How QSD uses it (1) and (2)', verdict: 'ok' },
  'no holder snapshot or holding history exists for this coin yet': { section: 'state', verdict: 'ok' },
  'the connected wallet holds none of this coin': { section: 'state', verdict: 'ok' },
  'this coin has collapsed; the allocation is final': { section: 'economics §6', verdict: 'ok' },
  'projected share of the daughter pool': { section: 'economics §6', verdict: 'ok' },
  'projected daughter units': { section: 'economics §6', verdict: 'ok' },
  'entanglement weight': { section: 'physics.md Entanglement (2)', verdict: 'ok' },
  'MEASURE': { section: 'physics.md Measurement', verdict: 'ok' },
  'Measure': { section: 'step title', verdict: 'ok' },
  'verified': { section: 'ProofBadge status word; see tests/web/coin-page.test.tsx (H-W4) for when it is shown', verdict: 'ok' },
  'unverified': { section: 'ProofBadge status word', verdict: 'ok' },
  'decay': { section: 'sort key (economics §1 decay progress)', verdict: 'ok' },
  '(auto-measurement after': { section: 'economics §3 auto-measurement window (protocol constant per preset)', verdict: 'ok' },
  'Decay': { section: 'step title', verdict: 'ok' },
  'attestation': { section: 'physics.md where the trust sits (attestation kinds)', verdict: 'ok' },
  'proof tx': { section: 'physics.md Measurement (commitment anchored on-chain)', verdict: 'ok' },
  'no allocation table exists for this collapse': { section: 'economics §6', verdict: 'ok' },
  'inputs · decayProgressPpb': { section: 'economics §3 inputs', verdict: 'ok' },
  'inputs · measurementIndex': { section: 'economics §3 inputs', verdict: 'ok' },
  'Measure this coin': { section: 'physics.md Measurement', verdict: 'ok' },
  'Measuring draws bytes from a hardware QRNG and applies them to the coin through a public resolver. Measuring a coin does not perform a quantum measurement on the coin.': { section: 'physics.md: Measurement and collapse — What QSD does NOT claim (first bullet)', verdict: 'ok' },
  'connect a wallet to measure': { section: 'ui', verdict: 'ok' },
  'this coin is collapsed and cannot be measured': { section: 'economics §3 (collapsed is terminal)', verdict: 'ok' },
  'the quantum random number provider is not reachable; there is no fallback': { section: 'physics.md: Why quantum randomness — "no deterministic fallback in production"', verdict: 'ok' },
  'protocol health is not available': { section: 'ui', verdict: 'ok' },
  'measuring — waiting for the draw': { section: 'ui', verdict: 'ok' },
  'measurement recorded': { section: 'ui', verdict: 'ok' },
  'measurement failed': { section: 'ui', verdict: 'ok' },
  'This coin tunnelled: on collapse the same draw decided it re-emerges as itself, with every holder’s position intact. Nothing physically tunnelled; it is one branch of the resolver.': { section: 'physics.md: Tunnelling — How QSD uses it / does NOT claim', verdict: 'ok' },
  // ── lineage
  'COLLAPSE': { section: 'physics.md Measurement and collapse', verdict: 'ok' },
  'proof bundle': { section: 'physics.md Measurement', verdict: 'ok' },
  'measurements survived': { section: 'economics §5', verdict: 'ok' },
  // ── launch
  'half-life preset': { section: 'economics §1', verdict: 'ok' },
  'launching — every stage below is a real operation': { section: 'SPEC §7 CORE RULE; verified by tests/web/launch-stream.test.ts', verdict: 'ok' },
  'Every visual in the sequence is driven by a real event from the key generation, the quantum draw, the signature and the chain. If no event arrives, no stage advances and no value changes; the only motion without an event is the chamber’s ambient drift.': {
    section: 'SPEC §7 CORE RULE; packages/scene README §3 (documented ambient motion); tests/scene/stillness (no stage / count / value changes without an event)',
    verdict: 'ok',
    note: 'H-W5 fixed: the sentence now claims exactly what the scene tests prove (no state change without an event) and names the documented ambient motion.',
  },
  'The launch identity is generated on the server, in the protocol’s identity reserve. The hash chain values at depths below the tip are one-time secret key material, so the stream you see carries their SHA-256 commitments; every other hash is the real value.': { section: 'crypto README §3; verified byte-for-byte in tests/web/launch-stream.test.ts', verdict: 'ok' },
  // ── measure queue
  'MEASUREMENT QUEUE': { section: 'economics §3', verdict: 'ok' },
  'Nearest to auto-measurement': { section: 'economics §3', verdict: 'ok' },
  'If nobody measures a coin within its window, the protocol does. Collapse can be delayed by trading; it can never be avoided.': { section: 'economics.md §3 verbatim; physics.md Zeno ("A coin nobody touches drifts toward collapse")', verdict: 'ok' },
  'NOTHING TO MEASURE': { section: 'ui', verdict: 'ok' },
  'No coin is in a measurable state.': { section: 'ui', verdict: 'ok' },
  'collapse probability now': { section: 'economics §1: "the probability that the coin collapses is exactly its decay progress"', verdict: 'ok', note: 'economics §3 counts tunnelling as a kind of collapse, so the doc and the label agree.' },
  'if it collapses you receive': { section: 'economics §3 Collapse (measurer share)', verdict: 'ok' },
  'if it survives': { section: 'economics §3 Survive', verdict: 'ok' },
  'if it collapses you receive <U> <T> (<P> of remaining supply); if it survives you receive nothing — no measurement fee is charged — and <R> of the coin’s quiet time is removed': {
    section: 'economics.md §3 Collapse (measurer share); SURVIVE_RESET_BPS (75 % of quiet time removed on survive)',
    verdict: 'ok',
    note: 'H-W3 fixed: the app charges no measurement fee and pays nothing on survive, which is what the sentence now says. INFO H-W14: economics.md’s parameter table still lists SURVIVE_FEE_REBATE_BPS as "Measurement fee rebated on survive (10 %)" although no fee exists anywhere — a doc-vs-app gap outside apps/web copy.',
  },
  'the daughter launch has been handed to the collapse worker': { section: 'SPEC §9 l.380 (daughter launch fully automatic); server/measure.ts daughterLaunch status', verdict: 'ok' },
  'the daughter launch could NOT be scheduled; the mother is recorded as collapsed and the reconciliation job will retry': { section: 'SPEC §9 l.380; server/reconcile.ts (H-W7 fix: re-enqueues collapsed mothers without a daughter)', verdict: 'ok' },
  'current collapse probability: <U>': { section: 'economics §1', verdict: 'ok' },
  // ── burns
  'Each hour the protocol tallies its fees, buys $QSD and burns all of it.': { section: 'SPEC §9 l.390', verdict: 'ok' },
  // ── how
  'physics': { section: 'tab', verdict: 'ok' },
  'Rendered verbatim from the repository documents.': { section: 'SPEC §8 /how; verified in tests/web/how-verbatim.test.tsx', verdict: 'ok' },
  // ── me
  'Your projected daughter allocations': { section: 'economics §6', verdict: 'ok' },
  // ── shared
  'the quantum random number provider is not reachable': { section: 'physics.md no fallback', verdict: 'ok' },
  'survive': { section: 'outcome label', verdict: 'ok' },
  'collapse': { section: 'outcome label', verdict: 'ok' },
  'tunnel': { section: 'outcome label', verdict: 'ok' },
  'proof': { section: 'link label', verdict: 'ok' },
  // ── inline JSX strings (outside copy.ts)
  'the protocol (auto-measurement)': { section: 'economics §3 AUTO_MEASURER_ID', verdict: 'ok' },
  'decay recomputed from inputs': { section: 'economics §3 (decayProgressPpb must equal the formula)', verdict: 'ok' },
  'the inputs are not in the current format': { section: 'economics §3 (v1 bundles refused)', verdict: 'ok' },
  'daughter pool band as a share of this coin\'s total supply': { section: 'physics.md Superposition (supply band)', verdict: 'ok' },
  'source: the protocol’s trade log (': { section: 'SPEC §9 holder snapshot at collapse block', verdict: 'ok' },
  '); the chain snapshot at the collapse block is authoritative at collapse.': { section: 'SPEC §9 holder snapshot at collapse block', verdict: 'ok' },
  'open the coin page to verify in your browser': { section: 'physics.md verify()', verdict: 'ok' },
  'NO COLLAPSE YET': { section: 'ui', verdict: 'ok' },
  'No coin in this lineage has collapsed; the lineage is its generation-one coin.': { section: 'ui', verdict: 'ok' },
  '— the collapse is still executing': { section: 'ui', verdict: 'ok' },
  'collapsed at': { section: 'ui', verdict: 'ok' },
  'loading scene': { section: 'ui', verdict: 'ok' },
  'the coin has collapsed': { section: 'ui', verdict: 'ok' },
  '(at the band minimum)': { section: 'economics §5 (pool resolved inside the band at collapse)', verdict: 'ok' },
  'above base (': { section: 'economics §6 weight ∈ [1.0, 1.5]', verdict: 'ok' },
  'resolver': { section: 'physics.md public deterministic resolver', verdict: 'ok' },
};

// ───────────────────────────── collection ─────────────────────────────

const MARKERS = ['<U>', '<T>', '<P>', '<R>'];

function collectCopy(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (v: unknown, p: string): void => {
    if (typeof v === 'string') out.set(v, p);
    else if (typeof v === 'function') out.set(String((v as (...a: string[]) => string)(...MARKERS)), p);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${p}.${k}`);
  };
  for (const [k, v] of Object.entries(copy)) walk(v, k);
  out.set(String(metadata.description), 'layout.metadata.description');
  out.set(String(metadata.title), 'layout.metadata.title');
  return out;
}

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir)) {
    const p = path.join(dir, ent);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const copyStrings = collectCopy();
const inlineStrings = new Map<string, string>();
for (const f of tsxFiles(path.join(SRC, 'components')).concat(tsxFiles(path.join(SRC, 'app')))) {
  for (const s of jsxStrings(f)) if (!copyStrings.has(s)) inlineStrings.set(s, path.relative(SRC, f));
}

// ───────────────────────────── tests ─────────────────────────────

describe('user-facing copy vs docs/physics.md (SPEC §2 l.86-90, §10 l.413-414)', () => {
  it('collected a substantial corpus (sanity)', () => {
    expect(copyStrings.size).toBeGreaterThan(150);
    expect(inlineStrings.size).toBeGreaterThan(10);
  });

  it('every string mentioning a physics noun has been reviewed against a named physics.md / economics.md section (an unreviewed sentence fails here)', () => {
    const unreviewed: string[] = [];
    for (const [s, where] of [...copyStrings, ...inlineStrings]) {
      if (!PHYSICS_WORDS.test(s)) continue;
      // Labels that are only a bare physics word in a column header / nav are reviewed through their row entries above.
      if (REVIEWED[s]) continue;
      unreviewed.push(`${where}: ${JSON.stringify(s)}`);
    }
    expect(unreviewed).toEqual([]);
  });

  it('every reviewed sentence still exists (no stale review entries)', () => {
    const all = new Set([...copyStrings.keys(), ...inlineStrings.keys()]);
    const stale = Object.keys(REVIEWED).filter((s) => !all.has(s));
    expect(stale).toEqual([]);
  });

  it('every physics claim quotes or paraphrases physics.md in the direction physics.md allows: the "does NOT claim" sentences are present on the pages that use the word', () => {
    // The coin page must carry the three honesty sentences next to the three mechanics it shows.
    expect(copy.COIN.bandCaption).toMatch(/not a physical state/);
    expect(copy.COIN.measureCaption).toMatch(/does not perform a quantum measurement on the coin/);
    expect(copy.COIN.tunnelledNote).toMatch(/Nothing physically tunnelled/);
    expect(copy.HOME.steps[1].body).toMatch(/resemblance is in the shape only/);
    expect(copy.COIN.verifiedCaption).toMatch(/does not prove the photons/);
    // physics.md's own wording for the things above
    expect(physics).toMatch(/not a physical state|not physically in a superposition/);
    expect(physics).toMatch(/does not perform a quantum measurement \*on the coin\*/);
    expect(physics).toMatch(/Nothing physically tunnels/);
    expect(physics).toMatch(/The resemblance is in the shape only|analogy is only in the \*shape\*/);
    expect(physics).toMatch(/not the photons/);
  });

  it('the attestation kind is shown on every collapse (physics.md: "The UI shows the attestation kind on every collapse")', () => {
    const coinView = readFileSync(path.join(SRC, 'components/views/CoinView.tsx'), 'utf8');
    const lineageView = readFileSync(path.join(SRC, 'components/views/LineageView.tsx'), 'utf8');
    expect(coinView).toMatch(/<ProofBadge[^>]*attestationKind=\{kind\}/);
    expect(lineageView).toMatch(/<ProofBadge[^>]*attestationKind=\{c\.measurement\.attestationKind/);
    // and never described as provider-signed by the app itself
    for (const [s] of copyStrings) expect(s).not.toMatch(/provider-signed/i);
  });

  describe('flagged strings (fail until the copy or the implementation changes)', () => {
    it('FINDING H-W3 (MEDIUM): the MEASURE button promises "a fee rebate" on survive, but the app charges no measurement fee and nothing ever pays a rebate (surviveRebate is unreferenced in apps/web and packages/solana)', () => {
      const refs: string[] = [];
      const scan = (dir: string): void => {
        for (const ent of readdirSync(dir)) {
          const p = path.join(dir, ent);
          if (statSync(p).isDirectory()) scan(p);
          else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) && readFileSync(p, 'utf8').includes('surviveRebate')) refs.push(path.relative(ROOT, p));
        }
      };
      scan(path.join(ROOT, 'apps/web/src'));
      scan(path.join(ROOT, 'packages/solana/src'));
      // precondition (documents the fact): nobody computes or pays a rebate
      expect(refs).toEqual([]);
      // the finding: the copy still promises one
      const reward = copy.MEASURE_TEXT.reward('U', 'T', 'P', 'R');
      expect(reward).not.toMatch(/rebate/);
      const queue = readFileSync(path.join(SRC, 'components/views/MeasureQueueView.tsx'), 'utf8');
      expect(queue).not.toMatch(/fee rebate/);
    });

    it('FINDING H-W5 (LOW): LAUNCH.stageNote says "If no event arrives, nothing moves", but the scene package documents ambient motion with no event (chamber rings rotate, stage-1 coin pulses)', () => {
      const readme = readFileSync(path.join(ROOT, 'packages/scene/README.md'), 'utf8');
      // precondition: the scene README documents ambient motion
      expect(readme).toMatch(/ambient/i);
      // the finding
      expect(copy.LAUNCH.stageNote).not.toMatch(/nothing moves/);
    });
  });

  it('INFO H-W9: user-facing prose outside copy.ts (copy.ts header: "Every user-facing string in apps/web") — pinned so additions are reviewed', () => {
    const prose = [...inlineStrings].filter(([s]) => /[A-Za-z]{3,}\s[A-Za-z]{2,}/.test(s)).map(([s, f]) => `${f}: ${s}`).sort();
    expect(prose).toEqual(
      [
        'components/scenes.tsx: loading scene',
        'components/views/CoinView.tsx: (at the band minimum)',
        'components/views/CoinView.tsx: ); the chain snapshot at the collapse block is authoritative at collapse.',
        'components/views/CoinView.tsx: — generation one',
        'components/views/CoinView.tsx: — none born',
        'components/views/CoinView.tsx: above base (',
        'components/views/CoinView.tsx: band width',
        "components/views/CoinView.tsx: daughter pool band as a share of this coin's total supply",
        'components/views/CoinView.tsx: decay recomputed from inputs',
        'components/views/CoinView.tsx: does not match',
        'components/views/CoinView.tsx: self-consistent only',
        'components/views/CoinView.tsx: no trade has been seen by the protocol for this coin',
        'components/views/CoinView.tsx: source: the protocol’s trade log (',
        'components/views/CoinView.tsx: the coin has collapsed',
        'components/views/CoinView.tsx: the inputs are not in the current format',
        'components/views/CoinView.tsx: the protocol (auto-measurement)',
        'components/views/LaunchView.tsx: (auto-measurement after',
        'components/views/LaunchView.tsx: enter a number of SOL',
        'components/views/LineageView.tsx: NO COLLAPSE YET',
        'components/views/LineageView.tsx: collapsed at',
        'components/views/LineageView.tsx: No coin in this lineage has collapsed; the lineage is its generation-one coin.',
        'components/views/LineageView.tsx: no channel recorded',
        'components/views/LineageView.tsx: open the coin page to verify in your browser',
        'components/views/LineageView.tsx: — not anchored',
        'components/views/LineageView.tsx: — the collapse is still executing',
        'components/views/MeView.tsx: airdrop status',
        'components/views/MeView.tsx: no airdrop record for this wallet yet',
      ].sort(),
    );
  });

  it('economics.md and physics.md still carry the sentences the copy relies on', () => {
    expect(economics).toMatch(/Collapse can be\ndelayed by trading; it can never be avoided\./);
    expect(economics).toMatch(/It is a \*\*half-life, not a timer\*\*/);
    expect(economics).toMatch(/entanglement weight\*\* between 1\.0 and 1\.5/);
    expect(physics).toMatch(/Published parameter ranges, outcome not yet drawn/);
  });
});
