/**
 * One-time key reuse must be impossible through every public path.
 */
import { describe, expect, it } from "vitest";
import {
  CryptoInputError,
  KeyReuseError,
  KeysExhaustedError,
  LEAVES,
  MemoryStateStore,
  Signer,
  StateConflictError,
  createIdentity,
  isIndexUsed,
  markUsed,
  mergeStates,
  remainingIndices,
  sign,
  signWithIndex,
  validateState,
  verify,
  type IdentityState,
} from "../src/index.js";

const identity = createIdentity(new Uint8Array(32).fill(42));
const msg = new TextEncoder().encode("reuse me");

describe("reuse rejection (pure functions)", () => {
  it("sign() with the returned state advances; explicit reuse of a consumed index throws", () => {
    const s0 = identity.initialState();
    const first = sign(identity, s0, msg);
    expect(first.index).toBe(0);
    const second = sign(identity, first.state, msg);
    expect(second.index).toBe(1);
    expect(() => signWithIndex(identity, first.state, 0, msg)).toThrow(KeyReuseError);
    expect(() => signWithIndex(identity, second.state, 0, msg)).toThrow(KeyReuseError);
    expect(() => signWithIndex(identity, second.state, 1, msg)).toThrow(KeyReuseError);
  });

  it("H-C1: sign() twice with the same stale state object throws KeyReuseError", () => {
    const s0 = identity.initialState();
    const r1 = sign(identity, s0, msg);
    expect(() => sign(identity, s0, msg)).toThrow(KeyReuseError);
    try {
      sign(identity, s0, msg);
    } catch (e) {
      expect((e as KeyReuseError).index).toBe(r1.index);
    }
  });

  it("H-C1: the identity remembers; a fresh or JSON-edited state cannot reissue a consumed index", () => {
    const r = signWithIndex(identity, identity.initialState(), 9, msg);
    // fresh state, all bits clear
    expect(() => signWithIndex(identity, identity.initialState(), 9, msg)).toThrow(KeyReuseError);
    // JSON round trip with the bit cleared by hand
    const cleared = JSON.parse(JSON.stringify(r.state)) as IdentityState;
    cleared.used = identity.initialState().used;
    cleared.nextIndex = 0;
    expect(() => signWithIndex(identity, cleared, 9, msg)).toThrow(KeyReuseError);
    // sign() with a fresh state skips every remembered index instead of reissuing one
    const used = new Set(identity.usedIndices());
    const next = sign(identity, identity.initialState(), msg);
    expect(used.has(next.index)).toBe(false);
    for (const u of used) expect(isIndexUsed(next.state, u)).toBe(true);
  });

  it("H-C2: no public method on Identity produces a signature", () => {
    const proto = Object.getPrototypeOf(identity) as Record<string, unknown>;
    const names = [...Object.getOwnPropertyNames(identity), ...Object.getOwnPropertyNames(proto)];
    expect(names).not.toContain("_sign");
    for (const n of names) {
      const v = (identity as unknown as Record<string, unknown>)[n];
      if (typeof v === "function" && n !== "constructor") {
        expect(["initialState", "usedIndices", "memoryState", "node", "toJSON"]).toContain(n);
      }
    }
  });

  it("an index issued through a Signer cannot be reissued through the stateless API", async () => {
    const signer = new Signer(identity, new MemoryStateStore());
    const r = await signer.signWithIndex(123, msg);
    expect(r.index).toBe(123);
    expect(identity.usedIndices()).toContain(123);
    expect(() => signWithIndex(identity, identity.initialState(), 123, msg)).toThrow(KeyReuseError);
  });

  it("signWithIndex on a used index throws KeyReuseError with the index", () => {
    const { state } = signWithIndex(identity, identity.initialState(), 17, msg);
    try {
      signWithIndex(identity, state, 17, msg);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(KeyReuseError);
      expect((e as KeyReuseError).index).toBe(17);
      expect((e as KeyReuseError).name).toBe("KeyReuseError");
    }
  });

  it("markUsed on a used index throws; marked state is produced before the signature", () => {
    const s = markUsed(identity.initialState(), 5);
    expect(isIndexUsed(s, 5)).toBe(true);
    expect(() => markUsed(s, 5)).toThrow(KeyReuseError);
    expect(remainingIndices(s)).toHaveLength(LEAVES - 1);
    expect(s.nextIndex).toBe(0);
    expect(markUsed(s, 0).nextIndex).toBe(1);
  });

  it("does not mutate the input state", () => {
    const s0 = identity.initialState();
    const frozen = JSON.stringify(s0);
    sign(identity, s0, msg);
    expect(JSON.stringify(s0)).toBe(frozen);
  });

  it("a forged state with bits cleared cannot be merged into a store without the bits coming back", () => {
    const used = markUsed(markUsed(identity.initialState(), 1), 2);
    const rollback = identity.initialState();
    const merged = mergeStates(used, rollback);
    expect(isIndexUsed(merged, 1)).toBe(true);
    expect(isIndexUsed(merged, 2)).toBe(true);
    expect(merged.nextIndex).toBe(0);
  });

  it("H-C4: validateState rejects non-hex content and mergeStates rejects a pubSeed mismatch", () => {
    const s = identity.initialState();
    expect(() => validateState({ ...s, used: "zz".repeat(32) })).toThrow(CryptoInputError);
    expect(() => validateState({ ...s, root: "g".repeat(64) })).toThrow(CryptoInputError);
    expect(() => validateState({ ...s, pubSeed: " ".repeat(64) })).toThrow(CryptoInputError);
    const otherSeed = { ...s, pubSeed: "00".repeat(32) };
    expect(() => mergeStates(s, otherSeed)).toThrow(/public seed/);
    expect(() => sign(identity, otherSeed, msg)).toThrow(/pubSeed mismatch/);
  });

  it("out-of-range indices are rejected", () => {
    expect(() => signWithIndex(identity, identity.initialState(), 256, msg)).toThrow();
    expect(() => signWithIndex(identity, identity.initialState(), -1, msg)).toThrow();
    expect(() => signWithIndex(identity, identity.initialState(), 1.5, msg)).toThrow();
  });

  it("a state from another identity is rejected", () => {
    const other = createIdentity(new Uint8Array(32).fill(43));
    expect(() => sign(identity, other.initialState(), msg)).toThrow(/different identity/);
  });

  it("exhaustion throws KeysExhaustedError, not a reuse", () => {
    let s = identity.initialState();
    for (let i = 0; i < LEAVES; i++) s = markUsed(s, i);
    expect(() => sign(identity, s, msg)).toThrow(KeysExhaustedError);
  });
});

describe("reuse rejection (store-backed Signer)", () => {
  it("consecutive signatures use fresh indices and the store advances", async () => {
    const store = new MemoryStateStore();
    const signer = new Signer(identity, store);
    const a = await signer.sign(msg);
    const b = await signer.sign(msg);
    expect(a.index).toBe(0);
    expect(b.index).toBe(1);
    expect((await store.get(identity.rootHex))?.nextIndex).toBe(2);
    expect(verify(identity.publicKey, msg, a.signature)).toBe(true);
    expect(verify(identity.publicKey, msg, b.signature)).toBe(true);
  });

  it("signing after restoring an OLD state is still rejected because the store knows", async () => {
    const store = new MemoryStateStore();
    const signer = new Signer(identity, store);
    const old: IdentityState = identity.initialState(); // a backup taken before any signing
    await signer.sign(msg); // consumes 0
    await signer.signWithIndex(9, msg);
    // "Restore from backup" and try again: 0 and 9 must stay dead.
    await expect(signer.signWithIndex(0, msg, { state: old })).rejects.toThrow(KeyReuseError);
    await expect(signer.signWithIndex(9, msg, { state: old })).rejects.toThrow(KeyReuseError);
    const next = await signer.sign(msg, { state: old });
    expect(next.index).toBe(1);
    expect(isIndexUsed(next.state, 0)).toBe(true);
    expect(isIndexUsed(next.state, 9)).toBe(true);
  });

  it("putting an older state into the store never clears a used bit", async () => {
    const store = new MemoryStateStore();
    const signer = new Signer(identity, store);
    await signer.sign(msg);
    await store.put(identity.rootHex, identity.initialState());
    const s = await store.get(identity.rootHex);
    expect(s && isIndexUsed(s, 0)).toBe(true);
    await expect(signer.signWithIndex(0, msg)).rejects.toThrow(KeyReuseError);
  });

  it("two signers on the same store never share an index", async () => {
    const store = new MemoryStateStore();
    const s1 = new Signer(identity, store);
    const s2 = new Signer(identity, store);
    const results = await Promise.all([s1.sign(msg), s2.sign(msg), s1.sign(msg), s2.sign(msg)]);
    const indices = results.map((r) => r.index);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("compare-and-swap put rejects a stale expectation", async () => {
    const store = new MemoryStateStore();
    const s0 = identity.initialState();
    await store.put(identity.rootHex, s0);
    const s1 = markUsed(s0, 0);
    await store.put(identity.rootHex, s1, s0);
    await expect(store.put(identity.rootHex, markUsed(s0, 1), s0)).rejects.toThrow(StateConflictError);
  });

  it("expected: null means 'must not exist yet'", async () => {
    const store = new MemoryStateStore();
    await store.put(identity.rootHex, identity.initialState(), null);
    await expect(store.put(identity.rootHex, identity.initialState(), null)).rejects.toThrow(StateConflictError);
  });

  it("many concurrent signers across many rounds never collide", async () => {
    const store = new MemoryStateStore();
    const signers = Array.from({ length: 8 }, () => new Signer(identity, store));
    const rounds = await Promise.all(signers.flatMap((s) => [s.sign(msg), s.sign(msg), s.sign(msg)]));
    const indices = rounds.map((r) => r.index).sort((a, b) => a - b);
    expect(indices).toEqual([...Array(24).keys()]);
    expect((await store.get(identity.rootHex))?.nextIndex).toBe(24);
  });

  it("the store rejects a state for a different root", async () => {
    const store = new MemoryStateStore();
    await expect(store.put("00".repeat(32), identity.initialState())).rejects.toThrow();
  });
});
