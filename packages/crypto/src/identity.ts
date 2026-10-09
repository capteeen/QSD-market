/**
 * QSD launch identities: an XMSS-style tree of height 8 (256 one-time WOTS+
 * keys) whose Merkle root is the identity. Index usage is tracked in a
 * serialisable `IdentityState` AND in the Identity object's own private
 * memory; a used leaf can never be reused through any public path of this
 * object. Cross-process safety is the StateStore's job (see Signer).
 */
import { equalBytes, fromHex, toHex } from "./bytes.js";
import { CryptoInputError, KeyReuseError, KeysExhaustedError } from "./errors.js";
import type { CryptoObserver } from "./events.js";
import { deriveKeyMaterial } from "./kdf.js";
import { LEAVES, N, PUBLIC_KEY_BYTES, SIGNATURE_BYTES, TREE_HEIGHT } from "./params.js";
import {
  encodeSignature,
  xmssKeyGen,
  xmssSign,
  xmssVerify,
  type XmssKeyPair,
  type XmssSecretMaterial,
} from "./xmss.js";

/** The public half of an identity. `root` is the identity; `pubSeed` is needed to verify. */
export interface IdentityPublicKey {
  root: Uint8Array;
  pubSeed: Uint8Array;
}

/** Serialisable (JSON-safe) usage state. Contains no secrets. */
export interface IdentityState {
  version: 1;
  /** Hex Merkle root (identity). */
  root: string;
  /** Hex public seed. Carried so a state object alone can verify. */
  pubSeed: string;
  /** Lowest index that has never been used (monotonic; a hint, `used` is authoritative). */
  nextIndex: number;
  /** Hex bitmap of LEAVES bits; bit i set = one-time key i consumed forever. */
  used: string;
}

const USED_BYTES = LEAVES / 8; // 32
const HEX_32 = /^[0-9a-f]{64}$/i;

export interface CreateIdentityOptions {
  observer?: CryptoObserver;
}

/**
 * Everything secret or reuse-critical about an Identity lives here, keyed by
 * the Identity object in a module-scoped WeakMap. Nothing in this record is
 * reachable from outside this module: not by property access, reflection,
 * JSON, util.inspect or structuredClone.
 */
interface Internals {
  material: XmssSecretMaterial;
  keyPair: XmssKeyPair;
  /** Every index this Identity object has signed with, through any path. */
  used: Uint8Array;
  /** State objects `sign()` has already auto-allocated from, and the index issued. */
  signedFrom: WeakMap<IdentityState, number>;
}

const internals = new WeakMap<Identity, Internals>();

function internalsOf(identity: Identity): Internals {
  const i = internals.get(identity);
  if (!i) throw new CryptoInputError("not an Identity created by createIdentity()");
  return i;
}

/**
 * A derived identity. Secret material and the in-process usage memory are
 * held in a module-private WeakMap, so `JSON.stringify` / `console.log` /
 * reflection show only `{ root, pubSeed, height }` and no method on this
 * class can produce a signature.
 */
export class Identity {
  readonly height = TREE_HEIGHT;
  readonly leaves = LEAVES;
  readonly publicKey: IdentityPublicKey;
  readonly root: Uint8Array;
  readonly rootHex: string;
  /** Wall-clock milliseconds spent on key generation. */
  readonly keygenMs: number;

  /** @internal use createIdentity() */
  constructor(material: XmssSecretMaterial, keyPair: XmssKeyPair, keygenMs: number) {
    this.root = keyPair.root;
    this.rootHex = toHex(keyPair.root);
    this.publicKey = { root: keyPair.root, pubSeed: keyPair.pubSeed };
    this.keygenMs = keygenMs;
    internals.set(this, {
      material,
      keyPair,
      used: new Uint8Array(USED_BYTES),
      signedFrom: new WeakMap(),
    });
  }

  /**
   * A fresh state object with no index marked used. Note that the Identity
   * itself still remembers every index it has signed with (see `usedIndices`):
   * signing with a fresh state never reissues one of those.
   */
  initialState(): IdentityState {
    return {
      version: 1,
      root: this.rootHex,
      pubSeed: toHex(this.publicKey.pubSeed),
      nextIndex: 0,
      used: toHex(new Uint8Array(USED_BYTES)),
    };
  }

  /** Indices this Identity object has signed with, through any path, in this process. */
  usedIndices(): number[] {
    return bitmapIndices(internalsOf(this).used);
  }

  /** A state that reflects `usedIndices()` — what a store should hold at minimum. */
  memoryState(): IdentityState {
    return stateFromBitmap(this, internalsOf(this).used);
  }

  /** Merkle node at `level` (0 = leaves) and position `index`. Public values. */
  node(level: number, index: number): Uint8Array {
    const row = internalsOf(this).keyPair.tree.levels[level];
    const n = row?.[index];
    if (!n) throw new CryptoInputError(`no node at level ${level} index ${index}`);
    return n;
  }

  toJSON(): { root: string; pubSeed: string; height: number } {
    return { root: this.rootHex, pubSeed: toHex(this.publicKey.pubSeed), height: this.height };
  }
}

/**
 * Derive a full identity from a seed: HKDF-SHA256 → (SK_SEED, SK_PRF, SEED),
 * then all 256 WOTS+ key pairs, their L-tree leaves and the height-8 tree.
 * Deterministic: the same seed always yields the same root.
 * The seed is not retained, logged, or placed in any event or error.
 */
export function createIdentity(seed: Uint8Array, opts: CreateIdentityOptions = {}): Identity {
  const material = deriveKeyMaterial(seed);
  const t0 = now();
  const kp = xmssKeyGen(material, TREE_HEIGHT, opts.observer);
  return new Identity(material, kp, now() - t0);
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// ───────────────────────── bitmap helpers ─────────────────────────

function bitSet(bits: Uint8Array, index: number): boolean {
  return (bits[index >>> 3]! & (1 << (index & 7))) !== 0;
}

function setBit(bits: Uint8Array, index: number): void {
  bits[index >>> 3] = bits[index >>> 3]! | (1 << (index & 7));
}

function lowestFree(bits: Uint8Array): number {
  for (let i = 0; i < LEAVES; i++) if (!bitSet(bits, i)) return i;
  return LEAVES;
}

function bitmapIndices(bits: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < LEAVES; i++) if (bitSet(bits, i)) out.push(i);
  return out;
}

function orBitmaps(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(USED_BYTES);
  for (let i = 0; i < USED_BYTES; i++) out[i] = a[i]! | b[i]!;
  return out;
}

function stateFromBitmap(identity: Identity, bits: Uint8Array): IdentityState {
  return {
    version: 1,
    root: identity.rootHex,
    pubSeed: toHex(identity.publicKey.pubSeed),
    nextIndex: lowestFree(bits),
    used: toHex(bits),
  };
}

function checkIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= LEAVES) {
    throw new CryptoInputError(`index ${index} out of range 0..${LEAVES - 1}`);
  }
}

// ───────────────────────── state helpers ─────────────────────────

export function validateState(state: IdentityState): void {
  if (!state || typeof state !== "object") throw new CryptoInputError("state must be an object");
  if (state.version !== 1) throw new CryptoInputError("unsupported state version");
  if (typeof state.root !== "string" || !HEX_32.test(state.root)) {
    throw new CryptoInputError("state.root must be 64 hex characters");
  }
  if (typeof state.pubSeed !== "string" || !HEX_32.test(state.pubSeed)) {
    throw new CryptoInputError("state.pubSeed must be 64 hex characters");
  }
  if (!Number.isInteger(state.nextIndex) || state.nextIndex < 0 || state.nextIndex > LEAVES) {
    throw new CryptoInputError("state.nextIndex invalid");
  }
  if (typeof state.used !== "string" || !HEX_32.test(state.used)) {
    throw new CryptoInputError(`state.used must be ${2 * USED_BYTES} hex characters`);
  }
}

export function isIndexUsed(state: IdentityState, index: number): boolean {
  checkIndex(index);
  return bitSet(fromHex(state.used), index);
}

/** Indices still available for signing according to `state`. */
export function remainingIndices(state: IdentityState): number[] {
  const bits = fromHex(state.used);
  const out: number[] = [];
  for (let i = 0; i < LEAVES; i++) if (!bitSet(bits, i)) out.push(i);
  return out;
}

export function remainingCount(state: IdentityState): number {
  return remainingIndices(state).length;
}

/** Return a NEW state with `index` marked used. Throws KeyReuseError if already used. */
export function markUsed(state: IdentityState, index: number): IdentityState {
  checkIndex(index);
  validateState(state);
  const bits = fromHex(state.used);
  if (bitSet(bits, index)) throw new KeyReuseError(index, state.root);
  setBit(bits, index);
  return {
    version: 1,
    root: state.root,
    pubSeed: state.pubSeed,
    nextIndex: Math.max(state.nextIndex, 0) <= index ? lowestFree(bits) : state.nextIndex,
    used: toHex(bits),
  };
}

/**
 * Union of two states for the same identity: an index used in either is used
 * in the result. This is how a restored/stale state is reconciled with what a
 * store knows, so rolling back a state file can never resurrect a key.
 * Root and pubSeed must both match.
 */
export function mergeStates(a: IdentityState, b: IdentityState): IdentityState {
  validateState(a);
  validateState(b);
  if (a.root.toLowerCase() !== b.root.toLowerCase()) {
    throw new CryptoInputError("cannot merge states of different identities (root mismatch)");
  }
  if (a.pubSeed.toLowerCase() !== b.pubSeed.toLowerCase()) {
    throw new CryptoInputError("cannot merge states with different public seeds");
  }
  const out = orBitmaps(fromHex(a.used), fromHex(b.used));
  return { version: 1, root: a.root, pubSeed: a.pubSeed, nextIndex: lowestFree(out), used: toHex(out) };
}

// ───────────────────────── sign / verify ─────────────────────────

export interface SignOptions {
  observer?: CryptoObserver;
}

export interface SignResult {
  /** Encoded signature, exactly SIGNATURE_BYTES bytes. */
  signature: Uint8Array;
  /** The one-time key index that was consumed. */
  index: number;
  /**
   * New state with `index` marked used. It is the union of the supplied state
   * and everything this Identity object has signed with. The input state is
   * never mutated.
   */
  state: IdentityState;
}

function checkStateMatches(identity: Identity, state: IdentityState): void {
  validateState(state);
  if (state.root.toLowerCase() !== identity.rootHex) {
    throw new CryptoInputError("state belongs to a different identity (root mismatch)");
  }
  if (state.pubSeed.toLowerCase() !== toHex(identity.publicKey.pubSeed)) {
    throw new CryptoInputError("state belongs to a different identity (pubSeed mismatch)");
  }
}

/**
 * The only code path that produces a signature. Marks `index` in the
 * Identity's private memory BEFORE computing, refusing if already marked
 * (unless `trustCaller` — used by Signer, whose StateStore is authoritative
 * and has already reserved the index durably).
 */
function signCore(
  identity: Identity,
  index: number,
  message: Uint8Array,
  observer: CryptoObserver | undefined,
  trustCaller: boolean,
): Uint8Array {
  const int = internalsOf(identity);
  if (!(message instanceof Uint8Array)) throw new CryptoInputError("message must be a Uint8Array");
  if (!trustCaller && bitSet(int.used, index)) {
    throw new KeyReuseError(index, identity.rootHex, "already used by this identity in this process");
  }
  // Reserve first. Only then compute and release the signature.
  setBit(int.used, index);
  const sig = encodeSignature(xmssSign(int.material, int.keyPair, index, message, observer));
  observer?.emit({ type: "signatureReady", index, bytes: sig });
  return sig;
}

/**
 * Sign `message` with a specific one-time key. Throws KeyReuseError if that
 * index is marked used in `state` OR has ever been signed with by this
 * Identity object. The index is marked used before the signature is returned;
 * the returned state is the union of `state` and the identity's memory.
 */
export function signWithIndex(
  identity: Identity,
  state: IdentityState,
  index: number,
  message: Uint8Array,
  opts: SignOptions = {},
): SignResult {
  checkIndex(index);
  checkStateMatches(identity, state);
  if (!(message instanceof Uint8Array)) throw new CryptoInputError("message must be a Uint8Array");
  const int = internalsOf(identity);
  const union = orBitmaps(fromHex(state.used), int.used);
  if (bitSet(union, index)) {
    throw new KeyReuseError(
      index,
      identity.rootHex,
      bitSet(fromHex(state.used), index) ? "marked used in the supplied state" : "already used by this identity in this process",
    );
  }
  const signature = signCore(identity, index, message, opts.observer, false);
  setBit(union, index);
  return { signature, index, state: stateFromBitmap(identity, union) };
}

/**
 * Sign with the lowest one-time key that is unused in BOTH `state` and this
 * Identity's memory. Passing the same state object to `sign()` twice is a
 * reuse attempt (it asks for the same key again) and throws KeyReuseError;
 * always continue from the returned state.
 */
export function sign(identity: Identity, state: IdentityState, message: Uint8Array, opts: SignOptions = {}): SignResult {
  checkStateMatches(identity, state);
  if (!(message instanceof Uint8Array)) throw new CryptoInputError("message must be a Uint8Array");
  const int = internalsOf(identity);
  const previous = int.signedFrom.get(state);
  if (previous !== undefined) {
    throw new KeyReuseError(previous, identity.rootHex, "this state object already produced a signature; use the state returned by that call");
  }
  const union = orBitmaps(fromHex(state.used), int.used);
  const index = lowestFree(union);
  if (index >= LEAVES) throw new KeysExhaustedError(identity.rootHex);
  const signature = signCore(identity, index, message, opts.observer, false);
  int.signedFrom.set(state, index);
  setBit(union, index);
  return { signature, index, state: stateFromBitmap(identity, union) };
}

export interface VerifyOptions {
  observer?: CryptoObserver;
}

/** Encode a public key as root || pubSeed (64 bytes). */
export function encodePublicKey(pk: IdentityPublicKey): Uint8Array {
  const out = new Uint8Array(PUBLIC_KEY_BYTES);
  out.set(pk.root, 0);
  out.set(pk.pubSeed, N);
  return out;
}

export function decodePublicKey(bytes: Uint8Array): IdentityPublicKey {
  if (!(bytes instanceof Uint8Array) || bytes.length !== PUBLIC_KEY_BYTES) {
    throw new CryptoInputError(`public key must be ${PUBLIC_KEY_BYTES} bytes`);
  }
  return { root: bytes.slice(0, N), pubSeed: bytes.slice(N, 2 * N) };
}

function toPublicKey(pk: IdentityPublicKey | IdentityState | Uint8Array): IdentityPublicKey {
  if (pk instanceof Uint8Array) return decodePublicKey(pk);
  if ("version" in pk) {
    validateState(pk);
    return { root: fromHex(pk.root), pubSeed: fromHex(pk.pubSeed) };
  }
  if (!(pk.root instanceof Uint8Array) || !(pk.pubSeed instanceof Uint8Array)) {
    throw new CryptoInputError("public key must have Uint8Array root and pubSeed");
  }
  return pk;
}

/**
 * Verify a signature against an identity. Needs no secret: the public key is
 * the root plus the public seed (accepts {root, pubSeed}, the 64-byte encoding,
 * or an IdentityState, which carries both). Returns false on any tampering.
 */
export function verify(
  publicKey: IdentityPublicKey | IdentityState | Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
  opts: VerifyOptions = {},
): boolean {
  const pk = toPublicKey(publicKey);
  if (!(signature instanceof Uint8Array) || signature.length !== SIGNATURE_BYTES) return false;
  return xmssVerify(pk.root, pk.pubSeed, message, signature, TREE_HEIGHT, opts.observer);
}

/** Read the one-time key index a signature used (does not verify it). */
export function signatureIndex(signature: Uint8Array): number {
  if (!(signature instanceof Uint8Array) || signature.length !== SIGNATURE_BYTES) {
    throw new CryptoInputError(`signature must be ${SIGNATURE_BYTES} bytes`);
  }
  return ((signature[0]! << 24) | (signature[1]! << 16) | (signature[2]! << 8) | signature[3]!) >>> 0;
}

export function publicKeysEqual(a: IdentityPublicKey, b: IdentityPublicKey): boolean {
  return equalBytes(a.root, b.root) && equalBytes(a.pubSeed, b.pubSeed);
}

// ───────────────────────── persistent state ─────────────────────────

/**
 * Persistent usage state. `/packages/solana` supplies the durable
 * implementation (the per-coin identity reserve); MemoryStateStore is for
 * tests and the browser session.
 *
 * `put` must be atomic per root. When `expected` is passed it is a
 * compare-and-swap: `expected === null` means "nothing may be stored yet", an
 * IdentityState means "the stored state must still be exactly this (same
 * `used` bitmap)"; otherwise the put throws StateConflictError and nothing is
 * written. This is what makes two concurrent signers unable to consume the
 * same index. When `expected` is omitted the write is unconditional, but a
 * store must still never clear a used bit (merge with what it holds).
 */
export interface StateStore {
  get(rootHex: string): Promise<IdentityState | undefined>;
  put(rootHex: string, state: IdentityState, expected?: IdentityState | null): Promise<void>;
}

export class StateConflictError extends Error {
  override readonly name = "StateConflictError";
  constructor(rootHex: string) {
    super(`state for identity ${rootHex.slice(0, 16)}… changed concurrently; retry with the latest state`);
  }
}

export class MemoryStateStore implements StateStore {
  private readonly map = new Map<string, IdentityState>();

  async get(rootHex: string): Promise<IdentityState | undefined> {
    const s = this.map.get(rootHex);
    return s ? { ...s } : undefined;
  }

  async put(rootHex: string, state: IdentityState, expected?: IdentityState | null): Promise<void> {
    validateState(state);
    if (state.root !== rootHex) throw new CryptoInputError("state root does not match key");
    const current = this.map.get(rootHex);
    if (expected === null) {
      if (current) throw new StateConflictError(rootHex);
    } else if (expected !== undefined) {
      if (!current || current.used !== expected.used) throw new StateConflictError(rootHex);
    }
    // A store never forgets a used index, even if handed an older state.
    this.map.set(rootHex, current ? mergeStates(current, state) : { ...state });
  }
}

/**
 * A signer bound to a store. Every signature goes through the store: the
 * latest state is read, the index is reserved by writing the new state, and
 * only then is the signature produced. A caller-supplied (possibly stale or
 * restored) state is merged with the store's state first, so an index the
 * store knows about can never be reused by rolling back a state file.
 *
 * The store is the authority for a Signer: indices it issues are recorded in
 * the Identity's memory (so the stateless API cannot reuse them), but the
 * Signer does not consult that memory — one identity must be bound to exactly
 * ONE store (README §7). Two Signers with two different stores WILL reuse.
 */
export class Signer {
  constructor(
    readonly identity: Identity,
    readonly store: StateStore,
  ) {}

  /** Max compare-and-swap retries under contention before giving up. */
  static readonly MAX_RETRIES = 64;

  private async latest(supplied?: IdentityState): Promise<{ stored: IdentityState | undefined; current: IdentityState }> {
    const stored = await this.store.get(this.identity.rootHex);
    let current = stored ?? this.identity.initialState();
    if (supplied) {
      checkStateMatches(this.identity, supplied);
      current = mergeStates(current, supplied);
    }
    return { stored, current };
  }

  async state(): Promise<IdentityState> {
    return (await this.latest()).current;
  }

  /** Sign with the lowest index the store does not know to be used. */
  async sign(message: Uint8Array, opts: SignOptions & { state?: IdentityState } = {}): Promise<SignResult> {
    return this.reserveAndSign(undefined, message, opts);
  }

  /** Sign with a specific index; KeyReuseError if the store (or the supplied state) has it used. */
  async signWithIndex(
    index: number,
    message: Uint8Array,
    opts: SignOptions & { state?: IdentityState } = {},
  ): Promise<SignResult> {
    checkIndex(index);
    return this.reserveAndSign(index, message, opts);
  }

  private async reserveAndSign(
    wanted: number | undefined,
    message: Uint8Array,
    opts: SignOptions & { state?: IdentityState },
  ): Promise<SignResult> {
    if (!(message instanceof Uint8Array)) throw new CryptoInputError("message must be a Uint8Array");
    for (let attempt = 0; attempt < Signer.MAX_RETRIES; attempt++) {
      const { stored, current } = await this.latest(opts.state);
      let index: number;
      if (wanted === undefined) {
        const free = remainingIndices(current)[0];
        if (free === undefined) throw new KeysExhaustedError(this.identity.rootHex);
        index = free;
      } else {
        if (isIndexUsed(current, wanted)) {
          throw new KeyReuseError(wanted, current.root, "recorded in the state store");
        }
        index = wanted;
      }
      // Reserve the index durably (compare-and-swap) BEFORE producing the signature.
      const reserved = markUsed(current, index);
      try {
        await this.store.put(this.identity.rootHex, reserved, stored ?? null);
      } catch (e) {
        if (e instanceof StateConflictError) continue; // someone else moved the state; re-read and retry
        throw e;
      }
      const signature = signCore(this.identity, index, message, opts.observer, true);
      return { signature, index, state: reserved };
    }
    throw new StateConflictError(this.identity.rootHex);
  }
}
