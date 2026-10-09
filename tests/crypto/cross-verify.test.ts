/**
 * Spec §10 leg (a): generate an identity with @qsd/crypto from a fixed seed,
 * sign, and verify the signature with Agent H's independent verifier using
 * ONLY (root, pubSeed). Also: Agent H's keygen from the package's derived
 * material must reproduce the package's root (derivation + tree parity), and
 * both verifiers must reject the same tampered variants.
 */
import { describe, expect, it } from 'vitest';
import * as ref from '../reference/xmss-ref.js';
import {
  createIdentity,
  deriveKeyMaterial,
  sign,
  signWithIndex,
  verify,
  encodePublicKey,
  decodePublicKey,
  SIGNATURE_BYTES,
  TREE_HEIGHT,
} from '@qsd/crypto';

const SEED = new Uint8Array(32).map((_, i) => (i * 37 + 11) & 0xff);
const MESSAGE = new TextEncoder().encode('qsd.market launch: NAME·1 / ticker QSD / 2026-10-09');

describe('@qsd/crypto identity vs Agent H reference verifier', () => {
  const identity = createIdentity(SEED);
  const s0 = identity.initialState();
  const r1 = sign(identity, s0, MESSAGE);
  const root = identity.publicKey.root;
  const pubSeed = identity.publicKey.pubSeed;

  it('signature is exactly SIGNATURE_BYTES = 2436 and public key encodes to 64 bytes', () => {
    expect(r1.signature.length).toBe(2436);
    expect(SIGNATURE_BYTES).toBe(2436);
    expect(encodePublicKey(identity.publicKey).length).toBe(64);
    const back = decodePublicKey(encodePublicKey(identity.publicKey));
    expect(ref.hex(back.root)).toBe(ref.hex(root));
    expect(ref.hex(back.pubSeed)).toBe(ref.hex(pubSeed));
  });

  it('Agent H verifier accepts the package signature with only (root, pubSeed)', () => {
    expect(ref.XMSS_verify(r1.signature, MESSAGE, root, pubSeed, TREE_HEIGHT)).toBe(true);
    expect(verify(identity.publicKey, MESSAGE, r1.signature)).toBe(true);
  });

  it('a signature with an explicit index (255, the last leaf) also verifies under the reference', () => {
    const r = signWithIndex(identity, s0, 255, MESSAGE);
    expect(ref.XMSS_verify(r.signature, MESSAGE, root, pubSeed, TREE_HEIGHT)).toBe(true);
    expect(parseInt(ref.hex(r.signature.subarray(0, 4)), 16)).toBe(255);
  });

  it('Agent H keygen from the package-derived (SK_SEED, SK_PRF, SEED) reproduces the package root', () => {
    const m = deriveKeyMaterial(SEED);
    const tree = ref.XMSS_keyGen({ SK_SEED: m.skSeed, SK_PRF: m.skPrf, SEED: m.pubSeed }, TREE_HEIGHT);
    expect(ref.hex(tree.root)).toBe(identity.rootHex);
    // and a reference signature with the same index is byte-identical to the package's
    const refSig = ref.XMSS_sign({ SK_SEED: m.skSeed, SK_PRF: m.skPrf, SEED: m.pubSeed }, tree, r1.index, MESSAGE);
    expect(ref.hex(refSig)).toBe(ref.hex(r1.signature));
  });

  describe('both verifiers reject tampering', () => {
    const cases: Array<[string, (s: Uint8Array) => Uint8Array, Uint8Array]> = [
      ['index byte flipped (uses another leaf)', (s) => flip(s, 3), MESSAGE],
      ['index set to 256 (out of range)', (s) => set(s, 3, 0, 1, 0), MESSAGE],
      ['randomizer r flipped', (s) => flip(s, 4 + 5), MESSAGE],
      ['WOTS element 0 flipped', (s) => flip(s, 36 + 7), MESSAGE],
      ['WOTS element 66 flipped', (s) => flip(s, 36 + 66 * 32 + 31), MESSAGE],
      ['auth node 0 flipped', (s) => flip(s, 36 + 67 * 32 + 1), MESSAGE],
      ['auth node 7 flipped', (s) => flip(s, 36 + 67 * 32 + 7 * 32 + 31), MESSAGE],
      ['truncated by one byte', (s) => s.subarray(0, s.length - 1), MESSAGE],
      ['extended by one byte', (s) => ref.concat(s, new Uint8Array(1)), MESSAGE],
      ['message changed', (s) => s, ref.concat(MESSAGE, new Uint8Array([0]))],
      ['empty message', (s) => s, new Uint8Array(0)],
    ];
    for (const [name, mutate, msg] of cases) {
      it(name, () => {
        const t = mutate(new Uint8Array(r1.signature));
        expect(ref.XMSS_verify(t, msg, root, pubSeed, TREE_HEIGHT)).toBe(false);
        expect(verify(identity.publicKey, msg, t)).toBe(false);
      });
    }
    it('wrong pubSeed (same root) rejected by both', () => {
      const bad = new Uint8Array(pubSeed);
      bad[0]! ^= 1;
      expect(ref.XMSS_verify(r1.signature, MESSAGE, root, bad, TREE_HEIGHT)).toBe(false);
      expect(verify({ root, pubSeed: bad }, MESSAGE, r1.signature)).toBe(false);
    });
    it('WOTS element moved one step forward (forger walks the chain) rejected by both', () => {
      // Forward-hashing an element is the one direction a forger can go; the checksum must catch it.
      const t = new Uint8Array(r1.signature);
      const off = 36;
      const elem = t.subarray(off, off + 32);
      // depth of chain 0 from the reference digest computation
      const idx = r1.index;
      const r = t.subarray(4, 36);
      const Mp = ref.H_msg(ref.concat(r, root, ref.toByte(idx, 32)), MESSAGE);
      const d = ref.msgDigits(Mp)[0]!;
      if (d < 15) {
        const a = new ref.ADRS();
        a.setType(0);
        a.setOTSAddress(idx);
        a.setChainAddress(0);
        const forward = ref.chain(elem, d, 1, pubSeed, a);
        t.set(forward, off);
        expect(ref.XMSS_verify(t, MESSAGE, root, pubSeed, TREE_HEIGHT)).toBe(false);
        expect(verify(identity.publicKey, MESSAGE, t)).toBe(false);
      }
    });
  });
});

function flip(s: Uint8Array, i: number): Uint8Array {
  const t = new Uint8Array(s);
  t[i]! ^= 0x01;
  return t;
}
function set(s: Uint8Array, i: number, ...vals: number[]): Uint8Array {
  const t = new Uint8Array(s);
  // set bytes i-(vals.length-1)..i
  for (let k = 0; k < vals.length; k++) t[i - (vals.length - 1) + k] = vals[k]!;
  return t;
}
