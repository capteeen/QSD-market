/**
 * The boundary between this package and the network. Everything that pays
 * for a transaction goes through a `TransactionSender`; the real one wraps
 * @solana/web3.js, and tests fulfil the same interface with a fault-injecting
 * fake (test infrastructure for the sender boundary, not fake chain data).
 */
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  type Commitment,
} from '@solana/web3.js';
import { inspect } from 'node:util';
import bs58 from 'bs58';
import { ChainUnavailableError, TransientChainError, errorMessage, isTransient } from './errors.js';

export interface SentTransaction {
  signature: string;
  /** The last block height at which the transaction's blockhash is valid. */
  lastValidBlockHeight: number;
}

/**
 * 'confirmed' / 'finalized': landed successfully.
 * 'failed': landed but the program errored (never retried blindly).
 * 'pending': not seen yet but its blockhash may still be valid.
 * 'expired': not seen and the blockhash can no longer be valid — safe to resend.
 */
export type TxStatus = 'pending' | 'confirmed' | 'finalized' | 'failed' | 'expired';

export interface SendOptions {
  /** Extra signers besides the payer. */
  signers?: Keypair[];
  computeUnitLimit?: number;
  computeUnitPriceMicroLamports?: number;
  skipPreflight?: boolean;
}

/** A signed transaction whose signature is known before it is submitted. */
export interface PreparedTransaction extends SentTransaction {
  submit(): Promise<void>;
}

export interface TransactionSender {
  readonly cluster: string;
  readonly payer: PublicKey;
  /** Build, sign (payer + signers) and submit a transaction with these instructions. */
  send(instructions: TransactionInstruction[], opts?: SendOptions): Promise<SentTransaction>;
  /**
   * Optional: build and sign without submitting, so the caller can journal
   * the signature BEFORE the transaction reaches the RPC. `sendTracked()`
   * uses it when present and falls back to `send()`.
   */
  prepare?(instructions: TransactionInstruction[], opts?: SendOptions): Promise<PreparedTransaction>;
  /** Sign (payer + signers) and submit a transaction someone else built (PumpPortal, Jupiter). */
  sendVersioned(tx: VersionedTransaction, signers?: Keypair[]): Promise<SentTransaction>;
  status(signature: string, lastValidBlockHeight: number): Promise<TxStatus>;
  /** Poll until confirmed/finalized/failed/expired. */
  confirm(signature: string, lastValidBlockHeight: number): Promise<TxStatus>;
}

export interface Web3SenderOptions {
  commitment?: Commitment;
  pollMs?: number;
  /** How long `confirm` waits after expiry before giving up (ms). */
  maxWaitMs?: number;
}

export class Web3TransactionSender implements TransactionSender {
  readonly payer: PublicKey;
  readonly cluster: string;
  readonly #connection: Connection;
  readonly #payerKeypair: Keypair;
  readonly #commitment: Commitment;
  readonly #pollMs: number;
  readonly #maxWaitMs: number;
  constructor(connection: Connection, payerKeypair: Keypair, cluster: string, opts: Web3SenderOptions = {}) {
    this.#connection = connection;
    this.#payerKeypair = payerKeypair;
    this.cluster = cluster;
    this.payer = payerKeypair.publicKey;
    this.#commitment = opts.commitment ?? 'confirmed';
    this.#pollMs = opts.pollMs ?? 1500;
    this.#maxWaitMs = opts.maxWaitMs ?? 120_000;
  }

  get connection(): Connection {
    return this.#connection;
  }

  /** Never reveal the keypair or the RPC URL through serialisation / inspection. */
  toJSON(): { cluster: string; payer: string } {
    return { cluster: this.cluster, payer: this.payer.toBase58() };
  }
  [inspect.custom](): string {
    return `Web3TransactionSender { cluster: '${this.cluster}', payer: '${this.payer.toBase58()}' }`;
  }

  async send(instructions: TransactionInstruction[], opts: SendOptions = {}): Promise<SentTransaction> {
    const p = await this.prepare(instructions, opts);
    await p.submit();
    return { signature: p.signature, lastValidBlockHeight: p.lastValidBlockHeight };
  }

  async prepare(instructions: TransactionInstruction[], opts: SendOptions = {}): Promise<PreparedTransaction> {
    const ixs: TransactionInstruction[] = [];
    if (opts.computeUnitLimit) ixs.push(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnitLimit }));
    if (opts.computeUnitPriceMicroLamports) {
      ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: opts.computeUnitPriceMicroLamports }));
    }
    ixs.push(...instructions);
    let blockhash: { blockhash: string; lastValidBlockHeight: number };
    try {
      blockhash = await this.#connection.getLatestBlockhash(this.#commitment);
    } catch (e) {
      throw new ChainUnavailableError(`getLatestBlockhash failed: ${errorMessage(e)}`, { cause: e });
    }
    const msg = new TransactionMessage({ payerKey: this.payer, recentBlockhash: blockhash.blockhash, instructions: ixs }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([this.#payerKeypair, ...(opts.signers ?? [])]);
    const sigBytes = tx.signatures[0];
    if (!sigBytes) throw new ChainUnavailableError('transaction has no signature after signing');
    const signature = bs58.encode(sigBytes);
    const bytes = tx.serialize();
    const skipPreflight = opts.skipPreflight ?? false;
    return {
      signature,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
      submit: async () => {
        const got = await this.submitRaw(bytes, skipPreflight);
        if (got !== signature) throw new ChainUnavailableError(`RPC returned signature ${got}, expected ${signature}`);
      },
    };
  }

  async sendVersioned(tx: VersionedTransaction, signers: Keypair[] = []): Promise<SentTransaction> {
    tx.sign([this.#payerKeypair, ...signers]);
    // The blockhash in a foreign transaction is theirs; bound its validity with the current height + ~150 blocks.
    let lastValidBlockHeight: number;
    try {
      lastValidBlockHeight = (await this.#connection.getBlockHeight(this.#commitment)) + 150;
    } catch (e) {
      throw new ChainUnavailableError(`getBlockHeight failed: ${errorMessage(e)}`, { cause: e });
    }
    const signature = await this.submitRaw(tx.serialize(), false);
    return { signature, lastValidBlockHeight };
  }

  private async submitRaw(bytes: Uint8Array, skipPreflight: boolean): Promise<string> {
    try {
      return await this.#connection.sendRawTransaction(bytes, { skipPreflight, maxRetries: 3 });
    } catch (e) {
      const msg = errorMessage(e);
      if (isTransient(e)) throw new TransientChainError(`sendRawTransaction: ${msg}`, { cause: e });
      throw new ChainUnavailableError(`sendRawTransaction failed: ${msg}`, { cause: e });
    }
  }

  async status(signature: string, lastValidBlockHeight: number): Promise<TxStatus> {
    let res;
    try {
      res = await this.#connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    } catch (e) {
      throw new TransientChainError(`getSignatureStatuses: ${errorMessage(e)}`, { cause: e });
    }
    const s = res.value[0];
    if (s) {
      if (s.err) return 'failed';
      if (s.confirmationStatus === 'finalized') return 'finalized';
      if (s.confirmationStatus === 'confirmed') return 'confirmed';
      return 'pending';
    }
    let height: number;
    try {
      height = await this.#connection.getBlockHeight(this.#commitment);
    } catch (e) {
      throw new TransientChainError(`getBlockHeight: ${errorMessage(e)}`, { cause: e });
    }
    return height > lastValidBlockHeight ? 'expired' : 'pending';
  }

  async confirm(signature: string, lastValidBlockHeight: number): Promise<TxStatus> {
    const start = Date.now();
    for (;;) {
      const s = await this.status(signature, lastValidBlockHeight);
      if (s !== 'pending') return s;
      if (Date.now() - start > this.#maxWaitMs) throw new TransientChainError(`confirmation of ${signature} timed out`);
      await new Promise((r) => setTimeout(r, this.#pollMs));
    }
  }
}

/**
 * Send with the signature journalled BEFORE submission when the sender can
 * prepare, otherwise right after `send()` returns (before confirmation).
 * `onSent` must persist the record; it is awaited before the submit.
 */
export async function sendTracked(
  sender: TransactionSender,
  instructions: TransactionInstruction[],
  opts: SendOptions,
  onSent: (sent: SentTransaction) => Promise<void> | void,
): Promise<SentTransaction> {
  if (sender.prepare) {
    const p = await sender.prepare(instructions, opts);
    const sent = { signature: p.signature, lastValidBlockHeight: p.lastValidBlockHeight };
    await onSent(sent);
    await p.submit();
    return sent;
  }
  const sent = await sender.send(instructions, opts);
  await onSent(sent);
  return sent;
}

/** Decide a journalled signature: wait while pending; never guess. */
export async function settle(sender: TransactionSender, signature: string, lastValidBlockHeight: number): Promise<Exclude<TxStatus, 'pending'>> {
  let s = await sender.status(signature, lastValidBlockHeight);
  if (s === 'pending') s = await sender.confirm(signature, lastValidBlockHeight);
  if (s === 'pending') throw new TransientChainError(`transaction ${signature} is still pending`);
  return s;
}

export function createConnection(rpcUrl: string, commitment: Commitment = 'confirmed'): Connection {
  return new Connection(rpcUrl, { commitment });
}

/** Read-only chain queries the compositions need. Real values only. */
export interface ChainReader {
  getTokenSupply(mint: PublicKey): Promise<{ amount: bigint; decimals: number }>;
  getTokenBalance(owner: PublicKey, mint: PublicKey): Promise<bigint>;
  getSlot(): Promise<number>;
  getBalanceLamports(account: PublicKey): Promise<bigint>;
}

export class Web3ChainReader implements ChainReader {
  readonly #connection: Connection;
  readonly #commitment: Commitment;
  constructor(connection: Connection, commitment: Commitment = 'confirmed') {
    this.#connection = connection;
    this.#commitment = commitment;
  }
  get connection(): Connection {
    return this.#connection;
  }
  toJSON(): { kind: string } {
    return { kind: 'Web3ChainReader' };
  }
  [inspect.custom](): string {
    return 'Web3ChainReader {}';
  }
  async getTokenSupply(mint: PublicKey): Promise<{ amount: bigint; decimals: number }> {
    try {
      const r = await this.#connection.getTokenSupply(mint, this.#commitment);
      return { amount: BigInt(r.value.amount), decimals: r.value.decimals };
    } catch (e) {
      throw new ChainUnavailableError(`getTokenSupply(${mint.toBase58()}): ${errorMessage(e)}`, { cause: e });
    }
  }
  async getTokenBalance(owner: PublicKey, mint: PublicKey): Promise<bigint> {
    try {
      const r = await this.#connection.getParsedTokenAccountsByOwner(owner, { mint }, this.#commitment);
      let total = 0n;
      for (const a of r.value) {
        const info = (a.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }).parsed?.info?.tokenAmount?.amount;
        if (info) total += BigInt(info);
      }
      return total;
    } catch (e) {
      throw new ChainUnavailableError(`getParsedTokenAccountsByOwner: ${errorMessage(e)}`, { cause: e });
    }
  }
  async getSlot(): Promise<number> {
    try {
      return await this.#connection.getSlot(this.#commitment);
    } catch (e) {
      throw new ChainUnavailableError(`getSlot: ${errorMessage(e)}`, { cause: e });
    }
  }
  async getBalanceLamports(account: PublicKey): Promise<bigint> {
    try {
      return BigInt(await this.#connection.getBalance(account, this.#commitment));
    } catch (e) {
      throw new ChainUnavailableError(`getBalance: ${errorMessage(e)}`, { cause: e });
    }
  }
}
