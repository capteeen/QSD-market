/**
 * Daughter airdrop: SPL transfers per the allocation table, batched into
 * transactions sized against the 1232-byte packet limit, journalled per
 * entry, resumable after any crash without double-paying.
 *
 * Why it cannot double-pay: a Solana signature is a deterministic function
 * of the signed transaction, so every batch is journalled as
 * `sent { txSignature, lastValidBlockHeight }` BEFORE it is submitted. On
 * resume, a `sent` entry is decided by the chain (`status(signature)`):
 * confirmed/finalized → `confirmed`, never re-sent; failed or expired
 * (blockhash past `lastValidBlockHeight`, so it can never land) → back to
 * `pending`; still pending → wait for one of the above. A `confirmed` entry
 * is never touched again. The allocation Merkle root is anchored once and
 * journalled.
 */
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction, PACKET_DATA_SIZE } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { inspect } from 'node:util';
import type { AllocationTable } from '@qsd/protocol';
import type { AnchorFn } from './anchor.js';
import { ChainError, ChainUnavailableError, JournalError, errorMessage, isTransient } from './errors.js';
import { FileJournalStore, LeasedJournal, MemoryJournalStore, realSleep, type JournalStore, type Leasable, type Sleep } from './journal.js';
import type { ChainObserver } from './observer.js';
import type { SentTransaction, TransactionSender, TxStatus } from './sender.js';

export interface Transfer {
  wallet: string;
  units: bigint;
}

/** A signed-but-not-submitted batch. `signature` is known before submission. */
export interface PreparedTransfer extends SentTransaction {
  submit(): Promise<void>;
}

/**
 * The sender boundary for airdrops. The real implementation builds SPL
 * transfers with web3.js; tests supply a fault-injecting fake.
 */
export interface TransferSender {
  readonly cluster: string;
  readonly payer: PublicKey;
  /** Maximum transfers per transaction (see computeMaxTransfersPerTx). */
  maxTransfersPerTx(mint: string): Promise<number>;
  prepareTransfers(mint: string, transfers: readonly Transfer[]): Promise<PreparedTransfer>;
  status(signature: string, lastValidBlockHeight: number): Promise<TxStatus>;
  confirm(signature: string, lastValidBlockHeight: number): Promise<TxStatus>;
}

/** ATA-idempotent create + transfer for each recipient, from the payer's ATA. */
export function buildTransferInstructions(payer: PublicKey, mint: PublicKey, transfers: readonly Transfer[]): TransactionInstruction[] {
  const source = getAssociatedTokenAddressSync(mint, payer);
  const ixs: TransactionInstruction[] = [];
  for (const t of transfers) {
    if (t.units <= 0n) throw new ChainError(`transfer to ${t.wallet} must be positive`);
    const owner = new PublicKey(t.wallet);
    const ata = getAssociatedTokenAddressSync(mint, owner, true);
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint));
    ixs.push(createTransferInstruction(source, ata, payer, t.units));
  }
  return ixs;
}

/** Serialized size of a v0 transaction carrying these instructions (signatures zeroed). */
export function transactionSize(payer: PublicKey, ixs: TransactionInstruction[]): number {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: '11111111111111111111111111111111', instructions: ixs }).compileToV0Message();
  return new VersionedTransaction(msg).serialize().length;
}

/**
 * The largest N such that a transaction with N (ATA create + transfer)
 * pairs to distinct recipients fits in PACKET_DATA_SIZE (1232 bytes).
 * Computed by building the transaction, not guessed.
 */
export function computeMaxTransfersPerTx(payer: PublicKey, mint: PublicKey, extraInstructions: TransactionInstruction[] = []): number {
  let n = 0;
  const recipients: Transfer[] = [];
  for (;;) {
    recipients.push({ wallet: Keypair.generate().publicKey.toBase58(), units: 1n });
    const size = transactionSize(payer, [...extraInstructions, ...buildTransferInstructions(payer, mint, recipients)]);
    if (size > PACKET_DATA_SIZE) break;
    n = recipients.length;
    if (n >= 64) break;
  }
  if (n === 0) throw new ChainError('not even one transfer fits in a transaction');
  return n;
}

export class Web3TransferSender implements TransferSender {
  readonly cluster: string;
  readonly payer: PublicKey;
  readonly #sizes = new Map<string, number>();
  readonly #sender: TransactionSender;
  readonly #latestBlockhash: () => Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  readonly #sign: (tx: VersionedTransaction) => void;
  readonly #submitRaw: (bytes: Uint8Array) => Promise<string>;
  constructor(sender: TransactionSender, latestBlockhash: () => Promise<{ blockhash: string; lastValidBlockHeight: number }>, sign: (tx: VersionedTransaction) => void, submitRaw: (bytes: Uint8Array) => Promise<string>) {
    this.#sender = sender;
    this.#latestBlockhash = latestBlockhash;
    this.#sign = sign;
    this.#submitRaw = submitRaw;
    this.cluster = sender.cluster;
    this.payer = sender.payer;
  }

  toJSON(): { cluster: string; payer: string } {
    return { cluster: this.cluster, payer: this.payer.toBase58() };
  }
  [inspect.custom](): string {
    return `Web3TransferSender { cluster: '${this.cluster}', payer: '${this.payer.toBase58()}' }`;
  }

  async maxTransfersPerTx(mint: string): Promise<number> {
    let n = this.#sizes.get(mint);
    if (n === undefined) {
      n = computeMaxTransfersPerTx(this.payer, new PublicKey(mint));
      this.#sizes.set(mint, n);
    }
    return n;
  }

  async prepareTransfers(mint: string, transfers: readonly Transfer[]): Promise<PreparedTransfer> {
    const ixs = buildTransferInstructions(this.payer, new PublicKey(mint), transfers);
    let bh: { blockhash: string; lastValidBlockHeight: number };
    try {
      bh = await this.#latestBlockhash();
    } catch (e) {
      throw new ChainUnavailableError(`getLatestBlockhash: ${errorMessage(e)}`, { cause: e });
    }
    const msg = new TransactionMessage({ payerKey: this.payer, recentBlockhash: bh.blockhash, instructions: ixs }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    this.#sign(tx);
    const bytes = tx.serialize();
    const sigBytes = tx.signatures[0];
    if (!sigBytes) throw new ChainError('transaction has no signature after signing');
    const signature = base58(sigBytes);
    const submitRaw = this.#submitRaw;
    return {
      signature,
      lastValidBlockHeight: bh.lastValidBlockHeight,
      async submit() {
        const got = await submitRaw(bytes);
        if (got !== signature) throw new ChainError(`RPC returned signature ${got}, expected ${signature}`);
      },
    };
  }

  status(signature: string, lastValidBlockHeight: number): Promise<TxStatus> {
    return this.#sender.status(signature, lastValidBlockHeight);
  }
  confirm(signature: string, lastValidBlockHeight: number): Promise<TxStatus> {
    return this.#sender.confirm(signature, lastValidBlockHeight);
  }
}

/** Build the real sender from a web3 sender + connection + payer keypair. */
export function web3TransferSender(sender: TransactionSender, connection: { getLatestBlockhash(c: 'confirmed'): Promise<{ blockhash: string; lastValidBlockHeight: number }>; sendRawTransaction(b: Uint8Array, o?: { skipPreflight?: boolean; maxRetries?: number }): Promise<string> }, payer: Keypair): Web3TransferSender {
  return new Web3TransferSender(
    sender,
    () => connection.getLatestBlockhash('confirmed'),
    (tx) => tx.sign([payer]),
    (bytes) => connection.sendRawTransaction(bytes, { skipPreflight: false, maxRetries: 3 }),
  );
}

export function base58(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}

// ------------------------------------------------------------------ journal

export type AirdropEntryStatus = 'pending' | 'sent' | 'confirmed';

export interface AirdropEntryRecord {
  wallet: string;
  units: string; // bigint as string
  status: AirdropEntryStatus;
  txSignature?: string;
  lastValidBlockHeight?: number;
  attempts: number;
  lastError?: string;
  confirmedAt?: string;
}

export type BatchStatus = 'sent' | 'confirmed' | 'failed' | 'expired';

/** One transaction ever prepared for this airdrop, journalled BEFORE submission. */
export interface AirdropBatchRecord {
  signature: string;
  lastValidBlockHeight: number;
  wallets: string[];
  status: BatchStatus;
  preparedAt: string;
  decidedAt?: string;
}

export interface AirdropJournalDoc extends Leasable {
  version?: number;
  mint: string;
  merkleRoot: string;
  totalUnits: string;
  createdAt: string;
  rootAnchor?: { txSignature: string; at: string };
  entries: Record<string, AirdropEntryRecord>;
  /** Every transaction signature ever journalled, in order (audit; superset of `batches`). */
  signatures: string[];
  /** Per-signature batch records; every signature in `signatures` has one. */
  batches?: Record<string, AirdropBatchRecord>;
}

export type AirdropJournal = JournalStore<AirdropJournalDoc>;
export class MemoryAirdropJournal extends MemoryJournalStore<AirdropJournalDoc> {}
export class FileAirdropJournal extends FileJournalStore<AirdropJournalDoc> {}

export interface AirdropHooks {
  /** Called right after an entry batch is journalled `sent` and before submit. Throwing simulates a crash. */
  afterJournalSent?: (signature: string) => Promise<void> | void;
  /** Called right after submit and before the confirmation is journalled. Throwing simulates a crash. */
  afterSubmit?: (signature: string) => Promise<void> | void;
}

export interface RunAirdropArgs {
  table: AllocationTable;
  mint: string;
  sender: TransferSender;
  journal: AirdropJournal;
  /** Anchors the Merkle root once (`allocation-root`). */
  anchor: AnchorFn;
  observer?: ChainObserver;
  sleep?: Sleep;
  /** Give up (throw ChainUnavailableError) once any wallet has been attempted this many times IN THIS RUN; a later run gets a fresh budget. */
  maxAttemptsPerBatch?: number;
  /** Lease time-to-live for the journal (ms); a second worker waits for it. */
  leaseTtlMs?: number;
  hooks?: AirdropHooks;
  log?: (line: string) => void;
}

export interface AirdropReport {
  mint: string;
  merkleRoot: string;
  rootAnchorSignature: string;
  wallets: number;
  confirmedWallets: number;
  /** Σ units of confirmed entries — equals the table's allocatedUnits when done. */
  confirmedUnits: bigint;
  signatures: string[];
  resumed: boolean;
}

function initDoc(table: AllocationTable, mint: string): AirdropJournalDoc {
  const entries: Record<string, AirdropEntryRecord> = {};
  for (const e of table.entries) {
    if (e.units <= 0n) continue; // nothing to send; not journalled as a transfer
    entries[e.wallet] = { wallet: e.wallet, units: e.units.toString(), status: 'pending', attempts: 0 };
  }
  return {
    mint,
    merkleRoot: table.merkleRoot,
    totalUnits: table.allocatedUnits.toString(),
    createdAt: new Date().toISOString(),
    entries,
    signatures: [],
    batches: {},
  };
}

/**
 * Run (or resume) the airdrop. Idempotent: calling it again after success
 * does nothing but return the report; calling it after any crash finishes
 * the job without re-paying a confirmed wallet.
 *
 * Invariant: an entry journalled `sent` under signature S is only ever
 * moved by the chain's verdict on S — `confirmed`/`finalized` → confirmed,
 * `failed`/`expired` → pending again. A transient error, a timeout, a
 * thrown submit, a crash: none of them move an entry. Every decision is
 * taken from the journal, never from records captured in a closure.
 */
export async function runAirdrop(args: RunAirdropArgs): Promise<AirdropReport> {
  const { table, mint, sender, observer } = args;
  const sleep = args.sleep ?? realSleep;
  const log = args.log ?? (() => undefined);
  const maxAttempts = args.maxAttemptsPerBatch ?? 8;
  const leased = new LeasedJournal<AirdropJournalDoc>(args.journal, { sleep, ...(args.leaseTtlMs !== undefined ? { ttlMs: args.leaseTtlMs } : {}) });

  const existed = (await args.journal.load()) !== undefined;
  const doc = await leased.acquire(() => initDoc(table, mint));
  try {
    doc.batches ??= {};
    if (existed) {
      if (doc.mint !== mint || doc.merkleRoot !== table.merkleRoot) {
        throw new JournalError(`airdrop journal belongs to mint ${doc.mint} / root ${doc.merkleRoot.slice(0, 16)}…, not this allocation`);
      }
      for (const e of table.entries) {
        if (e.units <= 0n) continue;
        const rec = doc.entries[e.wallet];
        if (!rec || rec.units !== e.units.toString()) throw new JournalError(`airdrop journal disagrees with the table for ${e.wallet}`);
      }
      if (Object.keys(doc.entries).length !== table.entries.filter((e) => e.units > 0n).length) throw new JournalError('airdrop journal has entries the table does not');
    }
    const save = () => leased.save(doc);

    // 1. Anchor the allocation root exactly once.
    if (!doc.rootAnchor) {
      const a = await args.anchor(table.merkleRoot, 'allocation-root');
      doc.rootAnchor = { txSignature: a.txSignature, at: new Date().toISOString() };
      await save();
      log(`anchored allocation root ${table.merkleRoot} in ${a.txSignature}`);
    }

    const batches = doc.batches;
    const markBatch = (sig: string, status: Exclude<BatchStatus, 'sent'>) => {
      const b = batches[sig];
      if (!b) return;
      b.status = status;
      b.decidedAt = new Date().toISOString();
      const wallets = b.wallets;
      if (status === 'confirmed') {
        for (const w of wallets) {
          const r = doc.entries[w];
          if (r && r.status !== 'confirmed') {
            r.status = 'confirmed';
            r.txSignature = sig;
            r.lastValidBlockHeight = b.lastValidBlockHeight;
            r.confirmedAt = b.decidedAt;
          }
        }
        observer?.emit({ type: 'airdropBatchConfirmed', txSignature: sig, wallets });
      } else {
        for (const w of wallets) {
          const r = doc.entries[w];
          if (r && r.status === 'sent' && r.txSignature === sig) {
            r.status = 'pending';
            r.lastError = `transaction ${sig} ${status}`;
            delete r.txSignature;
            delete r.lastValidBlockHeight;
          }
        }
      }
    };

    /**
     * Decide every undecided signature from the chain. Returns the number of
     * signatures still pending (a transient status error leaves them undecided).
     */
    const reconcile = async (): Promise<{ undecided: number; failed: string[] }> => {
      let undecided = 0;
      const failed: string[] = [];
      for (const b of Object.values(batches)) {
        if (b.status !== 'sent') continue;
        let s: TxStatus;
        try {
          s = await sender.status(b.signature, b.lastValidBlockHeight);
          if (s === 'pending') s = await sender.confirm(b.signature, b.lastValidBlockHeight);
        } catch (e) {
          if (!isTransient(e)) throw e; // a real failure (or a process death) propagates; the journal still says `sent`
          // Unknown is unknown: leave the batch `sent` and look again later.
          undecided++;
          log(`status of ${b.signature} unknown (${errorMessage(e)}); will re-check`);
          continue;
        }
        if (s === 'confirmed' || s === 'finalized') markBatch(b.signature, 'confirmed');
        else if (s === 'failed') {
          markBatch(b.signature, 'failed');
          failed.push(b.signature);
        } else if (s === 'expired') markBatch(b.signature, 'expired');
        else undecided++;
        await save();
        if (s !== 'pending') log(`${b.signature}: ${s} (${b.wallets.length} wallets)`);
      }
      return { undecided, failed };
    };

    // 2. Reconcile anything journalled by an earlier run (including orphans not attached to an entry).
    {
      const r = await reconcile();
      if (r.failed.length > 0) throw new ChainUnavailableError(`airdrop batch ${r.failed[0]} failed on-chain; entries returned to pending`);
    }

    // 3. Send the pending entries in batches, deciding every signature from the chain.
    const batchSize = await sender.maxTransfersPerTx(mint);
    if (batchSize < 1) throw new ChainError('sender reports a batch size below 1');
    const attemptsThisRun = new Map<string, number>(); // the budget is per run; `entry.attempts` in the journal is the lifetime audit count
    const bump = (wallet: string) => attemptsThisRun.set(wallet, (attemptsThisRun.get(wallet) ?? 0) + 1);
    let backoff = 0;
    for (;;) {
      const inFlight = Object.values(batches).some((b) => b.status === 'sent');
      if (inFlight) {
        if (backoff > 0) await sleep(Math.min(15_000, 500 * 2 ** (backoff - 1)));
        backoff++;
        if (backoff > maxAttempts * 4) throw new ChainUnavailableError('airdrop: in-flight transactions could not be decided; resume later');
        const r = await reconcile();
        if (r.failed.length > 0) throw new ChainUnavailableError(`airdrop batch ${r.failed[0]} failed on-chain; entries returned to pending`);
        continue;
      }
      backoff = 0;
      const pending = Object.values(doc.entries)
        .filter((r) => r.status === 'pending')
        .sort((a, b) => (a.wallet < b.wallet ? -1 : 1))
        .slice(0, batchSize);
      if (pending.length === 0) break;
      const exhausted = pending.find((r) => (attemptsThisRun.get(r.wallet) ?? 0) >= maxAttempts);
      if (exhausted) throw new ChainUnavailableError(`airdrop: ${exhausted.wallet} attempted ${attemptsThisRun.get(exhausted.wallet)} times in this run without a confirmed transaction (${exhausted.lastError ?? 'no error recorded'}); resume later`);

      const transfers: Transfer[] = pending.map((r) => ({ wallet: r.wallet, units: BigInt(r.units) }));
      let prepared: PreparedTransfer;
      try {
        prepared = await sender.prepareTransfers(mint, transfers);
      } catch (e) {
        if (!isTransient(e)) throw e;
        for (const r of pending) {
          r.attempts++;
          bump(r.wallet);
          r.lastError = `prepare: ${errorMessage(e)}`;
        }
        await save();
        await sleep(500);
        continue;
      }
      for (const r of pending) {
        r.attempts++;
        bump(r.wallet);
        r.status = 'sent';
        r.txSignature = prepared.signature;
        r.lastValidBlockHeight = prepared.lastValidBlockHeight;
      }
      doc.signatures.push(prepared.signature);
      batches[prepared.signature] = { signature: prepared.signature, lastValidBlockHeight: prepared.lastValidBlockHeight, wallets: pending.map((r) => r.wallet), status: 'sent', preparedAt: new Date().toISOString() };
      await save(); // journalled BEFORE submission
      await args.hooks?.afterJournalSent?.(prepared.signature);
      try {
        await prepared.submit();
      } catch (e) {
        // The RPC may have accepted it anyway. Nothing moves: the chain decides on the next reconcile.
        for (const r of pending) r.lastError = `submit: ${errorMessage(e)}`;
        await save();
        log(`submit of ${prepared.signature} threw (${errorMessage(e)}); deciding by status`);
        continue;
      }
      observer?.emit({ type: 'airdropBatchSent', txSignature: prepared.signature, wallets: pending.map((r) => r.wallet), units: transfers.reduce((a, t) => a + t.units, 0n).toString() });
      await args.hooks?.afterSubmit?.(prepared.signature);
      // Decide now when possible; a thrown confirm (timeout) leaves the batch `sent` for reconcile.
      let s: TxStatus | undefined;
      try {
        s = await sender.confirm(prepared.signature, prepared.lastValidBlockHeight);
      } catch (e) {
        if (!isTransient(e)) throw e; // the batch stays `sent`; the next run decides it by status
        log(`confirm of ${prepared.signature} threw (${errorMessage(e)}); deciding by status`);
      }
      if (s === 'confirmed' || s === 'finalized') {
        markBatch(prepared.signature, 'confirmed');
        await save();
        log(`batch ${prepared.signature} confirmed (${pending.length} wallets)`);
      } else if (s === 'failed') {
        markBatch(prepared.signature, 'failed');
        await save();
        throw new ChainUnavailableError(`airdrop batch ${prepared.signature} failed on-chain; entries returned to pending`);
      } else if (s === 'expired') {
        markBatch(prepared.signature, 'expired');
        await save();
        log(`batch ${prepared.signature} expired; will re-send`);
      }
    }

    const confirmed = Object.values(doc.entries).filter((r) => r.status === 'confirmed');
    const confirmedUnits = confirmed.reduce((a, r) => a + BigInt(r.units), 0n);
    if (confirmedUnits !== table.allocatedUnits) {
      throw new ChainError(`airdrop finished with ${confirmedUnits} units confirmed but the table allocates ${table.allocatedUnits}`);
    }
    return {
      mint,
      merkleRoot: table.merkleRoot,
      rootAnchorSignature: doc.rootAnchor?.txSignature ?? '',
      wallets: Object.keys(doc.entries).length,
      confirmedWallets: confirmed.length,
      confirmedUnits,
      signatures: [...doc.signatures],
      resumed: existed,
    };
  } finally {
    await leased.release(doc).catch(() => undefined);
  }
}
