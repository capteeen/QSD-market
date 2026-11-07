/**
 * Identity reserve: the per-coin wallet holding the one-time-key state of
 * the coin's launch identity (@qsd/crypto). Two parts:
 *
 *  1. `PersistentStateStore` — a durable `StateStore` with compare-and-swap:
 *     every record carries a version counter; `put` succeeds only when the
 *     caller's expectation (the stored `used` bitmap) and the version both
 *     still match. A used index can never be cleared (merge, never overwrite),
 *     so a key used before a crash is still used after the restart.
 *  2. `IdentityReserve` — the registry { coin ca → identity root, encrypted
 *     WOTS seed } kept through the KeyVault; the seed is only ever decrypted
 *     in memory to rebuild the `Identity` for signing.
 */
import {
  createIdentity,
  mergeStates,
  validateState,
  StateConflictError,
  CryptoInputError,
  type Identity,
  type IdentityState,
  type StateStore,
  Signer,
} from '@qsd/crypto';
import { randomBytes } from '@noble/hashes/utils.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ChainError } from './errors.js';
import { KeyVault, readJsonFile, writeJsonAtomic } from './keys.js';

export interface StateRecord {
  version: number;
  state: IdentityState;
}

/** Durable backend for identity states. `write` is the CAS primitive. */
export interface ReserveBackend {
  readState(rootHex: string): Promise<StateRecord | undefined>;
  /**
   * Write `record` for `rootHex` only if the stored version equals
   * `expectedVersion` (0 = nothing stored yet). Returns false on mismatch.
   * Must be atomic with respect to other writers of the same backend.
   */
  writeState(rootHex: string, record: StateRecord, expectedVersion: number): Promise<boolean>;
  readRegistry(): Promise<Record<string, ReserveEntry>>;
  writeRegistry(reg: Record<string, ReserveEntry>): Promise<void>;
}

export interface ReserveEntry {
  ca: string;
  identityRoot: string;
  pubSeed: string;
  /** Label of the encrypted seed in the KeyVault's store. */
  seedLabel: string;
  createdAt: string;
}

interface ReserveDoc {
  version: 1;
  states: Record<string, StateRecord>;
  registry: Record<string, ReserveEntry>;
}

const emptyDoc = (): ReserveDoc => ({ version: 1, states: {}, registry: {} });

/** In-memory backend; `reopen()` simulates a process restart over the same bytes. */
export class MemoryReserveBackend implements ReserveBackend {
  private doc: ReserveDoc;
  private readonly shared: { json: string };
  constructor(shared?: { json: string }) {
    this.shared = shared ?? { json: JSON.stringify(emptyDoc()) };
    this.doc = JSON.parse(this.shared.json) as ReserveDoc;
  }
  private persist(): void {
    this.shared.json = JSON.stringify(this.doc);
  }
  private reload(): void {
    this.doc = JSON.parse(this.shared.json) as ReserveDoc;
  }
  async readState(rootHex: string): Promise<StateRecord | undefined> {
    this.reload();
    const r = this.doc.states[rootHex];
    return r ? structuredClone(r) : undefined;
  }
  async writeState(rootHex: string, record: StateRecord, expectedVersion: number): Promise<boolean> {
    this.reload();
    const cur = this.doc.states[rootHex];
    if ((cur?.version ?? 0) !== expectedVersion) return false;
    this.doc.states[rootHex] = structuredClone(record);
    this.persist();
    return true;
  }
  async readRegistry(): Promise<Record<string, ReserveEntry>> {
    this.reload();
    return structuredClone(this.doc.registry);
  }
  async writeRegistry(reg: Record<string, ReserveEntry>): Promise<void> {
    this.reload();
    this.doc.registry = structuredClone(reg);
    this.persist();
  }
  /** A new backend instance over the same persisted bytes (a "restart"). */
  reopen(): MemoryReserveBackend {
    return new MemoryReserveBackend(this.shared);
  }
}

/**
 * One JSON file, written atomically. Every read-modify-write holds an
 * exclusive lock file (`<file>.lock`, O_EXCL) so that two processes — or two
 * backend instances in one process — can never both reserve the same index.
 */
export class FileReserveBackend implements ReserveBackend {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(readonly file: string, private readonly lockTimeoutMs = 10_000) {}
  private async load(): Promise<ReserveDoc> {
    return (await readJsonFile<ReserveDoc>(this.file)) ?? emptyDoc();
  }
  private async withFileLock<T>(fn: () => Promise<T>): Promise<T> {
    const lock = `${this.file}.lock`;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const start = Date.now();
    for (;;) {
      try {
        const h = await fs.open(lock, 'wx');
        await h.writeFile(String(process.pid));
        await h.close();
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        // stale lock (crashed holder): break it after the timeout
        try {
          const st = await fs.stat(lock);
          if (Date.now() - st.mtimeMs > this.lockTimeoutMs) await fs.unlink(lock);
        } catch {
          /* lock vanished; retry */
        }
        if (Date.now() - start > this.lockTimeoutMs * 2) throw new ChainError(`could not acquire reserve lock ${lock}`);
        await new Promise((r) => setTimeout(r, 2 + Math.random() * 8));
      }
    }
    try {
      return await fn();
    } finally {
      await fs.unlink(lock).catch(() => undefined);
    }
  }
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(() => this.withFileLock(fn), () => this.withFileLock(fn));
    this.chain = p.catch(() => undefined);
    return p;
  }
  async readState(rootHex: string): Promise<StateRecord | undefined> {
    return this.locked(async () => (await this.load()).states[rootHex]);
  }
  async writeState(rootHex: string, record: StateRecord, expectedVersion: number): Promise<boolean> {
    return this.locked(async () => {
      const doc = await this.load();
      const cur = doc.states[rootHex];
      if ((cur?.version ?? 0) !== expectedVersion) return false;
      doc.states[rootHex] = record;
      await writeJsonAtomic(this.file, doc);
      return true;
    });
  }
  async readRegistry(): Promise<Record<string, ReserveEntry>> {
    return this.locked(async () => (await this.load()).registry);
  }
  async writeRegistry(reg: Record<string, ReserveEntry>): Promise<void> {
    return this.locked(async () => {
      const doc = await this.load();
      doc.registry = reg;
      await writeJsonAtomic(this.file, doc);
    });
  }
}

/**
 * `StateStore` for @qsd/crypto over a `ReserveBackend`. Semantics match
 * `MemoryStateStore` (the reference) plus durable CAS on a version counter.
 */
export class PersistentStateStore implements StateStore {
  constructor(readonly backend: ReserveBackend) {}

  async get(rootHex: string): Promise<IdentityState | undefined> {
    const r = await this.backend.readState(rootHex);
    return r?.state;
  }

  async put(rootHex: string, state: IdentityState, expected?: IdentityState | null): Promise<void> {
    validateState(state);
    if (state.root !== rootHex) throw new CryptoInputError('state root does not match key');
    const cur = await this.backend.readState(rootHex);
    if (expected === null) {
      if (cur) throw new StateConflictError(rootHex);
    } else if (expected !== undefined) {
      if (!cur || cur.state.used !== expected.used) throw new StateConflictError(rootHex);
    }
    const merged = cur ? mergeStates(cur.state, state) : { ...state };
    const ok = await this.backend.writeState(rootHex, { version: (cur?.version ?? 0) + 1, state: merged }, cur?.version ?? 0);
    if (!ok) throw new StateConflictError(rootHex);
  }
}

export const SEED_BYTES = 32;
const seedLabel = (ca: string) => `qsd/identity-seed/${ca}`;

/**
 * The reserve itself: creates and retrieves per-coin launch identities. The
 * seed goes straight into the vault; `Identity` objects are rebuilt from it
 * on demand (≈ 3 s of key generation, see @qsd/crypto).
 */
export class IdentityReserve {
  readonly stateStore: PersistentStateStore;
  constructor(
    readonly vault: KeyVault,
    readonly backend: ReserveBackend,
  ) {
    this.stateStore = new PersistentStateStore(backend);
  }

  async entry(ca: string): Promise<ReserveEntry | undefined> {
    return (await this.backend.readRegistry())[ca];
  }

  async list(): Promise<ReserveEntry[]> {
    return Object.values(await this.backend.readRegistry()).sort((a, b) => a.ca.localeCompare(b.ca));
  }

  /** Create a fresh identity for a coin; throws if the coin already has one. */
  async createForCoin(ca: string, opts: { seed?: Uint8Array; observer?: Parameters<typeof createIdentity>[1] } = {}): Promise<{ entry: ReserveEntry; identity: Identity }> {
    if (await this.entry(ca)) throw new ChainError(`identity reserve already holds an identity for ${ca}`);
    const seed = opts.seed ?? randomBytes(SEED_BYTES);
    if (seed.length < SEED_BYTES) throw new ChainError(`seed must be at least ${SEED_BYTES} bytes`);
    const identity = createIdentity(seed, opts.observer ?? {});
    const label = seedLabel(ca);
    await this.vault.storeSecret(label, seed);
    const entry: ReserveEntry = {
      ca,
      identityRoot: identity.rootHex,
      pubSeed: identity.initialState().pubSeed,
      seedLabel: label,
      createdAt: new Date().toISOString(),
    };
    const reg = await this.backend.readRegistry();
    reg[ca] = entry;
    await this.backend.writeRegistry(reg);
    // Initial state is written with expected=null so a concurrent creator conflicts.
    await this.stateStore.put(identity.rootHex, identity.initialState(), null);
    return { entry, identity };
  }

  /** Rebuild the identity for a coin from its encrypted seed. */
  async identityFor(ca: string): Promise<Identity> {
    const e = await this.entry(ca);
    if (!e) throw new ChainError(`identity reserve has no identity for ${ca}`);
    const seed = await this.vault.loadSecret(e.seedLabel);
    const id = createIdentity(seed);
    if (id.rootHex !== e.identityRoot) throw new ChainError(`identity reserve: rebuilt root for ${ca} does not match the registry`);
    return id;
  }

  /** A store-backed signer: every signature reserves its index durably first. */
  async signerFor(ca: string): Promise<Signer> {
    return new Signer(await this.identityFor(ca), this.stateStore);
  }

  signerForIdentity(identity: Identity): Signer {
    return new Signer(identity, this.stateStore);
  }
}
