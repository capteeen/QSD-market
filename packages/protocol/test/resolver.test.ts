import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MEASUREMENT_RESOLVER_ID,
  PROTOCOL_PARAMS,
  measurementResolver,
  readU64,
  resolveMeasurement,
  validateChannels,
  type MeasurementInputs,
} from '../src/index.js';
import { bytesFromFractions, devClient } from './fixtures.js';

const CH = [
  { id: 'alpha', probabilityPpm: 500_000 },
  { id: 'beta', probabilityPpm: 300_000 },
  { id: 'gamma', probabilityPpm: 200_000 },
];

function inputs(over: Partial<MeasurementInputs> = {}): MeasurementInputs {
  return {
    ca: 'CoinA',
    at: 1_003_600,
    lastActivityAt: 1_000_000,
    halfLifeSec: 3600,
    decayProgressPpb: 500_000_000,
    channels: CH,
    tunnelProbabilityPpm: PROTOCOL_PARAMS.TUNNEL_PROBABILITY_PPM,
    measurementIndex: 0,
    ...over,
  };
}

describe('measurementResolver', () => {
  it('has the stable id', () => {
    expect(measurementResolver.id).toBe('qsd/measurement/v2');
    expect(MEASUREMENT_RESOLVER_ID).toBe('qsd/measurement/v2');
  });

  it('is deterministic: same bytes and inputs give the same outcome, and only the first 32 bytes matter', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 64 }), fc.nat(1_000_000_000), (bytes, ppb) => {
        const i = inputs({ decayProgressPpb: ppb });
        const a = measurementResolver.resolve(bytes, i);
        const b = measurementResolver.resolve(new Uint8Array(bytes), i);
        expect(a).toEqual(b);
        expect(measurementResolver.resolve(bytes.slice(0, 32), i)).toEqual(a);
      }),
      { numRuns: 1000 },
    );
  });

  it('byte usage: bytes 0-7 decide survive/collapse against decayProgressPpb', () => {
    // u0/2^64 = 0.49 < 0.5 → collapse ; 0.51 → survive
    expect(resolveMeasurement(bytesFromFractions(0.49, 0.9, 0, 0), inputs()).kind).toBe('collapse');
    expect(resolveMeasurement(bytesFromFractions(0.51, 0.0, 0, 0), inputs()).kind).toBe('survive');
    // thresholds: ppb = 0 never collapses, 1e9 always collapses
    expect(resolveMeasurement(new Uint8Array(32), inputs({ decayProgressPpb: 0 })).kind).toBe('survive');
    expect(resolveMeasurement(new Uint8Array(32).fill(0xff), inputs({ decayProgressPpb: 1_000_000_000 })).kind).toBe('collapse');
    // changing bytes 8..31 cannot flip survive
    const s = bytesFromFractions(0.51, 0.0, 0.0, 0.0);
    const s2 = bytesFromFractions(0.51, 0.99, 0.99, 0.99);
    expect(resolveMeasurement(s, inputs())).toEqual(resolveMeasurement(s2, inputs()));
  });

  it('byte usage: bytes 8-15 decide tunnel only when collapsing', () => {
    const tunnelFrac = PROTOCOL_PARAMS.TUNNEL_PROBABILITY_PPM / 1e6; // 0.025
    expect(resolveMeasurement(bytesFromFractions(0.1, tunnelFrac - 0.001, 0.5, 0.5), inputs())).toEqual({ kind: 'tunnel' });
    expect(resolveMeasurement(bytesFromFractions(0.1, tunnelFrac + 0.001, 0.5, 0.5), inputs()).kind).toBe('collapse');
    // tunnel probability 0 → never, 1e6 → always
    expect(resolveMeasurement(bytesFromFractions(0.1, 0, 0.5, 0.5), inputs({ tunnelProbabilityPpm: 0 })).kind).toBe('collapse');
    expect(resolveMeasurement(bytesFromFractions(0.1, 0.999, 0.5, 0.5), inputs({ tunnelProbabilityPpm: 1_000_000 })).kind).toBe('tunnel');
  });

  it('byte usage: bytes 16-23 select the channel by cumulative probability; bytes 24-31 the pool point', () => {
    const collapse = (f2: number, f3: number) => {
      const o = resolveMeasurement(bytesFromFractions(0.1, 0.5, f2, f3), inputs());
      if (o.kind !== 'collapse') throw new Error('expected collapse');
      return o;
    };
    expect(collapse(0.0, 0).channelId).toBe('alpha');
    expect(collapse(0.4999, 0).channelId).toBe('alpha');
    expect(collapse(0.5, 0).channelId).toBe('beta');
    expect(collapse(0.7999, 0).channelId).toBe('beta');
    expect(collapse(0.8, 0).channelId).toBe('gamma');
    expect(collapse(0.999999, 0).channelId).toBe('gamma');
    expect(collapse(0.0, 0).poolPointPpm).toBe(0);
    expect(collapse(0.0, 0.25).poolPointPpm).toBe(250_000);
    expect(collapse(0.0, 0.999999).poolPointPpm).toBeLessThan(1_000_000);
    expect(collapse(0.5, 0.5)).toEqual({ kind: 'collapse', channelId: 'beta', channelIndex: 1, poolPointPpm: 500_000 });
  });

  it('readU64 is big-endian', () => {
    const b = new Uint8Array(32);
    b[7] = 1;
    expect(readU64(b, 0)).toBe(1n);
    b[0] = 1;
    expect(readU64(b, 0)).toBe((1n << 56n) + 1n);
    expect(() => readU64(b, 25)).toThrow();
  });

  it('rejects invalid inputs, short draws and bad channel tables', () => {
    expect(() => resolveMeasurement(new Uint8Array(31), inputs())).toThrow(/32 draw bytes/);
    expect(() => resolveMeasurement(new Uint8Array(32), inputs({ decayProgressPpb: -1 }))).toThrow();
    expect(() => resolveMeasurement(new Uint8Array(32), inputs({ decayProgressPpb: 1.5 }))).toThrow();
    expect(() => resolveMeasurement(new Uint8Array(32), inputs({ channels: [{ id: 'a', probabilityPpm: 999_999 }] }))).toThrow(/sum/);
    expect(() => validateChannels([{ id: 'a', probabilityPpm: 500_000 }, { id: 'a', probabilityPpm: 500_000 }])).toThrow(/duplicate/);
    expect(() => validateChannels([])).toThrow();
    expect(() => validateChannels([{ id: 'a', probabilityPpm: 1_000_000 }])).not.toThrow();
    // time-binding fields: shape-checked when present, ignored by the outcome
    expect(() => resolveMeasurement(new Uint8Array(32), inputs({ at: -1 }))).toThrow(/inputs.at/);
    expect(() => resolveMeasurement(new Uint8Array(32), inputs({ lastActivityAt: 1_003_601 }))).toThrow(/lastActivityAt/);
    expect(() => resolveMeasurement(new Uint8Array(32), inputs({ halfLifeSec: 0 }))).toThrow(/halfLifeSec/);
    const a = inputs();
    const b = { ...inputs(), at: a.at + 86_400, lastActivityAt: 5, halfLifeSec: 7 };
    for (const f of [0.1, 0.49, 0.51, 0.9]) {
      expect(resolveMeasurement(bytesFromFractions(f, 0.5, 0.5, 0.5), a)).toEqual(resolveMeasurement(bytesFromFractions(f, 0.5, 0.5, 0.5), b));
    }
  });

  it('labels are survive | tunnel | collapse:<channelId>', () => {
    expect(measurementResolver.resolve(bytesFromFractions(0.9), inputs()).label).toBe('survive');
    expect(measurementResolver.resolve(bytesFromFractions(0.1, 0.0), inputs()).label).toBe('tunnel');
    expect(measurementResolver.resolve(bytesFromFractions(0.1, 0.5, 0.9), inputs()).label).toBe('collapse:gamma');
  });
});

describe('distribution over dev-provider draws', () => {
  const N = 20_000;

  it(`channel selection and tunnelling frequencies match probabilities over ${N} draws (±2 % abs)`, async () => {
    const { provider } = devClient();
    const i = inputs({ decayProgressPpb: 1_000_000_000 }); // always collapse → every draw exercises tunnel + channel bytes
    const counts: Record<string, number> = { tunnel: 0, alpha: 0, beta: 0, gamma: 0 };
    for (let k = 0; k < N; k++) {
      const d = await provider.draw(32);
      const o = resolveMeasurement(d.bytes, i);
      if (o.kind === 'tunnel') counts['tunnel']!++;
      else if (o.kind === 'collapse') counts[o.channelId]!++;
      else throw new Error('survive impossible at ppb 1e9');
    }
    const tunnelP = PROTOCOL_PARAMS.TUNNEL_PROBABILITY_PPM / 1e6;
    expect(Math.abs(counts['tunnel']! / N - tunnelP)).toBeLessThan(0.006); // 2.5 % ± 0.6 % (≈5σ at N=20k)
    for (const c of CH) {
      const expected = (1 - tunnelP) * (c.probabilityPpm / 1e6);
      expect(Math.abs(counts[c.id]! / N - expected)).toBeLessThan(0.02);
    }
  });

  it('survive/collapse frequency tracks decayProgress (0.3 and 0.75) over 20k draws (±2 % abs)', async () => {
    const { provider } = devClient();
    for (const p of [0.3, 0.75]) {
      const i = inputs({ decayProgressPpb: Math.round(p * 1e9), tunnelProbabilityPpm: 0 });
      let collapses = 0;
      for (let k = 0; k < 10_000; k++) {
        const d = await provider.draw(32);
        if (resolveMeasurement(d.bytes, i).kind === 'collapse') collapses++;
      }
      expect(Math.abs(collapses / 10_000 - p)).toBeLessThan(0.02);
    }
  });
});
