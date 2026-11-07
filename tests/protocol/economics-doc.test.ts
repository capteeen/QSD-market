/**
 * Agent H — docs/economics.md parsed independently: every PROTOCOL_PARAMS
 * constant present with an equal value, nothing extra, and every worked
 * example reproduced to the unit. Spec §5 l.188-189, l.203-205 ("Fully
 * documented formula in /docs/economics.md with worked examples"), §8 l.360
 * (`/how` renders it verbatim).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  HALF_LIFE_PRESETS,
  PROTOCOL_PARAMS,
  collapseRewards,
  computeAllocation,
  longevityBps,
  resolvePoolUnits,
  surviveRebate,
  type HolderSnapshot,
} from '@qsd/protocol';

const here = path.dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(path.join(here, '..', '..', 'docs', 'economics.md'), 'utf8');

function parseParamTable(md: string): Map<string, string | number> {
  const out = new Map<string, string | number>();
  for (const line of md.split('\n')) {
    const m = /^\| `([A-Z_]+)` \| (.+?) \| /.exec(line);
    if (!m) continue;
    const raw = m[2]!.trim();
    const bt = /^`(.*)`$/.exec(raw);
    if (bt) out.set(m[1]!, bt[1]!);
    else if (/^-?\d+$/.test(raw)) out.set(m[1]!, Number(raw));
    else out.set(m[1]!, raw);
  }
  return out;
}

describe('economics.md ↔ PROTOCOL_PARAMS', () => {
  const table = parseParamTable(doc);

  it('every exported constant is in the table with an equal value, and the table has nothing the code does not export', () => {
    expect(table.size).toBeGreaterThan(20);
    for (const [k, v] of Object.entries(PROTOCOL_PARAMS)) {
      expect(table.has(k), `missing ${k}`).toBe(true);
      expect(table.get(k), `value of ${k}`).toBe(v);
    }
    for (const k of table.keys()) expect(k in PROTOCOL_PARAMS, `undocumented-in-code ${k}`).toBe(true);
  });

  it('percentages quoted in the prose equal the constants', () => {
    const pct = (bps: number) => `${bps / 100} %`.replace('.5 %', '.5 %');
    expect(doc).toContain(`Max quiet time one buy can remove (${pct(PROTOCOL_PARAMS.ZENO_RESET_CAP_BPS)})`);
    expect(doc).toContain(`Quiet time removed by a survived measurement (${pct(PROTOCOL_PARAMS.SURVIVE_RESET_BPS)})`);
    expect(doc).toContain(`Tunnelling probability on collapse (${PROTOCOL_PARAMS.TUNNEL_PROBABILITY_PPM / 10_000} %)`);
    expect(doc).toContain(`Share of remaining supply removed on collapse (${pct(PROTOCOL_PARAMS.COLLAPSE_BURN_BPS)})`);
    expect(doc).toContain(`Share of the removed amount paid to the measurer (${pct(PROTOCOL_PARAMS.MEASURER_SHARE_OF_BURN_BPS)})`);
    expect(doc).toContain(`share of a measurement fee rebated on survive (${pct(PROTOCOL_PARAMS.SURVIVE_FEE_REBATE_BPS)})`);
    expect(doc).toContain(`Largest entanglement weight (${PROTOCOL_PARAMS.ENTANGLEMENT_WEIGHT_MAX_BPS / 10_000}×)`);
    expect(doc).toMatch(/L = 0\.5 fL \+ 0\.3 fM \+ 0\.2 fS/);
    expect(PROTOCOL_PARAMS.DAUGHTER_W_LIFETIME_BPS + PROTOCOL_PARAMS.DAUGHTER_W_MEASUREMENTS_BPS + PROTOCOL_PARAMS.DAUGHTER_W_SUPPLY_BPS).toBe(10_000);
    expect(doc).toMatch(/weight = 1 \+ 0\.5 × \( 0\.5 fD \+ 0\.3 fM \+ 0\.2 fQ \)/);
    expect(PROTOCOL_PARAMS.ALLOC_W_DURATION_BPS + PROTOCOL_PARAMS.ALLOC_W_MEASUREMENTS_BPS + PROTOCOL_PARAMS.ALLOC_W_QUIET_BPS).toBe(10_000);
    expect(doc).toMatch(/= min\( 50 %, 4 × buyValue \/ marketCap \)/);
    expect(doc).toMatch(/`fL = min\(1, lifetime \/ \(6 T\)\)`/);
    expect(doc).toMatch(/`fM = min\(1, survived \/ 5\)`/);
    expect(doc).toMatch(/100 % − 80 % × L/);
    expect(PROTOCOL_PARAMS.DAUGHTER_BAND_WIDTH_MAX_BPS - PROTOCOL_PARAMS.DAUGHTER_BAND_WIDTH_MIN_BPS).toBe(8000);
    expect(doc).toMatch(/generation 2: 5 %, 3: 10 %, …, 11\+: 50 %/);
  });

  it('the auto-measurement preset table', () => {
    const rows = ['| 1 h | 2 h |', '| 6 h | 12 h |', '| 24 h | 48 h |', '| 72 h | 144 h (6 d) |', '| 7 d | 14 d |'];
    for (const r of rows) expect(doc).toContain(r);
    expect(HALF_LIFE_PRESETS.map((p) => p.halfLifeSec)).toEqual([3600, 21_600, 86_400, 259_200, 604_800]);
    expect(doc).toMatch(/AUTO_MEASURE_HALF_LIVES × T = 2 T` \(decay progress `0\.75`\)/);
  });

  it('collapse economics: 1 % removed, 20 % of it to the measurer, rest burned, sums exact (prose §3)', () => {
    expect(doc).toMatch(/the measurer's units plus the burned units equal the\nremoved amount exactly/);
    for (const remaining of [0n, 1n, 99n, 100n, 10_000n, 123_456_789_012_345n]) {
      const r = collapseRewards(remaining);
      expect(r.removedUnits).toBe(remaining / 100n);
      expect(r.measurerUnits).toBe((remaining / 100n) / 5n);
      expect(r.measurerUnits + r.burnedUnits).toBe(r.removedUnits);
    }
    expect(surviveRebate(1_000n)).toBe(100n);
    expect(surviveRebate(9n)).toBe(0n);
  });
});

describe('economics.md worked examples reproduce to the unit', () => {
  const W = { A: 'A', B: 'B', C: 'C' };
  const ctx = { measurements: [{ id: 'm1', outcome: { kind: 'survive' as const } }, { id: 'm2', outcome: { kind: 'survive' as const } }], bornAt: 0, collapseAt: 100_000, quietPeriodStart: 80_000, totalDaughterUnits: 1_000_000_000n };
  const holder = (wallet: string, balance: bigint, firstAcquiredAt: number, held: string[], quiet: boolean): HolderSnapshot => ({ wallet, balance, firstAcquiredAt, heldThroughMeasurementIds: held, heldThroughQuietPeriod: quiet });

  it('worked example 1: weights 1.5000 / 1.3000 / 1.0250; units 646 319 569 / 280 071 813 / 73 608 617; dust 1', () => {
    expect(doc).toContain('| A | 60.0 % | **646 319 569** | 64.63 % |');
    expect(doc).toContain('| B | 30.0 % | **280 071 813** | 28.01 % |');
    expect(doc).toContain('| C | 10.0 % | **73 608 617** | 7.36 % |');
    const t = computeAllocation({ ...ctx, snapshot: [holder(W.A, 600n, 0, ['m1', 'm2'], true), holder(W.B, 300n, 50_000, ['m2'], true), holder(W.C, 100n, 90_000, [], false)] });
    const by = Object.fromEntries(t.entries.map((e) => [e.wallet, e]));
    expect(by[W.A]!.weightBps).toBe(15_000);
    expect(by[W.B]!.weightBps).toBe(13_000);
    expect(by[W.C]!.weightBps).toBe(10_250);
    expect(by[W.A]!.units).toBe(646_319_569n);
    expect(by[W.B]!.units).toBe(280_071_813n);
    expect(by[W.C]!.units).toBe(73_608_617n);
    expect(t.dustUnits).toBe(1n);
    expect(by[W.A]!.bagFractionPpb).toBe(600_000_000);
    expect(Math.round(by[W.A]!.sharePpb / 1e5) / 100).toBe(64.63);
    expect(Math.round(by[W.B]!.sharePpb / 1e5) / 100).toBe(28.01);
    expect(Math.round(by[W.C]!.sharePpb / 1e5) / 100).toBe(7.36);
  });

  it('worked example 2: whale 858 657 243 / hands 141 342 756 / dust 1', () => {
    expect(doc).toContain('| Whale | 90 % | **858 657 243** | 85.87 % |');
    expect(doc).toContain('| Hands | 10 % | **141 342 756** | 14.13 % |');
    const t = computeAllocation({ ...ctx, snapshot: [holder('Whale', 900n, 95_000, [], false), holder('Hands', 100n, 0, ['m1', 'm2'], true)] });
    const by = Object.fromEntries(t.entries.map((e) => [e.wallet, e]));
    expect(by['Whale']!.weightBps).toBe(10_125);
    expect(by['Whale']!.units).toBe(858_657_243n);
    expect(by['Hands']!.units).toBe(141_342_756n);
    expect(t.dustUnits).toBe(1n);
  });

  it('sybil example: A split 400 + 200 gives 430 879 712 + 215 439 856 = 646 319 568, one less than whole', () => {
    expect(doc).toContain('`430 879 712 + 215 439 856 = 646 319 568`');
    const t = computeAllocation({
      ...ctx,
      snapshot: [holder('A1', 400n, 0, ['m1', 'm2'], true), holder('A2', 200n, 0, ['m1', 'm2'], true), holder(W.B, 300n, 50_000, ['m2'], true), holder(W.C, 100n, 90_000, [], false)],
    });
    const by = Object.fromEntries(t.entries.map((e) => [e.wallet, e]));
    expect(by['A1']!.units).toBe(430_879_712n);
    expect(by['A2']!.units).toBe(215_439_856n);
    expect(by['A1']!.units + by['A2']!.units).toBe(646_319_568n);
  });

  it('§5 example L = 0.47; pool resolution formula', () => {
    expect(doc).toContain('`0.5 × 0.5 + 0.3 × 0.4 + 0.2 × 0.5 = 0.47`');
    expect(longevityBps({ halfLifeSec: 3600, lifetimeSec: 10_800, measurementsSurvived: 2, supplyRemainingBps: 5000, generation: 1 })).toBe(4700);
    expect(resolvePoolUnits({ supplyMin: 100n, supplyMax: 300n }, 0)).toBe(100n);
    expect(resolvePoolUnits({ supplyMin: 100n, supplyMax: 300n }, 999_999)).toBe(299n);
    expect(resolvePoolUnits({ supplyMin: 100n, supplyMax: 300n }, 500_000)).toBe(200n);
    expect(() => resolvePoolUnits({ supplyMin: 100n, supplyMax: 300n }, 1_000_000)).toThrow();
  });

  it('the document names the resolver id, the dust rule, the Merkle leaf and seed strings exactly as the code uses them', () => {
    expect(doc).toContain('`qsd/measurement/v1`');
    expect(doc).toContain('`sha256("qsd/allocation/empty-leaf/v1")`');
    expect(doc).toContain('`sha256("qsd/allocation/tree-seed/v1")`');
    expect(doc).toMatch(/whatever rounding leaves\nover \(fewer units than there are wallets\) is burned/);
  });
});
