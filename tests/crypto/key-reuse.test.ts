/**
 * Spec §3: "a used leaf can NEVER be reused. Reuse attempts throw."
 * Spec §10: "Attempt one-time-key reuse through every public path. Must be impossible."
 *
 * Every test here asserts that a second use of the same one-time key index
 * either throws or is otherwise impossible. Tests that FAIL demonstrate a
 * real public path to reuse; they are listed in /docs/security.md.
 */
import { describe, expect, it } from 'vitest';
import {
  createIdentity,
  sign,
  signWithIndex,
  signatureIndex,
  verify,
  markUsed,
  mergeStates,
  isIndexUsed,
  remainingCount,
  MemoryStateStore,
  Signer,
  KeyReuseError,
  KeysExhaustedError,
  CryptoInputError,
  StateConflictError,
  type IdentityState,
} from '@qsd/crypto';

const SEED_A = new Uint8Array(32).fill(0xa1);
const SEED_B = new Uint8Array(32).fill(0xb2);
const msg = (s: string) => new TextEncoder().encode(s);

// One identity per seed for the whole file (keygen ≈ 3 s each).
const idA = createIdentity(SEED_A);
const idB = createIdentity(SEED_B);

describe('stateless API: sign / signWithIndex', () => {
  it('signWithIndex with the RETURNED state throws KeyReuseError on the same index', () => {
    const s0 = idA.initialState();
    const r = signWithIndex(idA, s0, 7, msg('one'));
    expect(() => signWithIndex(idA, r.state, 7, msg('two'))).toThrow(KeyReuseError);
  });

  it('sign() with the RETURNED state advances to the next index and never repeats', () => {
    let st = idA.initialState();
    const seen = new Set<number>();
    for (let i = 0; i < 5; i++) {
      const r = sign(idA, st, msg(`m${i}`));
      expect(seen.has(r.index)).toBe(false);
      seen.add(r.index);
      st = r.state;
    }
  });

  it('sign() does not mutate the input state (so a caller CAN accidentally keep the old one)', () => {
    const s0 = idA.initialState();
    const before = JSON.stringify(s0);
    sign(idA, s0, msg('x'));
    expect(JSON.stringify(s0)).toBe(before);
  });

  it('FINDING H-C1: sign() twice with the same (stale) input state reuses index 0 and does not throw', () => {
    // Spec §3 says reuse attempts throw. The pure function cannot know the
    // first signature was ever released, so it silently signs twice with leaf 0.
    const s0 = idA.initialState();
    const r1 = sign(idA, s0, msg('first'));
    let r2: ReturnType<typeof sign> | undefined;
    let threw = false;
    try {
      r2 = sign(idA, s0, msg('second'));
    } catch (e) {
      threw = e instanceof KeyReuseError;
    }
    // Required by the spec: the second call must throw.
    expect(threw, 'second sign() with a stale state must throw KeyReuseError').toBe(true);
    if (r2) {
      // Evidence (only reached when the finding is open): two valid signatures, same leaf, different messages.
      expect(signatureIndex(r1.signature)).toBe(signatureIndex(r2.signature));
      expect(verify(idA.publicKey, msg('first'), r1.signature)).toBe(true);
      expect(verify(idA.publicKey, msg('second'), r2.signature)).toBe(true);
    }
  });

  it('FINDING H-C1 (variant): signWithIndex twice with the same stale state, same index, does not throw', () => {
    // Index 40 is untouched by the earlier tests in this file; a correct implementation
    // remembers that sign() consumed 0..4 above and must refuse those even on a fresh state.
    const s0 = idA.initialState();
    signWithIndex(idA, s0, 40, msg('a'));
    expect(() => signWithIndex(idA, s0, 40, msg('b'))).toThrow(KeyReuseError);
    expect(() => signWithIndex(idA, s0, 3, msg('c'))).toThrow(KeyReuseError);
  });

  it('FINDING H-C2: Identity._sign is a public method that signs with any index, unlimited times', () => {
    // `_sign` is marked @internal in a JSDoc comment only; at runtime it is an
    // ordinary public method on an exported class. No state, no check.
    const anyId = idA as unknown as { _sign?: (index: number, m: Uint8Array) => Uint8Array };
    expect(typeof anyId._sign, 'Identity._sign must not be reachable from outside the package').not.toBe('function');
    if (typeof anyId._sign === 'function') {
      const a = anyId._sign(0, msg('a'));
      const b = anyId._sign(0, msg('b'));
      expect(signatureIndex(a)).toBe(0);
      expect(signatureIndex(b)).toBe(0);
      expect(verify(idA.publicKey, msg('a'), a)).toBe(true);
      expect(verify(idA.publicKey, msg('b'), b)).toBe(true);
    }
  });

  it('a JSON round-tripped state with a used bit cleared lets the stateless API reuse (same root cause as H-C1)', () => {
    const r = signWithIndex(idA, idA.initialState(), 9, msg('a'));
    const cleared = JSON.parse(JSON.stringify(r.state)) as IdentityState;
    cleared.used = idA.initialState().used; // clear every bit
    cleared.nextIndex = 0;
    // The stateless API has no memory; it trusts the state. Documented here as part of H-C1.
    expect(() => signWithIndex(idA, cleared, 9, msg('b'))).toThrow(KeyReuseError);
  });
});

describe('state helpers', () => {
  it('markUsed throws on an already-used index and returns a new object', () => {
    const s0 = idA.initialState();
    const s1 = markUsed(s0, 5);
    expect(s1).not.toBe(s0);
    expect(isIndexUsed(s1, 5)).toBe(true);
    expect(isIndexUsed(s0, 5)).toBe(false);
    expect(() => markUsed(s1, 5)).toThrow(KeyReuseError);
  });

  it('mergeStates is a union: a bit set in either side survives; different roots are rejected', () => {
    const a = markUsed(idA.initialState(), 1);
    const b = markUsed(idA.initialState(), 2);
    const m = mergeStates(a, b);
    expect(isIndexUsed(m, 1) && isIndexUsed(m, 2)).toBe(true);
    expect(remainingCount(m)).toBe(254);
    expect(() => mergeStates(a, idB.initialState())).toThrow(CryptoInputError);
    // merging with a fully cleared state cannot clear anything
    expect(isIndexUsed(mergeStates(a, idA.initialState()), 1)).toBe(true);
  });

  it('index 255 is the last valid index; 256, -1, 1.5 and NaN are rejected everywhere', () => {
    const s0 = idA.initialState();
    const r = signWithIndex(idA, s0, 255, msg('last'));
    expect(signatureIndex(r.signature)).toBe(255);
    for (const bad of [256, -1, 1.5, Number.NaN, 2 ** 32]) {
      expect(() => signWithIndex(idA, s0, bad, msg('x'))).toThrow(CryptoInputError);
      expect(() => markUsed(s0, bad)).toThrow(CryptoInputError);
      expect(() => isIndexUsed(s0, bad)).toThrow(CryptoInputError);
    }
  });

  it('a state from another identity is rejected by sign, signWithIndex and Signer', async () => {
    const sB = idB.initialState();
    expect(() => sign(idA, sB, msg('x'))).toThrow(CryptoInputError);
    expect(() => signWithIndex(idA, sB, 0, msg('x'))).toThrow(CryptoInputError);
    const signer = new Signer(idA, new MemoryStateStore());
    await expect(signer.sign(msg('x'), { state: sB })).rejects.toThrow(CryptoInputError);
  });

  it('a forged state with the right root but a hand-made used bitmap cannot resurrect a stored index', async () => {
    const store = new MemoryStateStore();
    const signer = new Signer(idA, store);
    const r = await signer.signWithIndex(42, msg('a'));
    expect(r.index).toBe(42);
    const forged: IdentityState = { ...idA.initialState() }; // all bits clear, root correct
    await expect(signer.signWithIndex(42, msg('b'), { state: forged })).rejects.toThrow(KeyReuseError);
    const r2 = await signer.sign(msg('c'), { state: forged });
    expect(r2.index).not.toBe(42);
  });
});

describe('Signer + MemoryStateStore (the documented mandatory path)', () => {
  it('two signs use two different indices; the explicit index is then refused', async () => {
    const signer = new Signer(idA, new MemoryStateStore());
    const a = await signer.sign(msg('a'));
    const b = await signer.sign(msg('b'));
    expect(a.index).not.toBe(b.index);
    await expect(signer.signWithIndex(a.index, msg('c'))).rejects.toThrow(KeyReuseError);
    await expect(signer.signWithIndex(b.index, msg('c'))).rejects.toThrow(KeyReuseError);
  });

  it('restoring an older serialised state after a sign cannot reuse the index', async () => {
    const store = new MemoryStateStore();
    const signer = new Signer(idA, store);
    const old = JSON.stringify(await signer.state());
    const a = await signer.sign(msg('a'));
    const restored = JSON.parse(old) as IdentityState;
    const b = await signer.sign(msg('b'), { state: restored });
    expect(b.index).not.toBe(a.index);
    await expect(signer.signWithIndex(a.index, msg('c'), { state: restored })).rejects.toThrow(KeyReuseError);
  });

  it('mutating the returned state object does not affect the store', async () => {
    const store = new MemoryStateStore();
    const signer = new Signer(idA, store);
    const a = await signer.sign(msg('a'));
    (a.state as { used: string }).used = idA.initialState().used;
    (a.state as { nextIndex: number }).nextIndex = 0;
    await expect(signer.signWithIndex(a.index, msg('b'), { state: a.state })).rejects.toThrow(KeyReuseError);
    const stored = await store.get(idA.rootHex);
    expect(stored && isIndexUsed(stored, a.index)).toBe(true);
  });

  it('JSON round trip with a bit cleared, put back into the store: the store refuses to forget', async () => {
    const store = new MemoryStateStore();
    const signer = new Signer(idA, store);
    const a = await signer.sign(msg('a'));
    const cleared = JSON.parse(JSON.stringify(await store.get(idA.rootHex))) as IdentityState;
    cleared.used = idA.initialState().used;
    cleared.nextIndex = 0;
    // CAS against a stale expectation must conflict …
    await expect(store.put(idA.rootHex, cleared, cleared)).rejects.toThrow(StateConflictError);
    // … and an unconditional put must merge, not overwrite.
    await store.put(idA.rootHex, cleared);
    const after = await store.get(idA.rootHex);
    expect(after && isIndexUsed(after, a.index)).toBe(true);
    await expect(signer.signWithIndex(a.index, msg('b'))).rejects.toThrow(KeyReuseError);
  });

  it('put() rejects a state whose root does not match the key, and a malformed state', async () => {
    const store = new MemoryStateStore();
    await expect(store.put(idA.rootHex, idB.initialState())).rejects.toThrow(CryptoInputError);
    await expect(
      store.put(idA.rootHex, { ...idA.initialState(), used: 'zz'.repeat(32) } as IdentityState),
    ).rejects.toThrow();
  });

  it('many concurrent Signers on one store never share an index', async () => {
    const store = new MemoryStateStore();
    const signers = Array.from({ length: 12 }, () => new Signer(idA, store));
    const results = await Promise.all(signers.map((s, i) => s.sign(msg(`c${i}`))));
    const idx = results.map((r) => r.index);
    expect(new Set(idx).size).toBe(idx.length);
    for (const r of results) expect(verify(idA.publicKey, msg(`c${idx.indexOf(r.index)}`), r.signature)).toBe(true);
    const stored = await store.get(idA.rootHex);
    expect(stored && remainingCount(stored)).toBe(256 - 12);
  });

  it('concurrent explicit requests for the SAME index: exactly one wins', async () => {
    const store = new MemoryStateStore();
    const signers = Array.from({ length: 6 }, () => new Signer(idA, store));
    const settled = await Promise.allSettled(signers.map((s) => s.signWithIndex(77, msg('same'))));
    const ok = settled.filter((r) => r.status === 'fulfilled');
    const rejected = settled.filter((r) => r.status === 'rejected');
    expect(ok.length).toBe(1);
    expect(rejected.length).toBe(5);
    for (const r of rejected) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(KeyReuseError);
  });

  it('after 256 signatures the identity is exhausted and every further sign throws', async () => {
    const signer = new Signer(idA, new MemoryStateStore());
    const idx = new Set<number>();
    for (let i = 0; i < 256; i++) idx.add((await signer.sign(msg(`e${i}`))).index);
    expect(idx.size).toBe(256);
    await expect(signer.sign(msg('one more'))).rejects.toThrow(KeysExhaustedError);
    await expect(signer.signWithIndex(0, msg('one more'))).rejects.toThrow(KeyReuseError);
  });

  it('INFO: two Signers with two DIFFERENT stores for one identity DO reuse (documented limitation, README §7)', async () => {
    const a = await new Signer(idA, new MemoryStateStore()).sign(msg('a'));
    const b = await new Signer(idA, new MemoryStateStore()).sign(msg('b'));
    // This is the documented "one identity ↔ one StateStore" rule; it is the
    // app's (Agent G's) job to guarantee it. Recorded here so it is not forgotten.
    expect(a.index).toBe(b.index);
  });
});
