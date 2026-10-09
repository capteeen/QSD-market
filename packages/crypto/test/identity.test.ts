/**
 * Identity round trip, tamper detection, determinism and the public API surface.
 */
import { describe, expect, it } from "vitest";
import {
  CryptoInputError,
  KeysExhaustedError,
  LEAVES,
  N,
  SIGNATURE_BYTES,
  createIdentity,
  decodePublicKey,
  encodePublicKey,
  fromHex,
  remainingCount,
  sign,
  signWithIndex,
  signatureIndex,
  toHex,
  verify,
} from "../src/index.js";

const seed = new Uint8Array(32).map((_, i) => i * 7 + 1);
const identity = createIdentity(seed);
const message = new TextEncoder().encode("launch QSD/ALPHA generation 0");

describe("round trip", () => {
  it("signs and verifies", () => {
    const state0 = identity.initialState();
    const { signature, state, index } = sign(identity, state0, message);
    expect(index).toBe(0);
    expect(signature.length).toBe(SIGNATURE_BYTES);
    expect(signatureIndex(signature)).toBe(0);
    expect(verify(identity.publicKey, message, signature)).toBe(true);
    // every accepted public-key shape works
    expect(verify(encodePublicKey(identity.publicKey), message, signature)).toBe(true);
    expect(verify(state, message, signature)).toBe(true);
    // state advanced, input state untouched
    expect(state.nextIndex).toBe(1);
    expect(state0.nextIndex).toBe(0);
    expect(remainingCount(state)).toBe(LEAVES - 1);
  });

  it("signs with an explicit index and a second message", () => {
    const msg2 = new Uint8Array(0);
    const { signature, state } = signWithIndex(identity, identity.initialState(), 200, msg2);
    expect(signatureIndex(signature)).toBe(200);
    expect(verify(identity.publicKey, msg2, signature)).toBe(true);
    expect(state.nextIndex).toBe(0); // 0 is still free
    expect(remainingCount(state)).toBe(LEAVES - 1);
  });

  it("every one of the 256 leaves produces a verifying signature", () => {
    let state = identity.initialState();
    for (let i = 0; i < LEAVES; i++) {
      const r = sign(identity, state, message);
      expect(r.index).toBe(i);
      expect(verify(identity.publicKey, message, r.signature)).toBe(true);
      state = r.state;
    }
    expect(remainingCount(state)).toBe(0);
    expect(() => sign(identity, state, message)).toThrow(KeysExhaustedError);
  });

  it("public key encodes to 64 bytes and round-trips", () => {
    const enc = encodePublicKey(identity.publicKey);
    expect(enc.length).toBe(64);
    const dec = decodePublicKey(enc);
    expect(toHex(dec.root)).toBe(identity.rootHex);
    expect(toHex(dec.pubSeed)).toBe(toHex(identity.publicKey.pubSeed));
  });
});

describe("tamper detection", () => {
  const { signature } = sign(identity, identity.initialState(), message);
  const flip = (bytes: Uint8Array, at: number, mask = 0x01): Uint8Array => {
    const out = new Uint8Array(bytes);
    out[at] = out[at]! ^ mask;
    return out;
  };

  it("rejects a modified message (every byte)", () => {
    for (let i = 0; i < message.length; i++) {
      expect(verify(identity.publicKey, flip(message, i), signature)).toBe(false);
    }
  });

  it("rejects a flipped index byte", () => {
    for (let i = 0; i < 4; i++) {
      expect(verify(identity.publicKey, message, flip(signature, i))).toBe(false);
    }
    const bigIndex = new Uint8Array(signature);
    bigIndex[3] = 1; // index 1 instead of 0
    expect(verify(identity.publicKey, message, bigIndex)).toBe(false);
  });

  it("rejects a flipped randomizer byte", () => {
    for (let i = 4; i < 4 + N; i += 5) {
      expect(verify(identity.publicKey, message, flip(signature, i))).toBe(false);
    }
  });

  it("rejects a flipped byte in every WOTS+ signature element", () => {
    for (let c = 0; c < 67; c++) {
      const at = 4 + N + c * N + (c % N);
      expect(verify(identity.publicKey, message, flip(signature, at))).toBe(false);
    }
  });

  it("rejects a flipped byte in every auth path node", () => {
    for (let l = 0; l < 8; l++) {
      const at = 4 + N + 67 * N + l * N + l;
      expect(verify(identity.publicKey, message, flip(signature, at, 0x80))).toBe(false);
    }
  });

  it("rejects a swapped WOTS+ element and a swapped auth node", () => {
    const swapped = new Uint8Array(signature);
    const a = 4 + N;
    const b = a + N;
    swapped.set(signature.slice(b, b + N), a);
    swapped.set(signature.slice(a, a + N), b);
    expect(verify(identity.publicKey, message, swapped)).toBe(false);
  });

  it("rejects wrong length, wrong root and wrong public seed", () => {
    expect(verify(identity.publicKey, message, signature.slice(0, SIGNATURE_BYTES - 1))).toBe(false);
    expect(verify(identity.publicKey, message, new Uint8Array(SIGNATURE_BYTES + 1))).toBe(false);
    const otherRoot = { root: flip(identity.root, 0), pubSeed: identity.publicKey.pubSeed };
    expect(verify(otherRoot, message, signature)).toBe(false);
    const otherSeed = { root: identity.root, pubSeed: flip(identity.publicKey.pubSeed, 0) };
    expect(verify(otherSeed, message, signature)).toBe(false);
  });

  it("rejects a signature from a different identity with the same message", () => {
    const other = createIdentity(new Uint8Array(32).fill(0xaa));
    const { signature: sig2 } = sign(other, other.initialState(), message);
    expect(verify(other.publicKey, message, sig2)).toBe(true);
    expect(verify(identity.publicKey, message, sig2)).toBe(false);
  });
});

describe("determinism and seed hygiene", () => {
  it("the same seed always produces the same root and signatures", () => {
    const a = createIdentity(seed);
    const b = createIdentity(new Uint8Array(seed));
    expect(a.rootHex).toBe(identity.rootHex);
    expect(b.rootHex).toBe(identity.rootHex);
    const sa = signWithIndex(a, a.initialState(), 3, message).signature;
    const sb = signWithIndex(b, b.initialState(), 3, message).signature;
    expect(toHex(sa)).toBe(toHex(sb));
  });

  it("pins the root for fixed seeds (regression)", () => {
    // If these change, the construction or the KDF changed. Re-derive only with a known reason.
    expect(identity.rootHex).toBe("1839079f637ad9176dda7b13cab6db5db34778628d3439ff92e25040bd0ca84c");
    const zero = createIdentity(new Uint8Array(32));
    expect(zero.rootHex).toBe("ec0ecf45b11bbbefed56b0522f9cd6f6a21012a75b353d10ca5698ceb0d4cd69");
    expect(toHex(zero.publicKey.pubSeed)).toBe("924a9a7ae5d7e1ae272bebd73902f4440fc9eed61173faf9ab65bd5da19201f2");
    // a signature is fully deterministic too (index 0, fixed message)
    const sig = sign(identity, identity.initialState(), message).signature;
    expect(toHex(sig).slice(0, 72)).toBe("00000000079e9e141bb196901f8d23ff11decdf912dcc0287e3f8b368a8ba99984263593");
  });

  it("different seeds produce different roots", () => {
    const other = createIdentity(new Uint8Array(32).fill(1));
    expect(other.rootHex).not.toBe(identity.rootHex);
  });

  it("rejects short seeds", () => {
    expect(() => createIdentity(new Uint8Array(16))).toThrow(CryptoInputError);
  });

  it("never exposes the seed through JSON, own keys or state", () => {
    const seedHex = toHex(seed);
    const json = JSON.stringify(identity);
    expect(json).not.toContain(seedHex);
    expect(Object.keys(identity)).not.toContain("seed");
    for (const v of Object.values(identity)) {
      if (v instanceof Uint8Array) expect(toHex(v)).not.toBe(seedHex);
    }
    const stateJson = JSON.stringify(identity.initialState());
    expect(stateJson).not.toContain(seedHex);
    expect(stateJson).not.toContain(toHex(fromHex(seedHex).slice(0, 8)));
  });
});
