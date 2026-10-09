/**
 * Agent H — the measurement resolver re-derived from the DOCUMENTED byte
 * rules (docs/economics.md §3 table, protocol README §4) with Agent H's own
 * implementation, compared against `measurementResolver.resolve`; channel /
 * tunnel distributions over the dev provider; bundle tamper and state checks.
 * Spec §5 l.187-198, l.218-222.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { randomBytes } from 'node:crypto';
import {
  MEASUREMENT_RESOLVER_ID,
  PROTOCOL_PARAMS,
  applyMeasurement,
  measurementInputs,
  measurementResolver,
  resolveMeasurement,
  type Coin,
  type MeasurementInputs,
  type MeasurementOutcome,
} from '@qsd/protocol';
import { UnsafeDevRandomProvider, createQrngClient, verify } from '@qsd/quantum';

// ------------------------------------------------------------ Agent H's own resolver (from the docs)

function u64be(b: Uint8Array, off: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = v * 256n + BigInt(b[off + i]!);
  return v;
}
const TWO64 = 2n ** 64n;

/** economics.md §3: collapse if u/2^64 < decayProgress; tunnel if u/2^64 < 2.5 %; channel weighted; pool point in band. */
function ownResolve(bytes: Uint8Array, inputs: MeasurementInputs): MeasurementOutcome {
  const u0 = u64be(bytes, 0);
  // u0 / 2^64 < ppb / 1e9  ⇔  u0 × 1e9 < ppb × 2^64 (exact)
  if (!(u0 * 1_000_000_000n < BigInt(inputs.decayProgressPpb) * TWO64)) return { kind: 'survive' };
  const u1 = u64be(bytes, 8);
  if (u1 * 1_000_000n < BigInt(inputs.tunnelProbabilityPpm) * TWO64) return { kind: 'tunnel' };
  const u2 = u64be(bytes, 16);
  const x = (u2 * 1_000_000n) / TWO64; // floor, in [0, 1e6)
  let acc = 0n;
  for (let k = 0; k < inputs.channels.length; k++) {
    acc += BigInt(inputs.channels[k]!.probabilityPpm);
    if (x < acc) {
      const u3 = u64be(bytes, 24);
      return { kind: 'collapse', channelId: inputs.channels[k]!.id, channelIndex: k, poolPointPpm: Number((u3 * 1_000_000n) / TWO64) };
    }
  }
  throw new Error('unreachable: channels sum to 1e6');
}

const label = (o: MeasurementOutcome) => (o.kind === 'collapse' ? `collapse:${o.channelId}` : o.kind);

/** Random channel table summing to exactly 1e6 ppm. */
const channelsArb = fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 6 }).map((ws) => {
  const sum = ws.reduce((a, b) => a + b, 0);
  const ppm = ws.map((w) => Math.max(1, Math.floor((w * 1_000_000) / sum)));
  ppm[ppm.length - 1]! += 1_000_000 - ppm.reduce((a, b) => a + b, 0);
  return ppm.map((p, i) => ({ id: `ch${i}`, probabilityPpm: p }));
});
const inputsArb: fc.Arbitrary<MeasurementInputs> = fc.record({
  ca: fc.constant('CA'),
  decayProgressPpb: fc.oneof(fc.integer({ min: 0, max: 1_000_000_000 }), fc.constantFrom(0, 1, 999_999_999, 1_000_000_000, 500_000_000)),
  channels: channelsArb,
  tunnelProbabilityPpm: fc.oneof(fc.constant(PROTOCOL_PARAMS.TUNNEL_PROBABILITY_PPM), fc.integer({ min: 0, max: 1_000_000 })),
  measurementIndex: fc.nat(),
});
const bytesArb = fc.oneof(
  fc.uint8Array({ minLength: 32, maxLength: 32 }),
  fc.constant(new Uint8Array(32)),
  fc.constant(new Uint8Array(32).fill(0xff)),
  fc.uint8Array({ minLength: 32, maxLength: 32 }).map((b) => {
    const o = new Uint8Array(b);
    o.fill(0, 0, 8); // u0 = 0: always collapse unless ppb = 0
    return o;
  }),
  fc.uint8Array({ minLength: 32, maxLength: 32 }).map((b) => {
    const o = new Uint8Array(b);
    o.fill(0xff, 0, 8); // u0 = 2^64 − 1: survive unless ppb = 1e9
    return o;
  }),
);

describe('resolver: documented byte rules reproduced independently (economics.md §3; README §4)', () => {
  it('property: 10 000 random (bytes, inputs) agree with Agent H\'s implementation of the documented rules, value and label', () => {
    fc.assert(
      fc.property(bytesArb, inputsArb, (bytes, inputs) => {
        const mine = ownResolve(bytes, inputs);
        const theirs = measurementResolver.resolve(bytes, inputs);
        expect(theirs.value).toEqual(mine);
        expect(theirs.label).toBe(label(mine));
        expect(resolveMeasurement(bytes, inputs)).toEqual(mine);
        if (mine.kind === 'collapse') {
          expect(mine.poolPointPpm).toBeGreaterThanOrEqual(0);
          expect(mine.poolPointPpm).toBeLessThanOrEqual(999_999);
          expect(inputs.channels[mine.channelIndex]!.id).toBe(mine.channelId);
        }
      }),
      { numRuns: 10_000 },
    );
    expect(measurementResolver.id).toBe(MEASUREMENT_RESOLVER_ID);
  });

  it('edge bytes: all-zero bytes collapse iff ppb > 0 (channel 0, pool point 0, no tunnel iff tunnel = 0); all-0xFF bytes collapse iff ppb = 1e9 and then pick the LAST channel and pool 999 999', () => {
    const ch = [
      { id: 'a', probabilityPpm: 250_000 },
      { id: 'b', probabilityPpm: 750_000 },
    ];
    const zero = new Uint8Array(32);
    const ff = new Uint8Array(32).fill(0xff);
    const inp = (ppb: number, tunnel = 25_000): MeasurementInputs => ({ ca: 'c', decayProgressPpb: ppb, channels: ch, tunnelProbabilityPpm: tunnel, measurementIndex: 0 });
    expect(resolveMeasurement(zero, inp(0))).toEqual({ kind: 'survive' });
    expect(resolveMeasurement(zero, inp(1))).toEqual({ kind: 'tunnel' }); // u1 = 0 < 2.5 %
    expect(resolveMeasurement(zero, inp(1, 0))).toEqual({ kind: 'collapse', channelId: 'a', channelIndex: 0, poolPointPpm: 0 });
    expect(resolveMeasurement(ff, inp(999_999_999))).toEqual({ kind: 'survive' });
    expect(resolveMeasurement(ff, inp(1_000_000_000))).toEqual({ kind: 'collapse', channelId: 'b', channelIndex: 1, poolPointPpm: 999_999 });
    // the exact threshold: u0 = ppb × 2^64 / 1e9 is NOT a collapse (strict <)
    const ppb = 500_000_000;
    const thr = (BigInt(ppb) * TWO64) / 1_000_000_000n;
    const b = new Uint8Array(32);
    let v = thr;
    for (let i = 7; i >= 0; i--) {
      b[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    expect(resolveMeasurement(b, inp(ppb))).toEqual({ kind: 'survive' });
    v = thr - 1n;
    for (let i = 7; i >= 0; i--) {
      b[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    expect(resolveMeasurement(b, inp(ppb, 0)).kind).toBe('collapse');
  });

  it('short draws, bad tables and bad inputs are refused (no silent defaults)', () => {
    const good: MeasurementInputs = { ca: 'c', decayProgressPpb: 1, channels: [{ id: 'a', probabilityPpm: 1_000_000 }], tunnelProbabilityPpm: 0, measurementIndex: 0 };
    expect(() => resolveMeasurement(new Uint8Array(31), good)).toThrow(/32/);
    expect(() => resolveMeasurement(new Uint8Array(32), { ...good, channels: [{ id: 'a', probabilityPpm: 999_999 }] })).toThrow(/sum/);
    expect(() => resolveMeasurement(new Uint8Array(32), { ...good, channels: [{ id: 'a', probabilityPpm: 500_000 }, { id: 'a', probabilityPpm: 500_000 }] })).toThrow(/duplicate/);
    expect(() => resolveMeasurement(new Uint8Array(32), { ...good, channels: [] })).toThrow();
    expect(() => resolveMeasurement(new Uint8Array(32), { ...good, decayProgressPpb: 1_000_000_001 })).toThrow();
    expect(() => resolveMeasurement(new Uint8Array(32), { ...good, decayProgressPpb: 0.5 })).toThrow();
    expect(() => resolveMeasurement(new Uint8Array(32), { ...good, tunnelProbabilityPpm: -1 })).toThrow();
    expect(() => resolveMeasurement(new Uint8Array(32), { ...good, measurementIndex: -1 })).toThrow();
    expect(() => resolveMeasurement(new Uint8Array(32), { ...good, ca: '' })).toThrow();
  });
});

describe('resolver: distributions over the dev provider (spec §5 l.218-221)', () => {
  const ch = [
    { id: 'alpha', probabilityPpm: 500_000 },
    { id: 'beta', probabilityPpm: 300_000 },
    { id: 'gamma', probabilityPpm: 200_000 },
  ];

  it('channel selection ≈ probabilities and tunnelling ≈ 2.5 % over 8 000 dev-provider draws at decayProgress 1', async () => {
    const client = createQrngClient({ provider: new UnsafeDevRandomProvider() });
    const N = 8_000;
    const counts: Record<string, number> = { alpha: 0, beta: 0, gamma: 0, tunnel: 0 };
    const inputs: MeasurementInputs = { ca: 'c', decayProgressPpb: 1_000_000_000, channels: ch, tunnelProbabilityPpm: PROTOCOL_PARAMS.TUNNEL_PROBABILITY_PPM, measurementIndex: 0 };
    for (let i = 0; i < N; i++) {
      const d = await client.draw(32);
      const o = resolveMeasurement(d.bytes, inputs);
      if (o.kind === 'survive') throw new Error('survive at decayProgress 1');
      counts[o.kind === 'tunnel' ? 'tunnel' : o.channelId]! += 1;
    }
    const tunnelRate = counts['tunnel']! / N;
    expect(Math.abs(tunnelRate - 0.025)).toBeLessThan(0.008);
    const collapsed = N - counts['tunnel']!;
    expect(Math.abs(counts['alpha']! / collapsed - 0.5)).toBeLessThan(0.03);
    expect(Math.abs(counts['beta']! / collapsed - 0.3)).toBeLessThan(0.03);
    expect(Math.abs(counts['gamma']! / collapsed - 0.2)).toBeLessThan(0.03);
  }, 120_000);

  it('survive/collapse frequency tracks decayProgress at 0.25 and 0.9 over 6 000 OS-random draws (resolver is a pure function of bytes)', () => {
    for (const p of [0.25, 0.9]) {
      const inputs: MeasurementInputs = { ca: 'c', decayProgressPpb: Math.round(p * 1e9), channels: ch, tunnelProbabilityPpm: 0, measurementIndex: 0 };
      let collapses = 0;
      const N = 6_000;
      for (let i = 0; i < N; i++) if (resolveMeasurement(new Uint8Array(randomBytes(32)), inputs).kind === 'collapse') collapses++;
      expect(Math.abs(collapses / N - p)).toBeLessThan(0.025);
    }
  });
});

// ------------------------------------------------------------ applyMeasurement and bundle checks

function coin(o: Partial<Coin> = {}): Coin {
  return {
    ca: 'CoinAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1',
    name: 'PHOTON',
    ticker: 'PHO',
    image: { uri: '', hash: '00'.repeat(32), lineage: '11'.repeat(32) },
    lineageId: 'l',
    generation: 1,
    identityRoot: '22'.repeat(32),
    halfLifeSec: 3600,
    decayProgress: 0,
    decayChannels: [
      { id: 'alpha', probabilityPpm: 600_000, label: 'a', daughterParams: { halfLifeSec: { min: 3600, max: 86_400 }, poolUnits: { min: 100n, max: 300n } } },
      { id: 'beta', probabilityPpm: 400_000, label: 'b', daughterParams: { halfLifeSec: { min: 3600, max: 86_400 }, poolUnits: { min: 100n, max: 300n } } },
    ],
    superposition: { supplyMin: 100n, supplyMax: 300n },
    supply: { totalUnits: 1_000_000n, remainingUnits: 1_000_000n, decimals: 0 },
    state: 'superposed',
    lastActivityAt: 1_000_000,
    measurements: [],
    bornAt: 1_000_000,
    ...o,
  };
}

describe('applyMeasurement: bundle must match the coin, the moment and its own bytes (README §4)', () => {
  const client = createQrngClient({ provider: new UnsafeDevRandomProvider() });
  const dev = { allowUnsafeDev: true };

  it('a bundle whose stated outcome differs from what its bytes resolve to is rejected by verify() and by applyMeasurement', async () => {
    const c = coin();
    const at = c.lastActivityAt + 3600;
    const { bundle } = await client.measure(measurementInputs(c, at), measurementResolver);
    const real = bundle.outcome.value as MeasurementOutcome;
    const flipped: MeasurementOutcome = real.kind === 'survive' ? { kind: 'collapse', channelId: 'alpha', channelIndex: 0, poolPointPpm: 5 } : { kind: 'survive' };
    const forged = { ...bundle, outcome: { ...bundle.outcome, value: flipped, label: label(flipped) } };
    expect(verify(forged, measurementResolver, dev).ok).toBe(false);
    expect(() => applyMeasurement(c, forged, { at, by: 'w', verify: dev })).toThrow();
    expect(() => applyMeasurement(c, forged, { at, by: 'w' })).toThrow(/does not match|mismatch|wrong/i);
    // label-only tamper
    const badLabel = { ...bundle, outcome: { ...bundle.outcome, label: 'collapse:gamma' } };
    expect(() => applyMeasurement(c, badLabel, { at, by: 'w' })).toThrow();
    // bytes tamper (outcome recomputed to keep it "consistent" with the new bytes but the commitment is now wrong)
    const bytes = Buffer.from(bundle.draw.bytesHex, 'hex');
    bytes[31] = bytes[31]! ^ 1;
    const badBytes = { ...bundle, draw: { ...bundle.draw, bytesHex: bytes.toString('hex') } };
    expect(verify(badBytes, measurementResolver, dev).ok).toBe(false);
    expect(() => applyMeasurement(c, badBytes, { at, by: 'w', verify: dev })).toThrow();
    // the untampered bundle applies
    const r = applyMeasurement(c, bundle, { at, by: 'w', verify: dev });
    expect(r.measurement.at).toBe(at);
    expect(r.coin.measurements.length).toBe(1);
    expect(c.measurements.length).toBe(0);
  });

  it('a collapsed coin cannot be measured: measurementInputs and applyMeasurement throw', async () => {
    const c = coin();
    const at = c.lastActivityAt + 3600;
    const { bundle } = await client.measure(measurementInputs(c, at), measurementResolver);
    const dead = { ...c, state: 'collapsed' as const, collapsedAt: at };
    expect(() => measurementInputs(dead, at)).toThrow(/collapsed/);
    expect(() => applyMeasurement(dead, bundle, { at, by: 'w' })).toThrow(/collapsed/);
  });

  it('a bundle for a different ca, a different measurement index or a different decay moment is refused', async () => {
    const c = coin();
    const at = c.lastActivityAt + 3600;
    const { bundle } = await client.measure(measurementInputs(c, at), measurementResolver);
    expect(() => applyMeasurement({ ...c, ca: 'OtherCA' }, bundle, { at, by: 'w' })).toThrow(/do not match/);
    expect(() => applyMeasurement(c, bundle, { at: at + 60, by: 'w' })).toThrow(/do not match/);
    expect(() => applyMeasurement(c, bundle, { at: at - 60, by: 'w' })).toThrow(/do not match/);
    const second = applyMeasurement(c, bundle, { at, by: 'w' }).coin;
    if (second.state !== 'collapsed') expect(() => applyMeasurement(second, bundle, { at, by: 'w' })).toThrow(/do not match/);
    expect(() => applyMeasurement(c, { ...bundle, resolverId: 'other/v1' }, { at, by: 'w' })).toThrow(/resolverId/);
    expect(() => applyMeasurement(c, bundle, { at, by: '' })).toThrow();
  });

  it('FINDING H-E2 (MEDIUM): the measurement inputs do not bind `at`; when decayProgressPpb is the same at two instants the same bundle applies at either and the recorded `at`/`collapsedAt` is whatever the caller says', async () => {
    // T = 1 h, quiet for ~111 half-lives: ppb saturates at 1e9 in float, so every later second has identical inputs.
    const c = coin({ lastActivityAt: 0, bornAt: 0 });
    const at1 = 400_000;
    const at2 = 400_000 + 86_400;
    // Fixed (H-E2): decayProgressPpb is identical at both instants, but the inputs now carry `at`,
    // so the two input sets differ and the bundle is bound to the moment it was built for.
    expect(measurementInputs(c, at1).decayProgressPpb).toBe(measurementInputs(c, at2).decayProgressPpb);
    expect(measurementInputs(c, at1)).not.toEqual(measurementInputs(c, at2));
    const { bundle } = await client.measure(measurementInputs(c, at1), measurementResolver);
    // A bundle produced for at1 must not be applicable with a different `at`, otherwise the
    // collapse time (and so the daughter's lifetime score and every holder's fD) is operator-chosen.
    expect(() => applyMeasurement(c, bundle, { at: at2, by: 'w', verify: dev })).toThrow();
  });
});
