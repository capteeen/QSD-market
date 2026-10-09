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
import type { AllocationTable } from '@qsd/protocol';
import type { AnchorFn } from './anchor.js';
import { ChainError, ChainUnavailableError, JournalError, errorMessage, isTransient } from './errors.js';
import { FileJournalStore, MemoryJournalStore, realSleep, withRetry, type JournalStore, type Sleep } from './journal.js';
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
  private readonly sizes = new Map<string, number>();
  constructor(private readonly sender: TransactionSender, private readonly connectionLatestBlockhash: () => Promise<{ blockhash: string; lastValidBlockHeight: number }>, private readonly sign: (tx: VersionedTransaction) => void, private readonly submitRaw: (bytes: Uint8Array) => Promise<string>) {
    this.cluster = sender.cluster;
    this.payer = sender.payer;
  }

  async maxTransfersPerTx(mint: string): Promise<number> {
    let n = this.sizes.get(mint);
    if (n === undefined) {
      n = computeMaxTransfersPerTx(this.payer, new PublicKey(mint));
      this.sizes.set(mint, n);
    }
    return n;
  }

  async prepareTransfers(mint: string, transfers: readonly Transfer[]): Promise<PreparedTransfer> {
    const ixs = buildTransferInstructions(this.payer, new PublicKey(mint), transfers);
    let bh: { blockhash: string; lastValidBlockHeight: number };
    try {
      bh = await this.connectionLatestBlockhash();
    } catch (e) {
      throw new ChainUnavailableError(`getLatestBlockhash: ${errorMessage(e)}`, { cause: e });
    }
    const msg = new TransactionMessage({ payerKey: this.payer, recentBlockhash: bh.blockhash, instructions: ixs }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    this.sign(tx);
    const bytes = tx.serialize();
    const sigBytes = tx.signatures[0];
    if (!sigBytes) throw new ChainError('transaction has no signature after signing');
    const signature = base58(sigBytes);
    const submitRaw = this.submitRaw;
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
    return this.sender.status(signature, lastValidBlockHeight);
  }
  confirm(signature: string, lastValidBlockHeight: number): Promise<TxStatus> {
    return this.sender.confirm(signature, lastValidBlockHeight);
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

export interface AirdropJournalDoc {
  version: 1;
  mint: string;
  merkleRoot: string;
  totalUnits: string;
  createdAt: string;
  rootAnchor?: { txSignature: string; at: string };
  entries: Record<string, AirdropEntryRecord>;
  /** Every transaction signature ever journalled, in order. */
  signatures: string[];
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
  maxAttemptsPerBatch?: number;
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
    version: 1,
    mint,
    merkleRoot: table.merkleRoot,
    totalUnits: table.allocatedUnits.toString(),
    createdAt: new Date().toISOString(),
    entries,
    signatures: [],
  };
}

/**
 * Run (or resume) the airdrop. Idempotent: calling it again after success
 * does nothing but return the report; calling it after any crash finishes
 * the job without re-paying a confirmed wallet.
 */
export async function runAirdrop(args: RunAirdropArgs): Promise<AirdropReport> {
  const { table, mint, sender, journal, observer } = args;
  const sleep = args.sleep ?? realSleep;
  const log = args.log ?? (() => undefined);
  const maxAttempts = args.maxAttemptsPerBatch ?? 8;

  let doc = await journal.load();
  const resumed = doc !== undefined;
  if (!doc) {
    doc = initDoc(table, mint);
    await journal.save(doc);
  } else {
    if (doc.mint !== mint || doc.merkleRoot !== table.merkleRoot) {
      throw new JournalError(`airdrop journal belongs to mint ${doc.mint} / root ${doc.merkleRoot.slice(0, 16)}…, not this allocation`);
    }
    for (const e of table.entries) {
      if (e.units <= 0n) continue;
      const rec = doc.entries[e.wallet];
      if (!rec || rec.units !== e.units.toString()) throw new JournalError(`airdrop journal disagrees with the table for ${e.wallet}`);
    }
  }
  const save = async () => {
    await journal.save(doc as AirdropJournalDoc);
  };

  // 1. Anchor the allocation root exactly once.
  if (!doc.rootAnchor) {
    const a = await args.anchor(table.merkleRoot, 'allocation-root');
    doc.rootAnchor = { txSignature: a.txSignature, at: new Date().toISOString() };
    await save();
    log(`anchored allocation root ${table.merkleRoot} in ${a.txSignature}`);
  }

  // 2. Reconcile every `sent` entry with the chain before sending anything.
  const sentGroups = new Map<string, AirdropEntryRecord[]>();
  for (const rec of Object.values(doc.entries)) {
    if (rec.status === 'sent' && rec.txSignature) {
      const g = sentGroups.get(rec.txSignature) ?? [];
      g.push(rec);
      sentGroups.set(rec.txSignature, g);
    }
  }
  for (const [sig, recs] of sentGroups) {
    const lvbh = recs[0]?.lastValidBlockHeight ?? 0;
    let s = await sender.status(sig, lvbh);
    if (s === 'pending') s = await sender.confirm(sig, lvbh);
    if (s === 'confirmed' || s === 'finalized') {
      for (const r of recs) {
        r.status = 'confirmed';
        r.confirmedAt = new Date().toISOString();
      }
      observer?.emit({ type: 'airdropBatchConfirmed', txSignature: sig, wallets: recs.map((r) => r.wallet) });
      log(`resume: ${sig} confirmed (${recs.length} wallets)`);
    } else {
      for (const r of recs) {
        r.status = 'pending';
        r.lastError = `previous transaction ${sig} ${s}`;
        delete r.txSignature;
        delete r.lastValidBlockHeight;
      }
      log(`resume: ${sig} ${s}; ${recs.length} wallets back to pending`);
    }
    await save();
  }

  // 3. Send the pending entries in batches.
  const batchSize = await sender.maxTransfersPerTx(mint);
  if (batchSize < 1) throw new ChainError('sender reports a batch size below 1');
  for (;;) {
    const pending = Object.values(doc.entries)
      .filter((r) => r.status === 'pending')
      .sort((a, b) => (a.wallet < b.wallet ? -1 : 1))
      .slice(0, batchSize);
    if (pending.length === 0) break;
    const transfers: Transfer[] = pending.map((r) => ({ wallet: r.wallet, units: BigInt(r.units) }));

    await withRetry(
      async (attempt) => {
        for (const r of pending) r.attempts++;
        const prepared = await sender.prepareTransfers(mint, transfers);
        for (const r of pending) {
          r.status = 'sent';
          r.txSignature = prepared.signature;
          r.lastValidBlockHeight = prepared.lastValidBlockHeight;
        }
        (doc as AirdropJournalDoc).signatures.push(prepared.signature);
        await save(); // journalled BEFORE submission
        await args.hooks?.afterJournalSent?.(prepared.signature);
        try {
          await prepared.submit();
        } catch (e) {
          // Submission failed: the signature cannot have landed unless the RPC lied; verify by status.
          const s = await sender.status(prepared.signature, prepared.lastValidBlockHeight);
          if (s !== 'confirmed' && s !== 'finalized') {
            for (const r of pending) {
              r.status = 'pending';
              r.lastError = `attempt ${attempt}: ${errorMessage(e)}`;
              delete r.txSignature;
              delete r.lastValidBlockHeight;
            }
            await save();
            throw e;
          }
        }
        observer?.emit({ type: 'airdropBatchSent', txSignature: prepared.signature, wallets: pending.map((r) => r.wallet), units: transfers.reduce((a, t) => a + t.units, 0n).toString() });
        await args.hooks?.afterSubmit?.(prepared.signature);
        const s = await sender.confirm(prepared.signature, prepared.lastValidBlockHeight);
        if (s === 'confirmed' || s === 'finalized') {
          for (const r of pending) {
            r.status = 'confirmed';
            r.confirmedAt = new Date().toISOString();
          }
          await save();
          observer?.emit({ type: 'airdropBatchConfirmed', txSignature: prepared.signature, wallets: pending.map((r) => r.wallet) });
          log(`batch ${prepared.signature} confirmed (${pending.length} wallets)`);
          return;
        }
        for (const r of pending) {
          r.status = 'pending';
          r.lastError = `attempt ${attempt}: transaction ${prepared.signature} ${s}`;
          delete r.txSignature;
          delete r.lastValidBlockHeight;
        }
        await save();
        if (s === 'failed') throw new ChainUnavailableError(`airdrop batch ${prepared.signature} failed on-chain`);
        throw new ChainUnavailableError(`airdrop batch ${prepared.signature} expired`);
      },
      {
        attempts: maxAttempts,
        baseMs: 500,
        maxMs: 15_000,
        sleep,
        retryIf: (e) => isTransient(e) || /expired/.test(errorMessage(e)),
        onRetry: (attempt, e) => log(`batch retry ${attempt}: ${errorMessage(e)}`),
      },
    );
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
    resumed,
  };
}
