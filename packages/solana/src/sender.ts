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

export interface TransactionSender {
  readonly cluster: string;
  readonly payer: PublicKey;
  /** Build, sign (payer + signers) and submit a transaction with these instructions. */
  send(instructions: TransactionInstruction[], opts?: SendOptions): Promise<SentTransaction>;
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
  private readonly commitment: Commitment;
  private readonly pollMs: number;
  private readonly maxWaitMs: number;
  constructor(
    readonly connection: Connection,
    private readonly payerKeypair: Keypair,
    readonly cluster: string,
    opts: Web3SenderOptions = {},
  ) {
    this.payer = payerKeypair.publicKey;
    this.commitment = opts.commitment ?? 'confirmed';
    this.pollMs = opts.pollMs ?? 1500;
    this.maxWaitMs = opts.maxWaitMs ?? 120_000;
  }

  async send(instructions: TransactionInstruction[], opts: SendOptions = {}): Promise<SentTransaction> {
    const ixs: TransactionInstruction[] = [];
    if (opts.computeUnitLimit) ixs.push(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnitLimit }));
    if (opts.computeUnitPriceMicroLamports) {
      ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: opts.computeUnitPriceMicroLamports }));
    }
    ixs.push(...instructions);
    let blockhash: { blockhash: string; lastValidBlockHeight: number };
    try {
      blockhash = await this.connection.getLatestBlockhash(this.commitment);
    } catch (e) {
      throw new ChainUnavailableError(`getLatestBlockhash failed: ${errorMessage(e)}`, { cause: e });
    }
    const msg = new TransactionMessage({ payerKey: this.payer, recentBlockhash: blockhash.blockhash, instructions: ixs }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([this.payerKeypair, ...(opts.signers ?? [])]);
    const signature = await this.submit(tx, opts.skipPreflight ?? false);
    return { signature, lastValidBlockHeight: blockhash.lastValidBlockHeight };
  }

  async sendVersioned(tx: VersionedTransaction, signers: Keypair[] = []): Promise<SentTransaction> {
    tx.sign([this.payerKeypair, ...signers]);
    // The blockhash in a foreign transaction is theirs; bound its validity with the current height + ~150 blocks.
    let lastValidBlockHeight: number;
    try {
      lastValidBlockHeight = (await this.connection.getBlockHeight(this.commitment)) + 150;
    } catch (e) {
      throw new ChainUnavailableError(`getBlockHeight failed: ${errorMessage(e)}`, { cause: e });
    }
    const signature = await this.submit(tx, false);
    return { signature, lastValidBlockHeight };
  }

  private async submit(tx: VersionedTransaction, skipPreflight: boolean): Promise<string> {
    try {
      return await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight, maxRetries: 3 });
    } catch (e) {
      const msg = errorMessage(e);
      if (isTransient(e)) throw new TransientChainError(`sendRawTransaction: ${msg}`, { cause: e });
      throw new ChainUnavailableError(`sendRawTransaction failed: ${msg}`, { cause: e });
    }
  }

  async status(signature: string, lastValidBlockHeight: number): Promise<TxStatus> {
    let res;
    try {
      res = await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
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
      height = await this.connection.getBlockHeight(this.commitment);
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
      if (Date.now() - start > this.maxWaitMs) throw new TransientChainError(`confirmation of ${signature} timed out`);
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
  }
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
  constructor(readonly connection: Connection, private readonly commitment: Commitment = 'confirmed') {}
  async getTokenSupply(mint: PublicKey): Promise<{ amount: bigint; decimals: number }> {
    try {
      const r = await this.connection.getTokenSupply(mint, this.commitment);
      return { amount: BigInt(r.value.amount), decimals: r.value.decimals };
    } catch (e) {
      throw new ChainUnavailableError(`getTokenSupply(${mint.toBase58()}): ${errorMessage(e)}`, { cause: e });
    }
  }
  async getTokenBalance(owner: PublicKey, mint: PublicKey): Promise<bigint> {
    try {
      const r = await this.connection.getParsedTokenAccountsByOwner(owner, { mint }, this.commitment);
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
      return await this.connection.getSlot(this.commitment);
    } catch (e) {
      throw new ChainUnavailableError(`getSlot: ${errorMessage(e)}`, { cause: e });
    }
  }
  async getBalanceLamports(account: PublicKey): Promise<bigint> {
    try {
      return BigInt(await this.connection.getBalance(account, this.commitment));
    } catch (e) {
      throw new ChainUnavailableError(`getBalance: ${errorMessage(e)}`, { cause: e });
    }
  }
}
