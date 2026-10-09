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
