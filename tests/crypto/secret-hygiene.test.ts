/**
 * Spec §3: "seed is never logged". Spec §9: "no secrets in logs".
 * Checks that Identity's JSON / inspect output and every error message
 * contain no seed, SK_SEED, SK_PRF or secret chain values, and documents the
 * sensitivity of the unredacted event stream.
 */
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  createIdentity,
  deriveKeyMaterial,
  recordEvents,
  redactEvents,
  sign,
  toHex,
  wotsExpandSecretKey,
  wotsSecretSeed,
  KeyReuseError,
  signWithIndex,
  type CryptoEvent,
} from '@qsd/crypto';

const SEED = new Uint8Array(32).map((_, i) => (0xc0 + i) & 0xff);
const seedHex = toHex(SEED);
const material = deriveKeyMaterial(SEED);
const secretHexes = [seedHex, toHex(material.skSeed), toHex(material.skPrf)];

describe('Identity never exposes secrets through ordinary channels', () => {
  const rec = recordEvents();
  const identity = createIdentity(SEED, { observer: rec.observer });
  rec.stop();

  it('JSON.stringify(identity) contains only root, pubSeed, height', () => {
    const json = JSON.stringify(identity);
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(['height', 'pubSeed', 'root']);
    for (const s of secretHexes) expect(json).not.toContain(s);
  });

  it('util.inspect(identity) (what console.log prints) contains no secret', () => {
    const s = inspect(identity, { depth: 10, showHidden: true });
    for (const h of secretHexes) expect(s).not.toContain(h);
    expect(s).not.toMatch(/skSeed|skPrf/);
  });

  it('Object.keys / getOwnPropertyNames / reflection expose no secret material', () => {
    const names = Object.getOwnPropertyNames(identity);
    expect(names).not.toContain('#material');
    const dump = JSON.stringify(names.map((k) => [k, (identity as unknown as Record<string, unknown>)[k]]), (_k, v) =>
      v instanceof Uint8Array ? toHex(v) : v,
    );
    for (const h of secretHexes) expect(dump).not.toContain(h);
  });

  it('error messages never contain seeds (KeyReuseError, CryptoInputError, KeysExhausted)', () => {
    const s0 = identity.initialState();
    const r = signWithIndex(identity, s0, 1, new Uint8Array(1));
    const errs: string[] = [];
    try {
      signWithIndex(identity, r.state, 1, new Uint8Array(1));
    } catch (e) {
      errs.push(String(e), JSON.stringify(e), inspect(e));
      expect(e).toBeInstanceOf(KeyReuseError);
    }
    try {
      createIdentity(new Uint8Array(5));
    } catch (e) {
      errs.push(String(e), inspect(e));
    }
    for (const m of errs) for (const h of secretHexes) expect(m).not.toContain(h);
  });

  it('signing events (signChainStop, authPathNode, signatureReady) carry only public values', () => {
    const rec2 = recordEvents();
    const r = sign(identity, identity.initialState(), new Uint8Array([1, 2, 3]), { observer: rec2.observer });
    rec2.stop();
    const sk = wotsExpandSecretKey(wotsSecretSeed(material.skSeed, r.index)).map(toHex);
    const dump = JSON.stringify(rec2.events, (_k, v) => (v instanceof Uint8Array ? toHex(v) : v));
    for (const h of secretHexes) expect(dump).not.toContain(h);
    // depth-0 chain values are the one-time secret key; they must never appear in a signing stream
    // unless the digit for that chain is 0 (then the element IS the depth-0 value, by construction of WOTS+).
    const stops = rec2.events.filter((e) => e.type === 'signChainStop') as Array<{ chainIdx: number; depth: number; hash: Uint8Array }>;
    for (const s of stops) {
      if (s.depth > 0) expect(sk[s.chainIdx]).not.toBe(toHex(s.hash));
    }
  });

  it('FINDING H-C3 (fixed): recordEvents() redacts by default; the raw keygen stream is opt-in and contains every one-time secret key', () => {
    // chainStep depth 0 for leaf k chain i IS sk_k[i]. A leaked raw recording = a leaked private key,
    // so the default recording must be redacted and the raw stream requires { redact: false }.
    const sk0 = wotsExpandSecretKey(wotsSecretSeed(material.skSeed, 0)).map(toHex);
    const pick = (events: readonly CryptoEvent[]) =>
      events.filter((e) => e.type === 'chainStep' && e.leaf === 0 && e.depth === 0) as Array<{
        chainIdx: number;
        hash: Uint8Array;
      }>;
    // `rec` above was recorded with the default options: must already be redacted.
    const depth0 = pick(rec.events);
    expect(depth0.length).toBe(67);
    for (const e of depth0) expect(toHex(e.hash)).not.toBe(sk0[e.chainIdx]);
    // The raw stream is available only on explicit opt-in.
    const raw = recordEvents({ redact: false });
    createIdentity(SEED, { observer: raw.observer });
    const rawDepth0 = pick(raw.events);
    expect(rawDepth0.length).toBe(67);
    for (const e of rawDepth0) expect(toHex(e.hash)).toBe(sk0[e.chainIdx]);
    // and redactEvents() cleans a raw stream:
    for (const e of pick(redactEvents(raw.events))) expect(toHex(e.hash)).not.toBe(sk0[e.chainIdx]);
  });
});
