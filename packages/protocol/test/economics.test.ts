import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HALF_LIFE_PRESETS, PROTOCOL_PARAMS, computeAllocation, type HolderSnapshot } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const DOC = resolve(here, '../../../docs/economics.md');
const text = readFileSync(DOC, 'utf8');

/** Rows of the form `| \`NAME\` | value | ... |` in the parameters table. */
function documentedParams(): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^\|\s*`([A-Z_][A-Z0-9_]*)`\s*\|\s*`?([^`|]+?)`?\s*\|/.exec(line);
    if (m) {
      if (out.has(m[1]!)) throw new Error(`constant ${m[1]} documented twice`);
      out.set(m[1]!, m[2]!.trim());
    }
  }
  return out;
}

describe('docs/economics.md matches PROTOCOL_PARAMS', () => {
  const doc = documentedParams();

  it('documents every constant exactly once with the exported value', () => {
    const names = Object.keys(PROTOCOL_PARAMS) as (keyof typeof PROTOCOL_PARAMS)[];
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) {
      expect(doc.has(name), `${name} missing from economics.md`).toBe(true);
      expect(doc.get(name), `${name} value`).toBe(String(PROTOCOL_PARAMS[name]));
    }
    for (const name of doc.keys()) expect(name in PROTOCOL_PARAMS, `${name} documented but not exported`).toBe(true);
  });

  it('states the auto-measurement window per preset consistently', () => {
    expect(text).toContain('`AUTO_MEASURE_HALF_LIVES × T = 2 T`');
    for (const [preset, hours] of [
      ['1 h', '2 h'],
      ['6 h', '12 h'],
      ['24 h', '48 h'],
      ['7 d', '14 d'],
    ] as const) {
      expect(text).toContain(`| ${preset} | ${hours} |`);
    }
    expect(HALF_LIFE_PRESETS.find((p) => p.id === '72h')!.maxWindowSec).toBe(144 * 3600);
  });

  it('names the resolver id and the byte layout', () => {
    expect(text).toContain('qsd/measurement/v1');
    for (const range of ['0–7', '8–15', '16–23', '24–31']) expect(text).toContain(`| ${range} |`);
  });
});

describe('worked examples in economics.md reproduce exactly', () => {
  const measurements = [
    { id: 'm1', outcome: { kind: 'survive' as const } },
    { id: 'm2', outcome: { kind: 'survive' as const } },
    { id: 'mc', outcome: { kind: 'collapse' as const, channelId: 'alpha', channelIndex: 0, poolPointPpm: 0 } },
  ];
  const base = { measurements, bornAt: 0, collapseAt: 100_000, quietPeriodStart: 80_000, totalDaughterUnits: 1_000_000_000n };
  const H = (wallet: string, balance: bigint, firstAcquiredAt: number, held: string[], quiet: boolean): HolderSnapshot => ({
    wallet,
    balance,
    firstAcquiredAt,
    heldThroughMeasurementIds: held,
    heldThroughQuietPeriod: quiet,
  });

  it('example 1', () => {
    const t = computeAllocation({ ...base, snapshot: [H('A', 600n, 0, ['m1', 'm2'], true), H('B', 300n, 50_000, ['m2'], true), H('C', 100n, 90_000, [], false)] });
    const by = Object.fromEntries(t.entries.map((e) => [e.wallet, e]));
    expect(by['A']!.weightBps).toBe(15_000);
    expect(by['B']!.weightBps).toBe(13_000);
    expect(by['C']!.weightBps).toBe(10_250);
    expect(by['A']!.units).toBe(646_319_569n);
    expect(by['B']!.units).toBe(280_071_813n);
    expect(by['C']!.units).toBe(73_608_617n);
    expect(t.dustUnits).toBe(1n);
    expect(by['A']!.bagFractionPpb).toBe(600_000_000);
    expect(by['A']!.sharePpb).toBe(646_319_569);
    for (const n of ['646 319 569', '280 071 813', '73 608 617']) expect(text).toContain(`**${n}**`);
  });

  it('example 1 split (sybil paragraph)', () => {
    const t = computeAllocation({
      ...base,
      snapshot: [H('A1', 400n, 0, ['m1', 'm2'], true), H('A2', 200n, 0, ['m1', 'm2'], true), H('B', 300n, 50_000, ['m2'], true), H('C', 100n, 90_000, [], false)],
    });
    const by = Object.fromEntries(t.entries.map((e) => [e.wallet, e]));
    expect(by['A1']!.units).toBe(430_879_712n);
    expect(by['A2']!.units).toBe(215_439_856n);
    expect(by['A1']!.units + by['A2']!.units).toBe(646_319_568n);
    expect(text).toContain('430 879 712 + 215 439 856 = 646 319 568');
  });

  it('example 2', () => {
    const t = computeAllocation({ ...base, snapshot: [H('Whale', 900n, 95_000, [], false), H('Hands', 100n, 0, ['m1', 'm2'], true)] });
    const by = Object.fromEntries(t.entries.map((e) => [e.wallet, e]));
    expect(by['Whale']!.weightBps).toBe(10_125);
    expect(by['Hands']!.weightBps).toBe(15_000);
    expect(by['Whale']!.units).toBe(858_657_243n);
    expect(by['Hands']!.units).toBe(141_342_756n);
    expect(t.dustUnits).toBe(1n);
    for (const n of ['858 657 243', '141 342 756']) expect(text).toContain(`**${n}**`);
  });
});
