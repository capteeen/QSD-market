/**
 * Journals: small, durable, versioned JSON documents written atomically.
 * Every multi-step chain process (airdrop, collapse, fee tally) records its
 * progress here so a crash can resume without repeating a paid step.
 */
import { JournalError } from './errors.js';
import { readTextFile, writeTextAtomic } from './keys.js';

/** bigint ↔ JSON: `{ "$bigint": "123" }`. Journals use these so protocol tables round-trip exactly. */
export function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? { $bigint: v.toString() } : v;
}
export function bigintReviver(_k: string, v: unknown): unknown {
  if (typeof v === 'object' && v !== null && '$bigint' in v && typeof (v as { $bigint: unknown }).$bigint === 'string') {
    return BigInt((v as { $bigint: string }).$bigint);
  }
  return v;
}
export const stringifyJournal = (doc: unknown): string => JSON.stringify(doc, bigintReplacer, 2);
export const parseJournal = <T>(text: string): T => JSON.parse(text, bigintReviver) as T;

export interface JournalStore<T> {
  load(): Promise<T | undefined>;
  /** Replace the document. Implementations must be atomic (all or nothing). */
  save(doc: T): Promise<void>;
}

export class MemoryJournalStore<T> implements JournalStore<T> {
  private doc: string | undefined;
  constructor(initial?: T) {
    if (initial !== undefined) this.doc = stringifyJournal(initial);
  }
  async load(): Promise<T | undefined> {
    return this.doc === undefined ? undefined : parseJournal<T>(this.doc);
  }
  async save(doc: T): Promise<void> {
    this.doc = stringifyJournal(doc);
  }
  /** Test helper: a second "process" opening the same storage. */
  reopen(): MemoryJournalStore<T> {
    const s = new MemoryJournalStore<T>();
    s.doc = this.doc;
    return s;
  }
}

export class FileJournalStore<T> implements JournalStore<T> {
  constructor(readonly file: string) {}
  async load(): Promise<T | undefined> {
    try {
      const text = await readTextFile(this.file);
      return text === undefined ? undefined : parseJournal<T>(text);
    } catch (e) {
      throw new JournalError(`journal ${this.file} is unreadable: ${(e as Error).message}`);
    }
  }
  async save(doc: T): Promise<void> {
    await writeTextAtomic(this.file, stringifyJournal(doc));
  }
}

/** Sleep helper used by retry loops; injectable so tests do not wait. */
export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export interface RetryOptions {
  attempts: number;
  baseMs: number;
  maxMs: number;
  sleep?: Sleep;
  /** Return true when the error is worth retrying. */
  retryIf: (e: unknown) => boolean;
  onRetry?: (attempt: number, e: unknown) => void;
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, o: RetryOptions): Promise<T> {
  const sleep = o.sleep ?? realSleep;
  let last: unknown;
  for (let attempt = 1; attempt <= o.attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      last = e;
      if (attempt === o.attempts || !o.retryIf(e)) throw e;
      o.onRetry?.(attempt, e);
      const delay = Math.min(o.maxMs, o.baseMs * 2 ** (attempt - 1));
      await sleep(delay);
    }
  }
  throw last;
}

// ------------------------------------------------------------------ leases

export interface Lease {
  owner: string;
  /** Unix ms. */
  expiresAt: number;
}

/** Documents that can be leased: a version counter for CAS and the current lease. */
export interface Leasable {
  version?: number;
  lease?: Lease;
}

export class LeaseError extends JournalError {}

export const DEFAULT_LEASE_TTL_MS = 30_000;

/**
 * A journal document held under an exclusive lease. Every `save()` is a
 * compare-and-swap on the document's version counter and re-checks that the
 * lease is still ours; a second worker sees the lease and waits for it to be
 * released or to expire. `release()` runs in the owner's `finally`, so a
 * worker that exits by exception frees the journal at once; only a hard kill
 * leaves the lease to expire after `ttlMs`.
 */
export class LeasedJournal<T extends Leasable> {
  readonly owner: string;
  private version = 0;
  private held = false;
  constructor(
    readonly store: JournalStore<T>,
    opts: { owner?: string; ttlMs?: number; sleep?: Sleep; now?: () => number; waitMs?: number } = {},
  ) {
    this.owner = opts.owner ?? `${process.pid}-${Date.now().toString(36)}-${leaseCounter++}`;
    this.ttlMs = opts.ttlMs ?? DEFAULT_LEASE_TTL_MS;
    this.sleep = opts.sleep ?? realSleep;
    this.now = opts.now ?? Date.now;
    this.waitMs = opts.waitMs ?? 2 * this.ttlMs;
  }
  private readonly ttlMs: number;
  private readonly sleep: Sleep;
  private readonly now: () => number;
  private readonly waitMs: number;

  /** Acquire the lease, waiting for a live holder to finish. `init` creates the document when none exists. */
  async acquire(init: () => T): Promise<T> {
    const start = this.now();
    for (;;) {
      const cur = (await this.store.load()) ?? init();
      const l = cur.lease;
      if (l && l.owner !== this.owner && l.expiresAt > this.now()) {
        if (this.now() - start > this.waitMs) throw new LeaseError(`journal is leased by another worker (${l.owner}) and did not free up within ${this.waitMs} ms`);
        await this.sleep(Math.min(250, Math.max(5, this.ttlMs / 20)));
        continue;
      }
      const version = (cur.version ?? 0) + 1;
      const next: T = { ...cur, version, lease: { owner: this.owner, expiresAt: this.now() + this.ttlMs } };
      // CAS: the stored version must still be what we read (the store's load+save is not interrupted by awaits here).
      const check = await this.store.load();
      if ((check?.version ?? 0) !== (cur.version ?? 0)) continue;
      await this.store.save(next);
      const verify = await this.store.load();
      if (verify?.lease?.owner !== this.owner || verify.version !== version) continue;
      this.version = version;
      this.held = true;
      return next;
    }
  }

  /** CAS save under the lease; refreshes the lease expiry. */
  async save(doc: T): Promise<void> {
    if (!this.held) throw new LeaseError('save without a held lease');
    const stored = await this.store.load();
    if ((stored?.version ?? 0) !== this.version) throw new LeaseError(`journal version changed underneath worker ${this.owner} (lost the lease)`);
    if (stored?.lease?.owner !== this.owner) throw new LeaseError(`journal lease is no longer held by worker ${this.owner}`);
    const version = this.version + 1;
    const lease: Lease = { owner: this.owner, expiresAt: this.now() + this.ttlMs };
    await this.store.save({ ...doc, version, lease });
    this.version = version;
    Object.assign(doc, { version, lease });
  }

  async release(doc: T): Promise<void> {
    if (!this.held) return;
    this.held = false;
    const stored = await this.store.load();
    if (!stored || stored.lease?.owner !== this.owner) return;
    const version = this.version + 1;
    const next: T = { ...doc, version };
    delete next.lease;
    await this.store.save(next);
    Object.assign(doc, { version });
    delete doc.lease;
  }
}
let leaseCounter = 0;
