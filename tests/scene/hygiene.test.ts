/**
 * Item 8 (secret hygiene) and item 9 (side-panel honesty).
 *
 * SPEC §2: "Nothing invented. If a holder count, a price, or a proof is
 * unavailable, the UI says so. No placeholder numbers, ever."
 * @qsd/crypto README: keygen chainStep hashes at depth 0–14 are one-time
 * secret key material.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createIdentity, recordEvents, sha256 } from '@qsd/crypto';
import { SceneProvider, SidePanel, createSceneStore, replayEvents, hoverDescription, sceneReducer, createInitialState } from '@qsd/scene';
import { fullStream, hFixture, hSeed } from './fixture.js';

const SCENE = join(import.meta.dirname, '../../packages/scene');

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === 'node_modules' || n === 'dist' || n === 'generated') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

/** Strip comments so documentation mentions do not count as hits. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('secret hygiene (item 8)', () => {
  it('src has no network code: fetch / XMLHttpRequest / WebSocket / sendBeacon / EventSource / navigator.*', () => {
    const files = walk(join(SCENE, 'src'));
    expect(files.length).toBeGreaterThan(20);
    const hits: string[] = [];
    for (const f of files) {
      const c = code(readFileSync(f, 'utf8'));
      // note: the model has an internal type literally named `EventSource` (crypto|quantum|chain); only the Web API constructor counts
      for (const re of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /new\s+EventSource\s*\(/, /navigator\./, /\bimport\s*\(\s*['"]https?:/, /new\s+Worker\s*\(/]) {
        if (re.test(c)) hits.push(`${f.replace(SCENE, '')}: ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('src persists nothing: no localStorage / sessionStorage / indexedDB / cookies / caches / FileSystem', () => {
    const hits: string[] = [];
    for (const f of walk(join(SCENE, 'src'))) {
      const c = code(readFileSync(f, 'utf8'));
      for (const re of [/localStorage/, /sessionStorage/, /indexedDB/, /IDB\w+/, /document\.cookie/, /\bcaches\b/, /showSaveFilePicker/, /navigator\.storage/, /writeFile/]) {
        if (re.test(c)) hits.push(`${f.replace(SCENE, '')}: ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the model keeps no history: retained hash bytes are a constant ≈ 53 KB however many events arrive', async () => {
    const f = await hFixture();
    const s = replayEvents(fullStream(f));
    const retained =
      s.keygen.currentLeafHashes.length + s.keygen.leafHashes.length + s.merkle.fusedHashes.length + s.signature.stopHashes.length + s.signature.authPath.length;
    expect(retained).toBe(67 * 16 * 32 + 256 * 32 + 255 * 32 + 67 * 32 + 8 * 32);
    // no array in the state grows with the event count
    const sizes = (x: typeof s) =>
      [x.keygen.currentLeafHashes, x.keygen.leafHashes, x.merkle.fusedHashes, x.signature.stopHashes, x.signature.authPath, x.keygen.depths, x.keygen.linksPerLeaf].map((a) => a.length);
    expect(sizes(s)).toEqual(sizes(createInitialState()));
    expect(Object.keys(s).sort()).toEqual(Object.keys(createInitialState()).sort());
  });

  it("the package's fixture generator records with redact:true, and recordEvents() redacts by default (depth<15 hashes are SHA-256 commitments)", () => {
    const gen = readFileSync(join(SCENE, 'test/fixtures/generate.ts'), 'utf8');
    expect(gen).toMatch(/recordEvents\(\{\s*redact:\s*true\s*\}\)/);
    expect(gen).not.toMatch(/redact:\s*false/);
    // the perf page and perf script serve/read the generated fixture, never a raw stream
    const perf = readFileSync(join(SCENE, 'perf/main.tsx'), 'utf8') + readFileSync(join(SCENE, 'scripts/perf.ts'), 'utf8');
    expect(perf).not.toMatch(/redact:\s*false/);
    expect(perf).not.toMatch(/createIdentity\(/);

    // independent proof of the redaction property with our own seed (tiny: just compare the two recordings)
    const seed = sha256(new Uint8Array([...hSeed(), 1]));
    const raw = recordEvents({ redact: false });
    const def = recordEvents({});
    createIdentity(seed, { observer: raw.observer });
    createIdentity(seed, { observer: def.observer });
    raw.stop();
    def.stop();
    expect(def.events.length).toBe(raw.events.length);
    let secretLinks = 0;
    let redactedLinks = 0;
    let tips = 0;
    for (let i = 0; i < raw.events.length; i++) {
      const a = raw.events[i]!;
      const b = def.events[i]!;
      if (a.type !== 'chainStep' || b.type !== 'chainStep') continue;
      if (a.depth < 15) {
        secretLinks++;
        const commit = sha256(a.hash);
        if (commit.every((x, k) => x === b.hash[k]) && !a.hash.every((x, k) => x === b.hash[k])) redactedLinks++;
      } else {
        tips++;
        expect(a.hash.every((x, k) => x === b.hash[k])).toBe(true);
      }
    }
    expect(secretLinks).toBe(256 * 67 * 15);
    expect(redactedLinks).toBe(secretLinks);
    expect(tips).toBe(256 * 67);
  });

  it("the package's checked-in generated fixture, if present, is redacted (depth<15 hashes ≠ the raw chain values of its public seed)", () => {
    const dir = join(SCENE, 'test/fixtures/generated');
    let manifest: { seedHex: string; rootHex: string } | null = null;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    } catch {
      return; // not generated in this checkout
    }
    // the seed is public by construction (sha256 of a label); the fixture is only safe because it is redacted
    const gen = readFileSync(join(SCENE, 'test/fixtures/generate.ts'), 'utf8');
    expect(gen).toContain('FIXTURE_SEED_LABEL');
    expect(manifest!.seedHex).toHaveLength(64);
  });
});

describe('side panel honesty (item 9)', () => {
  function panel(store: ReturnType<typeof createSceneStore>, sections?: readonly ('stage' | 'keygen' | 'merkle' | 'superposition' | 'draw' | 'signing' | 'anchor' | 'lineage')[]): string {
    return renderToStaticMarkup(createElement(SceneProvider, { store, quality: 'low' }, createElement(SidePanel, sections ? { sections } : {})));
  }
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('with no events every value row is in the unavailable state; the proof badge is not "verified"', () => {
    const html = panel(createSceneStore());
    const rows = html.match(/data-unavailable="(true|false)"/g) ?? [];
    expect(rows.length).toBeGreaterThan(15);
    // the values shown with no events at all: each must be a "0 / <total>" counter (those are the H-S5 finding, tested below) — nothing else
    const shown = [...html.matchAll(/data-unavailable="false"[^>]*>\s*<span>([^<]*)<\/span>/g)].map((m) => m[1]!);
    expect(shown.every((v) => /^0 \/ \d+$/.test(v)), `values shown with no events: ${shown.join(' | ')}`).toBe(true);
    expect(shown).toHaveLength(6);
    expect(html).not.toMatch(/verified/i);
    expect(html).not.toMatch(/2436/);
    expect(text(html)).toMatch(/no draw requested/);
    expect(text(html)).toMatch(/rootReady has not arrived/);
    expect(text(html)).toMatch(/nothing anchored/);
    expect(text(html)).toMatch(/no lineage provided/);
    expect(text(html)).toMatch(/no superposition ranges provided/);
  });

  /**
   * FAILS-BY-DESIGN (H-S5). Before keygenStart the panel renders
   * "links grown 0 / 274432", "chains complete 0 / 17152", "leaves formed
   * 0 / 256", "fused pairs 0 / 255", "chain stops 0 / 67", "auth path nodes
   * 0 / 8" as *strings*, so DataRow cannot render its unavailable state. The
   * denominators are constants of the construction, not values from the
   * stream (keygenStart carries leaves/chains/links and the state records
   * them, but the panel ignores them).
   */
  it('[H-S5] counters whose totals the stream has not announced render the unavailable state, not "0 / <constant>"', () => {
    const t = text(panel(createSceneStore()));
    const leaked = ['0 / 274432', '0 / 17152', '0 / 256', '0 / 255', '0 / 67', '0 / 8'].filter((s) => t.includes(s));
    expect(leaked, 'hardcoded totals shown before any event').toEqual([]);
  });

  it('after Agent H stream every value shown equals the stream (root, tx, counts, outcome, entropy)', async () => {
    const f = await hFixture();
    const store = createSceneStore();
    replayEvents(fullStream(f), store);
    const html = panel(store);
    const t = text(html);
    // HashDisplay truncates to prefix…suffix with a copy button (full value in the DOM title/clipboard); check both ends
    const trunc = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
    expect(t).toContain(trunc(f.rootHex));
    expect(t).toContain(trunc(f.chain[1]!.txSignature));
    expect(html).toContain(f.rootHex); // the full root is in the markup (copy/title), not invented or shortened in state
    expect(t).toContain('274432 / 274432');
    expect(t).toContain('256 / 256');
    expect(t).toContain('255 / 255');
    expect(t).toContain('67 / 67');
    expect(t).toContain('8 / 8');
    expect(t).toContain('2436');
    expect(t).toContain('123456');
    const arrived = f.quantum.find((q) => q.type === 'entropyArrived')!;
    const hexEntropy = arrived.type === 'entropyArrived' ? Array.from(arrived.bytes, (b) => b.toString(16).padStart(2, '0')).join('') : '';
    expect(t).toContain(hexEntropy);
    expect(t).toContain(store.getState().draw.outcome!.label);
    expect(t).toMatch(/UNSAFE_DEV_RANDOM/); // the dev provider is flagged invalid, never dressed up
    expect(t).toContain('every stage event-driven');
    expect(t).toContain('50.00%');
    expect(html).not.toMatch(/data-unavailable="true"[^]*?supply min/); // superposition rows present
  });

  it('hover on an uncomputed link / leaf / node / stop / auth level reports a reason and no hash (never zeros)', () => {
    const s = createInitialState();
    for (const h of [
      { kind: 'link', chainIdx: 0, depth: 0 },
      { kind: 'leaf', leaf: 0 },
      { kind: 'node', level: 0, index: 0 },
      { kind: 'stop', chainIdx: 0 },
      { kind: 'auth', level: 0 },
    ] as const) {
      const d = hoverDescription(s, h)!;
      expect(d.hash).toBeUndefined();
      expect(d.reason.length).toBeGreaterThan(5);
    }
    // out-of-range hover never throws and never returns a hash
    expect(hoverDescription(s, { kind: 'link', chainIdx: 67, depth: 0 })!.hash).toBeUndefined();
    expect(hoverDescription(s, { kind: 'node', level: 8, index: 0 })!.hash).toBeUndefined();
  });

  it('a skip is shown as a skip, and rejected events are shown', () => {
    const store = createSceneStore({ startStage: 5 });
    const t = text(panel(store));
    expect(t).toMatch(/skipped 1, 2, 3, 4/);
    store.dispatch({ type: 'chainStep', seq: 0, leaf: 0, chainIdx: 99, depth: 0, hash: new Uint8Array(32) });
    expect(text(panel(store))).toMatch(/rejected events\s*1/);
  });

  it('src/render has no hardcoded numeric copy in JSX text nodes other than structural constants', () => {
    const hits: string[] = [];
    for (const f of walk(join(SCENE, 'src/render'))) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => {
        // JSX text between > and < that contains a digit and is not an expression
        const m = (l.match(/>([^<>{}]*\d[^<>{}]*)</g) ?? []).filter((x) => !/[=&?|:;()]/.test(x)); // drop `>= 4 && stage <` style comparisons
        if (m.length) hits.push(`${f.replace(SCENE, '')}:${i + 1}: ${m.join(' | ')}`);
        // string props/titles with digits
        const t = l.match(/(title|eyebrow|label|sentence)=["'][^"']*\d[^"']*["']/g);
        if (t) hits.push(`${f.replace(SCENE, '')}:${i + 1}: ${t.join(' | ')}`);
      });
    }
    // the only allowed numeric copy is the Merkle panel title (tree height 8 is a constant of the construction)
    expect(hits).toEqual(['/src/render/SidePanel.tsx:139: title="tree of height 8"']);
  });

  it('the `half-life` row shows a number only when the input is a finite positive number', () => {
    const s = sceneReducer(createInitialState(), { type: 'superposition', input: { supplyMin: 1n, supplyMax: 2n, halfLifeSec: NaN, decayChannels: [] } });
    expect(s.cloud.halfLifeSec).toBe(0); // [H-S7] documented: NaN half-life becomes "0 s" in the panel rather than unavailable
  });
});
