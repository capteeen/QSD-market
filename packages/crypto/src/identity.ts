/**
 * QSD launch identities: an XMSS-style tree of height 8 (256 one-time WOTS+
 * keys) whose Merkle root is the identity. Index usage is tracked in a
 * serialisable `IdentityState`; a used leaf can never be reused.
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

export interface CreateIdentityOptions {
  observer?: CryptoObserver;
}

/**
 * A derived identity. Secret material lives in private fields so that
 * JSON.stringify / console.log / structuredClone never expose it.
 */
export class Identity {
  readonly height = TREE_HEIGHT;
  readonly leaves = LEAVES;
  readonly publicKey: IdentityPublicKey;
  readonly root: Uint8Array;
  readonly rootHex: string;
  /** Wall-clock milliseconds spent on key generation. */
  readonly keygenMs: number;
  readonly #material: XmssSecretMaterial;
  readonly #keyPair: XmssKeyPair;

  /** @internal use createIdentity() */
  constructor(material: XmssSecretMaterial, keyPair: XmssKeyPair, keygenMs: number) {
    this.#material = material;
    this.#keyPair = keyPair;
    this.root = keyPair.root;
    this.rootHex = toHex(keyPair.root);
    this.publicKey = { root: keyPair.root, pubSeed: keyPair.pubSeed };
    this.keygenMs = keygenMs;
  }

  /** Fresh state with no index used. */
  initialState(): IdentityState {
    return {
      version: 1,
      root: this.rootHex,
      pubSeed: toHex(this.publicKey.pubSeed),
      nextIndex: 0,
      used: toHex(new Uint8Array(USED_BYTES)),
    };
  }

  /** Merkle node at `level` (0 = leaves) and position `index`. Public values. */
  node(level: number, index: number): Uint8Array {
    const row = this.#keyPair.tree.levels[level];
    const n = row?.[index];
    if (!n) throw new CryptoInputError(`no node at level ${level} index ${index}`);
    return n;
  }

  /** @internal */
  _sign(index: number, message: Uint8Array, observer?: CryptoObserver): Uint8Array {
    const sig = xmssSign(this.#material, this.#keyPair, index, message, observer);
    return encodeSignature(sig);
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

// ───────────────────────── state helpers ─────────────────────────

export function validateState(state: IdentityState): void {
  if (!state || typeof state !== "object") throw new CryptoInputError("state must be an object");
  if (state.version !== 1) throw new CryptoInputError("unsupported state version");
  if (typeof state.root !== "string" || state.root.length !== 2 * N) throw new CryptoInputError("state.root invalid");
  if (typeof state.pubSeed !== "string" || state.pubSeed.length !== 2 * N) {
    throw new CryptoInputError("state.pubSeed invalid");
  }
  if (!Number.isInteger(state.nextIndex) || state.nextIndex < 0 || state.nextIndex > LEAVES) {
    throw new CryptoInputError("state.nextIndex invalid");
  }
  if (typeof state.used !== "string" || state.used.length !== 2 * USED_BYTES) {
    throw new CryptoInputError("state.used invalid");
  }
  fromHex(state.used);
}

export function isIndexUsed(state: IdentityState, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= LEAVES) {
    throw new CryptoInputError(`index ${index} out of range 0..${LEAVES - 1}`);
  }
  const bits = fromHex(state.used);
  return (bits[index >>> 3]! & (1 << (index & 7))) !== 0;
}

/** Indices still available for signing. */
export function remainingIndices(state: IdentityState): number[] {
  const bits = fromHex(state.used);
  const out: number[] = [];
  for (let i = 0; i < LEAVES; i++) if ((bits[i >>> 3]! & (1 << (i & 7))) === 0) out.push(i);
  return out;
}

export function remainingCount(state: IdentityState): number {
  return remainingIndices(state).length;
}

/** Return a NEW state with `index` marked used. Throws KeyReuseError if already used. */
export function markUsed(state: IdentityState, index: number): IdentityState {
  validateState(state);
  if (isIndexUsed(state, index)) throw new KeyReuseError(index, state.root);
  const bits = fromHex(state.used);
  bits[index >>> 3] = bits[index >>> 3]! | (1 << (index & 7));
  let next = state.nextIndex;
  while (next < LEAVES && (bits[next >>> 3]! & (1 << (next & 7))) !== 0) next++;
  return { version: 1, root: state.root, pubSeed: state.pubSeed, nextIndex: next, used: toHex(bits) };
}

/**
 * Union of two states for the same identity: an index used in either is used
 * in the result. This is how a restored/stale state is reconciled with what a
 * store knows, so rolling back a state file can never resurrect a key.
 */
export function mergeStates(a: IdentityState, b: IdentityState): IdentityState {
  validateState(a);
  validateState(b);
  if (a.root !== b.root) throw new CryptoInputError("cannot merge states of different identities");
  const ba = fromHex(a.used);
  const bb = fromHex(b.used);
  const out = new Uint8Array(USED_BYTES);
  for (let i = 0; i < USED_BYTES; i++) out[i] = ba[i]! | bb[i]!;
  let next = 0;
  while (next < LEAVES && (out[next >>> 3]! & (1 << (next & 7))) !== 0) next++;
  return { version: 1, root: a.root, pubSeed: a.pubSeed, nextIndex: next, used: toHex(out) };
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
  /** New state with `index` marked used. The input state is not mutated. */
  state: IdentityState;
}

function checkStateMatches(identity: Identity, state: IdentityState): void {
  validateState(state);
  if (state.root !== identity.rootHex) {
    throw new CryptoInputError("state belongs to a different identity (root mismatch)");
  }
}

/**
 * Sign `message` with a specific one-time key. Throws KeyReuseError if that
 * index is already marked used in `state`. The returned state marks the index
 * used; it is produced BEFORE the signature is returned.
 */
export function signWithIndex(
  identity: Identity,
  state: IdentityState,
  index: number,
  message: Uint8Array,
  opts: SignOptions = {},
): SignResult {
  checkStateMatches(identity, state);
  if (!(message instanceof Uint8Array)) throw new CryptoInputError("message must be a Uint8Array");
  if (!Number.isInteger(index) || index < 0 || index >= LEAVES) {
    throw new CryptoInputError(`index ${index} out of range 0..${LEAVES - 1}`);
  }
  if (isIndexUsed(state, index)) throw new KeyReuseError(index, state.root);
  // Mark used first. Only then compute and release the signature.
  const nextState = markUsed(state, index);
  const signature = identity._sign(index, message, opts.observer);
  opts.observer?.emit({ type: "signatureReady", index, bytes: signature });
  return { signature, index, state: nextState };
}

/** Sign with the lowest unused one-time key of `state`. */
export function sign(identity: Identity, state: IdentityState, message: Uint8Array, opts: SignOptions = {}): SignResult {
  checkStateMatches(identity, state);
  const free = remainingIndices(state);
  const index = free[0];
  if (index === undefined) throw new KeysExhaustedError(state.root);
  return signWithIndex(identity, state, index, message, opts);
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
  if ("version" in pk) return { root: fromHex(pk.root), pubSeed: fromHex(pk.pubSeed) };
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
 * only then is the signature returned. A caller-supplied (possibly stale or
 * restored) state is merged with the store's state first, so an index the
 * store knows about can never be reused by rolling back a state file.
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
    if (!Number.isInteger(index) || index < 0 || index >= LEAVES) {
      throw new CryptoInputError(`index ${index} out of range 0..${LEAVES - 1}`);
    }
    return this.reserveAndSign(index, message, opts);
  }

  private async reserveAndSign(
    wanted: number | undefined,
    message: Uint8Array,
    opts: SignOptions & { state?: IdentityState },
  ): Promise<SignResult> {
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
      const signOpts: SignOptions = opts.observer ? { observer: opts.observer } : {};
      const result = signWithIndex(this.identity, current, index, message, signOpts);
      return { ...result, state: reserved };
    }
    throw new StateConflictError(this.identity.rootHex);
  }
}
