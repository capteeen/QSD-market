/**
 * Spec §3: "Match the RFC's test vectors" / §10: "Run Agent A's crypto against
 * an independent reference implementation of WOTS+/XMSS; report any mismatch
 * as blocking."
 *
 * RFC 8391 publishes no vectors. The independent published KAT used here is
 * Bouncy Castle's XMSSTest.java (fetched by Agent H, parsed by
 * tests/reference/extract_bc_kat.py into tests/fixtures/bc-xmss-sha256-kat.json;
 * NOT the file under packages/crypto/test/vectors).
 *
 * Three legs:
 *   1. Agent H's reference (tests/reference/xmss-ref.ts) vs the KAT.
 *   2. @qsd/crypto vs the KAT, via Agent H's fixture.
 *   3. Agent H's verifier accepts every published signature from the KAT root.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ref from '../reference/xmss-ref.js';
import {
  xmssKeyGen,
  xmssSign,
  encodeSignature,
  xmssVerify,
  toHex,
  fromHex,
  SIGNATURE_BYTES,
  PUBLIC_KEY_BYTES,
  signatureBytesForHeight,
  LEN,
  N,
  W,
  TREE_HEIGHT,
  LEAVES,
} from '@qsd/crypto';

interface Kat {
  height10: {
    root: string;
    pubSeed: string;
    authPathForIndex0: string[];
    signatures: Record<string, string>;
    scatteredSignatures: Record<string, string>;
  };
  height4: { signatures: Record<string, string> };
}

const kat = JSON.parse(readFileSync(new URL('../fixtures/bc-xmss-sha256-kat.json', import.meta.url), 'utf8')) as Kat;
const ZERO32 = new Uint8Array(32);
const MSG = new Uint8Array(1024); // BC signs 1024 zero bytes
const SK: ref.RefSK = { SK_SEED: ZERO32, SK_PRF: ZERO32, SEED: ZERO32 };

/** Index embedded in a §4.1.8 signature (BC's switch labels contain a typo: 0x0822 > 1023). */
const embeddedIndex = (sigHex: string): number => parseInt(sigHex.slice(0, 8), 16);

describe('parameters (RFC 8391 §5.3, SHA2 n=32 w=16)', () => {
  it('@qsd/crypto constants equal the RFC derivation', () => {
    expect(N).toBe(32);
    expect(W).toBe(16);
    expect(LEN).toBe(ref.len);
    expect(ref.len).toBe(67);
    expect(TREE_HEIGHT).toBe(8);
    expect(LEAVES).toBe(256);
  });
  it('claimed sizes: signature exactly 2436 bytes, public key 64', () => {
    expect(SIGNATURE_BYTES).toBe(2436);
    expect(ref.sigBytesForHeight(8)).toBe(2436);
    expect(PUBLIC_KEY_BYTES).toBe(64);
    expect(signatureBytesForHeight(10)).toBe(2500);
    expect(signatureBytesForHeight(4)).toBe(2308);
    // The KAT's own sizes agree
    expect(kat.height10.signatures['0']!.length / 2).toBe(2500);
    expect(kat.height4.signatures['0']!.length / 2).toBe(2308);
  });
});

describe('height 4 KAT (BC testSignSHA256CompleteEvenHeight1)', () => {
  const refTree = ref.XMSS_keyGen(SK, 4);
  const pkg = xmssKeyGen({ skSeed: ZERO32, skPrf: ZERO32, pubSeed: ZERO32 }, 4);

  it('reference and package agree on the root', () => {
    expect(ref.hex(refTree.root)).toBe(toHex(pkg.root));
  });

  for (let i = 0; i < 16; i++) {
    it(`reference reproduces published signature ${i} bit-for-bit`, () => {
      expect(ref.hex(ref.XMSS_sign(SK, refTree, i, MSG))).toBe(kat.height4.signatures[String(i)]);
    });
    it(`@qsd/crypto reproduces published signature ${i} bit-for-bit`, () => {
      const s = encodeSignature(xmssSign({ skSeed: ZERO32, skPrf: ZERO32, pubSeed: ZERO32 }, pkg, i, MSG));
      expect(toHex(s)).toBe(kat.height4.signatures[String(i)]);
    });
    it(`reference verifier accepts published signature ${i}; package verifier too`, () => {
      const s = ref.unhex(kat.height4.signatures[String(i)]!);
      expect(ref.XMSS_verify(s, MSG, refTree.root, ZERO32, 4)).toBe(true);
      expect(xmssVerify(pkg.root, ZERO32, MSG, s, 4)).toBe(true);
      // and rejects a one-byte message change (BC testVerifySignatureSHA256 pattern)
      const m2 = new Uint8Array(1024);
      m2[0] = 1;
      expect(ref.XMSS_verify(s, m2, refTree.root, ZERO32, 4)).toBe(false);
      expect(xmssVerify(pkg.root, ZERO32, m2, s, 4)).toBe(false);
    });
  }
});

describe('height 10 KAT (XMSS-SHA2_10_256; BC testGenKeyPairSHA256 / testAuthPath / testSignSHA256 / ...Height2)', () => {
  // Expensive: ~1024 leaves in both implementations. Computed once per file.
  const refTree = ref.XMSS_keyGen(SK, 10);
  const pkg = xmssKeyGen({ skSeed: ZERO32, skPrf: ZERO32, pubSeed: ZERO32 }, 10);
  const root = ref.unhex(kat.height10.root);

  it('reference root equals the published root 73c3fc6d…0de3', () => {
    expect(ref.hex(refTree.root)).toBe(kat.height10.root);
  });
  it('@qsd/crypto root equals the published root', () => {
    expect(toHex(pkg.root)).toBe(kat.height10.root);
  });
  it('reference auth path for index 0 equals the published path', () => {
    expect(ref.buildAuth(refTree, 0).map(ref.hex)).toEqual(kat.height10.authPathForIndex0);
  });

  const all: Array<[number, string]> = [
    ...Object.entries(kat.height10.signatures).map(([i, s]) => [Number(i), s] as [number, string]),
    ...Object.values(kat.height10.scatteredSignatures).map((s) => [embeddedIndex(s), s] as [number, string]),
  ];
  it('scattered KAT indices are read from the signature (BC label 0x0822 is a typo for 0x82)', () => {
    const idxs = all.map(([i]) => i).sort((a, b) => a - b);
    expect(idxs).toEqual([0, 1, 2, 91, 130, 176, 365, 393, 505, 673, 907, 1022, 1023]);
  });

  for (const [i, s] of all) {
    it(`index ${i}: reference and package reproduce the published signature; both verifiers accept it`, () => {
      expect(ref.hex(ref.XMSS_sign(SK, refTree, i, MSG))).toBe(s);
      expect(toHex(encodeSignature(xmssSign({ skSeed: ZERO32, skPrf: ZERO32, pubSeed: ZERO32 }, pkg, i, MSG)))).toBe(s);
      const bytes = ref.unhex(s);
      expect(ref.XMSS_verify(bytes, MSG, root, ZERO32, 10)).toBe(true);
      expect(xmssVerify(fromHex(kat.height10.root), ZERO32, MSG, bytes, 10)).toBe(true);
    });
  }
});
