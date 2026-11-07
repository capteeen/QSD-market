/**
 * Known-answer tests.
 *
 * 1. SHA-256 FIPS 180-4 vectors ("abc" and the empty string).
 * 2. Published XMSS-SHA2 (RFC 8391) vectors from Bouncy Castle's test suite:
 *    https://github.com/bcgit/bc-java/blob/main/core/src/test/java/org/bouncycastle/pqc/crypto/test/XMSSTest.java
 *    (fixture: ./vectors/bc-xmss-sha256.json, fetched 2026-10-09). All three
 *    seeds are 32 zero bytes, the message is 1024 zero bytes. These vectors
 *    exercise the complete construction: WOTS+ secret expansion, the keyed and
 *    masked chaining function F, base_w + checksum, the L-tree, RAND_HASH, the
 *    hash tree addressing, PRF randomizer r, H_msg and the signature encoding.
 *    A single wrong byte anywhere changes every signature.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LEAVES,
  SIGNATURE_BYTES,
  TREE_HEIGHT,
  decodeSignature,
  encodeSignature,
  fromHex,
  sha256,
  signatureBytesForHeight,
  toHex,
  xmssKeyGen,
  xmssSign,
  xmssVerify,
  type XmssSecretMaterial,
} from "../src/index.js";

interface Fixture {
  source: string;
  seeds: { skSeed: string; skPrf: string; pubSeed: string };
  messageZeroBytes: number;
  height10: {
    publicKeyEncoded: string;
    root: string;
    signatures: string[];
    authPathIndex0: string[];
    signaturesAtIndex: Record<string, string>;
  };
  height4: { signatures: string[] };
}

const fixture = JSON.parse(
  readFileSync(new URL("./vectors/bc-xmss-sha256.json", import.meta.url), "utf8"),
) as Fixture;

const material: XmssSecretMaterial = {
  skSeed: fromHex(fixture.seeds.skSeed),
  skPrf: fromHex(fixture.seeds.skPrf),
  pubSeed: fromHex(fixture.seeds.pubSeed),
};
const message = new Uint8Array(fixture.messageZeroBytes);

describe("SHA-256 (FIPS 180-4)", () => {
  it('hashes "abc" to the FIPS vector', () => {
    expect(toHex(sha256(new TextEncoder().encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("hashes the empty string to the FIPS vector", () => {
    expect(toHex(sha256(new Uint8Array(0)))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("hashes the two-block FIPS message", () => {
    expect(
      toHex(sha256(new TextEncoder().encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });
});

describe("XMSS-SHA2 height 4 (Bouncy Castle published vectors)", () => {
  const kp = xmssKeyGen(material, 4);

  it("reproduces all 16 published signatures bit-for-bit", () => {
    expect(fixture.height4.signatures).toHaveLength(16);
    for (let i = 0; i < 16; i++) {
      const sig = encodeSignature(xmssSign(material, kp, i, message));
      expect(sig.length).toBe(signatureBytesForHeight(4));
      expect(toHex(sig)).toBe(fixture.height4.signatures[i]);
    }
  });

  it("verifies every published signature against the recomputed root", () => {
    for (const hex of fixture.height4.signatures) {
      expect(xmssVerify(kp.root, kp.pubSeed, message, fromHex(hex), 4)).toBe(true);
    }
  });

  it("rejects a published signature under a different message", () => {
    const other = new Uint8Array(message);
    other[0] = 1;
    expect(xmssVerify(kp.root, kp.pubSeed, other, fromHex(fixture.height4.signatures[0]!), 4)).toBe(false);
  });

  it("decodes the published index, r and auth path", () => {
    const sig = decodeSignature(fromHex(fixture.height4.signatures[5]!), 4);
    expect(sig.index).toBe(5);
    expect(sig.auth).toHaveLength(4);
    expect(toHex(encodeSignature(sig))).toBe(fixture.height4.signatures[5]);
  });
});

describe("XMSS-SHA2_10_256 (Bouncy Castle published vectors)", () => {
  // 1024 leaves x 67 chains x 15 F-steps: slow but it is the official parameter set.
  const kp = xmssKeyGen(material, 10);

  it("reproduces the published root", () => {
    expect(toHex(kp.root)).toBe(fixture.height10.root);
    expect(fixture.height10.publicKeyEncoded).toBe("00000001" + fixture.height10.root + fixture.seeds.pubSeed);
  });

  it("reproduces signatures for indices 0, 1, 2 and the published auth path", () => {
    for (let i = 0; i < 3; i++) {
      const sig = xmssSign(material, kp, i, message);
      expect(toHex(encodeSignature(sig))).toBe(fixture.height10.signatures[i]);
      if (i === 0) expect(sig.auth.map(toHex)).toEqual(fixture.height10.authPathIndex0);
    }
  });

  it("reproduces signatures at scattered indices up to 1023", () => {
    for (const [idx, hex] of Object.entries(fixture.height10.signaturesAtIndex)) {
      const sig = encodeSignature(xmssSign(material, kp, Number(idx), message));
      expect(toHex(sig)).toBe(hex);
    }
  });

  it("verifies every published height-10 signature", () => {
    const all = [...fixture.height10.signatures, ...Object.values(fixture.height10.signaturesAtIndex)];
    for (const hex of all) {
      expect(xmssVerify(fromHex(fixture.height10.root), material.pubSeed, message, fromHex(hex), 10)).toBe(true);
    }
  });
}, 120_000);

describe("sizes", () => {
  it("signature is exactly 2436 bytes at height 8", () => {
    expect(TREE_HEIGHT).toBe(8);
    expect(LEAVES).toBe(256);
    expect(SIGNATURE_BYTES).toBe(4 + 32 + 67 * 32 + 8 * 32);
    expect(SIGNATURE_BYTES).toBe(2436);
    expect(signatureBytesForHeight(10)).toBe(fixture.height10.signatures[0]!.length / 2);
  });
});
