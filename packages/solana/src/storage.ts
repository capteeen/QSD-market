/**
 * Durable storage for everything the chain layer must never lose: encrypted
 * keys (KeyStore), identity one-time-key state (ReserveBackend) and the
 * crash-resume journals (JournalStore).
 *
 * `createChain` defaults to files under QSD_KEYSTORE_PATH / QSD_JOURNAL_DIR.
 * A host without a persistent disk (Vercel) passes a `ChainStorage` instead,
 * built with `kvChainStorage` over any key-value table with a version column
 * (the web app uses Postgres through Prisma). Only ciphertext and journal
 * JSON ever reach the table; the key-encryption key never leaves the process.
 */
import type { EncryptedBlob, KeyStore } from './keys.js';
import { parseJournal, stringifyJournal, type JournalStore } from './journal.js';
import type { ReserveBackend, ReserveEntry, StateRecord } from './reserve.js';

export interface ChainStorage {
  keyStore: KeyStore;
  reserveBackend: ReserveBackend;
  journal<T>(name: string): JournalStore<T>;
}

export interface KvRecord {
  value: string;
  version: number;
}

/**
 * The primitive a database table has to provide. `cas` writes `value` with
 * version `expectedVersion + 1` only if the stored version is
 * `expectedVersion` (0 = no row yet), atomically, and reports whether it did.
 */
export interface KvStore {
  get(key: string): Promise<KvRecord | undefined>;
  put(key: string, value: string): Promise<void>;
  cas(key: string, value: string, expectedVersion: number): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Keys starting with `prefix`, sorted. */
  list(prefix: string): Promise<string[]>;
}

export const KV_PREFIX = {
  key: 'key/',
  state: 'reserve/state/',
  registry: 'reserve/registry/',
  journal: 'journal/',
} as const;

export class KvKeyStore implements KeyStore {
  constructor(private readonly kv: KvStore) {}
  async get(label: string): Promise<EncryptedBlob | undefined> {
    const r = await this.kv.get(KV_PREFIX.key + label);
    return r ? (JSON.parse(r.value) as EncryptedBlob) : undefined;
  }
  async put(label: string, blob: EncryptedBlob): Promise<void> {
    await this.kv.put(KV_PREFIX.key + label, JSON.stringify(blob));
  }
  async delete(label: string): Promise<void> {
    await this.kv.delete(KV_PREFIX.key + label);
  }
  async list(): Promise<string[]> {
    return (await this.kv.list(KV_PREFIX.key)).map((k) => k.slice(KV_PREFIX.key.length));
  }
}

/**
 * Identity states use the row version as the CAS counter (it always equals
 * `StateRecord.version`). Registry entries are one row per coin, so two
 * concurrent launches cannot overwrite each other's entry; entries are never
 * removed (the registry is append-only).
 */
export class KvReserveBackend implements ReserveBackend {
  constructor(private readonly kv: KvStore) {}
  async readState(rootHex: string): Promise<StateRecord | undefined> {
    const r = await this.kv.get(KV_PREFIX.state + rootHex);
    return r ? (JSON.parse(r.value) as StateRecord) : undefined;
  }
  async writeState(rootHex: string, record: StateRecord, expectedVersion: number): Promise<boolean> {
    if (record.version !== expectedVersion + 1) return false;
    return this.kv.cas(KV_PREFIX.state + rootHex, JSON.stringify(record), expectedVersion);
  }
  async readRegistry(): Promise<Record<string, ReserveEntry>> {
    const out: Record<string, ReserveEntry> = {};
    for (const key of await this.kv.list(KV_PREFIX.registry)) {
      const r = await this.kv.get(key);
      if (r) out[key.slice(KV_PREFIX.registry.length)] = JSON.parse(r.value) as ReserveEntry;
    }
    return out;
  }
  async writeRegistry(reg: Record<string, ReserveEntry>): Promise<void> {
    for (const [ca, entry] of Object.entries(reg)) {
      const key = KV_PREFIX.registry + ca;
      const json = JSON.stringify(entry);
      if ((await this.kv.get(key))?.value !== json) await this.kv.put(key, json);
    }
  }
}

export class KvJournalStore<T> implements JournalStore<T> {
  constructor(private readonly kv: KvStore, readonly name: string) {}
  async load(): Promise<T | undefined> {
    const r = await this.kv.get(KV_PREFIX.journal + this.name);
    return r ? parseJournal<T>(r.value) : undefined;
  }
  async save(doc: T): Promise<void> {
    await this.kv.put(KV_PREFIX.journal + this.name, stringifyJournal(doc));
  }
}

export function kvChainStorage(kv: KvStore): ChainStorage {
  return {
    keyStore: new KvKeyStore(kv),
    reserveBackend: new KvReserveBackend(kv),
    journal: <T>(name: string) => new KvJournalStore<T>(kv, name),
  };
}

/** In-memory KvStore with the same semantics a database table must have. For tests. */
export class MemoryKvStore implements KvStore {
  private readonly rows = new Map<string, KvRecord>();
  async get(key: string): Promise<KvRecord | undefined> {
    const r = this.rows.get(key);
    return r ? { ...r } : undefined;
  }
  async put(key: string, value: string): Promise<void> {
    this.rows.set(key, { value, version: (this.rows.get(key)?.version ?? 0) + 1 });
  }
  async cas(key: string, value: string, expectedVersion: number): Promise<boolean> {
    if ((this.rows.get(key)?.version ?? 0) !== expectedVersion) return false;
    this.rows.set(key, { value, version: expectedVersion + 1 });
    return true;
  }
  async delete(key: string): Promise<void> {
    this.rows.delete(key);
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.rows.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}
