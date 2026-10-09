/**
 * Agent H's OWN in-memory SPL ledger and fault-injecting sender, written
 * without reference to the package's test helpers. It executes the real
 * instructions the package builds (Token transfer / mintTo / burn /
 * initializeMint2, ATA create, Memo) and fulfils the package's
 * TransactionSender / TransferSender / ChainReader / TokenAccountSource
 * boundaries. It is test infrastructure for crash-resume, not chain data.
 */
import { Keypair, PublicKey, SystemProgram, ComputeBudgetProgram, type TransactionInstruction, type VersionedTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import {
  MEMO_PROGRAM_ID,
  TransientChainError,
  buildTransferInstructions,
  type ChainReader,
  type PreparedTransfer,
  type SendOptions,
  type SentTransaction,
  type TokenAccountPage,
  type TokenAccountSource,
  type TransactionSender,
  type Transfer,
  type TransferSender,
  type TxStatus,
} from '@qsd/solana';

/** Simulates the process dying at this point. Tests catch it and "restart". */
export class Crash extends Error {
  override readonly name = 'Crash';
  constructor(where: string) {
    super(`simulated crash: ${where}`);
  }
}

/**
 * What happens to the next transaction that goes through the boundary:
 *  ok                        lands immediately
 *  landed-then-transient     accepted and IN FLIGHT (lands two status queries later), but submit() throws
 *                            TransientChainError (RPC timeout after acceptance) — the realistic timeout case
 *  landed-then-crash         lands, then submit() throws a non-transient error (the package must check status)
 *  reject-transient          not accepted; submit() throws TransientChainError
 *  dropped                   accepted but never lands: status pending until the blockhash expires
 *  fail                      lands with a program error
 *  confirm-crash             lands; confirm() throws Crash (process dies while waiting)
 *  confirm-transient-later   accepted and in flight; confirm() throws TransientChainError without querying; lands on the next status query
 */
export type Fault = 'ok' | 'landed-then-transient' | 'landed-then-crash' | 'reject-transient' | 'dropped' | 'fail' | 'confirm-crash' | 'confirm-transient-later';

interface TokenAccount {
  owner: string;
  mint: string;
  amount: bigint;
}
interface Tx {
  state: 'pending' | 'confirmed' | 'failed';
  lastValidBlockHeight: number;
  ixs: TransactionInstruction[];
  /** In flight: lands after this many further status queries (time passing). */
  landsAfterQueries?: number;
  confirmFault?: 'crash' | 'transient';
  memos: string[];
}

export class Ledger implements TransactionSender, TransferSender, ChainReader, TokenAccountSource {
  readonly name = 'getProgramAccounts' as const;
  readonly cluster: string;
  readonly payer: PublicKey;
  readonly accounts = new Map<string, TokenAccount>();
  readonly mints = new Map<string, { supply: bigint; decimals: number; initCount: number }>();
  readonly txs = new Map<string, Tx>();
  readonly memos: { signature: string; memo: string }[] = [];
  /** Every transfer that landed: (mint, to-owner, units), in order. */
  readonly landedTransfers: { mint: string; to: string; units: bigint; signature: string }[] = [];
  readonly landedBurns: { mint: string; units: bigint; signature: string }[] = [];
  blockHeight = 10_000;
  slot = 50_000;
  batchSize = 3;
  /** Faults consumed in order by TransferSender submits (airdrop batches). */
  transferFaults: Fault[] = [];
  /** Faults consumed in order by TransactionSender sends (burns, memos, launches). */
  sendFaults: Fault[] = [];
  prepareCalls = 0;
  /** TransferSender submits (airdrop batches) and TransactionSender sends, counted separately. */
  transferSubmits = 0;
  sendCalls = 0;
  private blockhashCounter = 0;

  constructor(readonly payerKeypair: Keypair, cluster = 'devnet') {
    this.payer = payerKeypair.publicKey;
    this.cluster = cluster;
  }

  // ------------------------------------------------------------ setup helpers
  createMint(mint: PublicKey, decimals: number): void {
    this.mints.set(mint.toBase58(), { supply: 0n, decimals, initCount: 1 });
  }
  mintTo(mint: PublicKey, owner: PublicKey, amount: bigint): void {
    const m = this.mints.get(mint.toBase58());
    if (!m) throw new Error('ledger: unknown mint');
    const ata = getAssociatedTokenAddressSync(mint, owner, true).toBase58();
    const acc = this.accounts.get(ata) ?? { owner: owner.toBase58(), mint: mint.toBase58(), amount: 0n };
    acc.amount += amount;
    this.accounts.set(ata, acc);
    m.supply += amount;
  }
  balanceOf(owner: string | PublicKey, mint: string | PublicKey): bigint {
    const o = typeof owner === 'string' ? owner : owner.toBase58();
    const mi = typeof mint === 'string' ? mint : mint.toBase58();
    let t = 0n;
    for (const a of this.accounts.values()) if (a.owner === o && a.mint === mi) t += a.amount;
    return t;
  }
  burnedOf(mint: string | PublicKey): bigint {
    const mi = typeof mint === 'string' ? mint : mint.toBase58();
    return this.landedBurns.filter((b) => b.mint === mi).reduce((a, b) => a + b.units, 0n);
  }
  transfersTo(owner: string, mint: string): { count: number; units: bigint } {
    const xs = this.landedTransfers.filter((t) => t.to === owner && t.mint === mint);
    return { count: xs.length, units: xs.reduce((a, t) => a + t.units, 0n) };
  }
  advanceBlocks(n: number): void {
    this.blockHeight += n;
    this.slot += n;
  }

  // ------------------------------------------------------------ execution
  private apply(ixs: TransactionInstruction[], signature: string): void {
    const accSnap = new Map([...this.accounts].map(([k, v]) => [k, { ...v }]));
    const mintSnap = new Map([...this.mints].map(([k, v]) => [k, { ...v }]));
    const transfers: typeof this.landedTransfers = [];
    const burns: typeof this.landedBurns = [];
    const memos: string[] = [];
    try {
      for (const ix of ixs) {
        const pid = ix.programId.toBase58();
        const keys = ix.keys.map((k) => k.pubkey.toBase58());
        const data = Buffer.from(ix.data);
        if (pid === MEMO_PROGRAM_ID.toBase58()) {
          memos.push(data.toString('utf8'));
        } else if (pid === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) {
          const [, ata, owner, mint] = keys as [string, string, string, string];
          if (!this.mints.has(mint)) throw new Error(`ledger: ATA for unknown mint ${mint}`);
          if (!this.accounts.has(ata)) this.accounts.set(ata, { owner, mint, amount: 0n });
        } else if (pid === TOKEN_PROGRAM_ID.toBase58()) {
          const op = data[0];
          const amount = data.length >= 9 ? data.readBigUInt64LE(1) : 0n;
          if (op === 20) {
            const mint = keys[0]!;
            const existing = this.mints.get(mint);
            if (existing) throw new Error(`ledger: mint ${mint} already initialized`);
            this.mints.set(mint, { supply: 0n, decimals: data[1]!, initCount: 1 });
          } else if (op === 7) {
            const [mint, dest] = keys as [string, string];
            const m = this.mints.get(mint);
            const d = this.accounts.get(dest);
            if (!m || !d) throw new Error('ledger: mintTo unknown mint/account');
            d.amount += amount;
            m.supply += amount;
          } else if (op === 3) {
            const [src, dst] = keys as [string, string];
            const s = this.accounts.get(src);
            const d = this.accounts.get(dst);
            if (!s || !d) throw new Error('ledger: transfer with unknown account');
            if (s.amount < amount) throw new Error(`ledger: insufficient funds ${s.amount} < ${amount}`);
            s.amount -= amount;
            d.amount += amount;
            transfers.push({ mint: d.mint, to: d.owner, units: amount, signature });
          } else if (op === 8) {
            const [acc, mint] = keys as [string, string];
            const a = this.accounts.get(acc);
            const m = this.mints.get(mint);
            if (!a || !m) throw new Error('ledger: burn on unknown account');
            if (a.amount < amount) throw new Error('ledger: burn exceeds balance');
            a.amount -= amount;
            m.supply -= amount;
            burns.push({ mint, units: amount, signature });
          } else throw new Error(`ledger: unsupported token op ${op}`);
        } else if (pid === SystemProgram.programId.toBase58() || pid === ComputeBudgetProgram.programId.toBase58()) {
          // createAccount / compute budget: nothing to track
        } else throw new Error(`ledger: unsupported program ${pid}`);
      }
    } catch (e) {
      this.accounts.clear();
      for (const [k, v] of accSnap) this.accounts.set(k, v);
      this.mints.clear();
      for (const [k, v] of mintSnap) this.mints.set(k, v);
      throw e;
    }
    this.landedTransfers.push(...transfers);
    this.landedBurns.push(...burns);
    for (const m of memos) this.memos.push({ signature, memo: m });
  }

  private newBlockhash(): { blockhash: string; lastValidBlockHeight: number } {
    this.blockhashCounter++;
    return { blockhash: `bh-${this.blockHeight}-${this.blockhashCounter}`, lastValidBlockHeight: this.blockHeight + 150 };
  }

  /** A Solana signature is a function of the signed bytes: here sha256(blockhash ‖ instructions). */
  private signatureFor(blockhash: string, ixs: TransactionInstruction[]): string {
    const h = createHash('sha256').update(blockhash);
    for (const ix of ixs) {
      h.update(ix.programId.toBytes());
      for (const k of ix.keys) h.update(k.pubkey.toBytes());
      h.update(ix.data);
    }
    return bs58.encode(new Uint8Array(h.digest()));
  }

  /** Run `fault` for a transaction that is about to be submitted. */
  private submitWithFault(sig: string, tx: Tx, fault: Fault): void {
    this.txs.set(sig, tx);
    switch (fault) {
      case 'ok':
        this.apply(tx.ixs, sig);
        tx.state = 'confirmed';
        return;
      case 'landed-then-transient':
        tx.landsAfterQueries = 2;
        throw new TransientChainError('sendRawTransaction: fetch failed (timeout after the RPC accepted the transaction)');
      case 'landed-then-crash':
        this.apply(tx.ixs, sig);
        tx.state = 'confirmed';
        throw new Crash('after submit, before anything was journalled');
      case 'reject-transient':
        this.txs.delete(sig);
        throw new TransientChainError('sendRawTransaction: 429 rate limit');
      case 'dropped':
        return; // pending forever
      case 'fail':
        tx.state = 'failed';
        return;
      case 'confirm-crash':
        this.apply(tx.ixs, sig);
        tx.state = 'confirmed';
        tx.confirmFault = 'crash';
        return;
      case 'confirm-transient-later':
        tx.landsAfterQueries = 1;
        tx.confirmFault = 'transient';
        return;
    }
  }

  // ------------------------------------------------------------ TransactionSender
  async send(instructions: TransactionInstruction[], _opts?: SendOptions): Promise<SentTransaction> {
    this.sendCalls++;
    const bh = this.newBlockhash();
    const sig = this.signatureFor(bh.blockhash, instructions);
    const tx: Tx = { state: 'pending', lastValidBlockHeight: bh.lastValidBlockHeight, ixs: instructions, memos: [] };
    const fault = this.sendFaults.shift() ?? 'ok';
    this.submitWithFault(sig, tx, fault);
    return { signature: sig, lastValidBlockHeight: bh.lastValidBlockHeight };
  }
  async sendVersioned(_tx: VersionedTransaction): Promise<SentTransaction> {
    throw new Error('ledger: sendVersioned is not used on devnet');
  }
  /** Time passes with every query: every in-flight transaction gets one step closer to landing. */
  private tick(): void {
    for (const [sig, tx] of this.txs) {
      if (tx.landsAfterQueries === undefined) continue;
      tx.landsAfterQueries--;
      if (tx.landsAfterQueries <= 0) {
        delete tx.landsAfterQueries;
        this.apply(tx.ixs, sig);
        tx.state = 'confirmed';
      }
    }
  }
  async status(signature: string, lastValidBlockHeight: number): Promise<TxStatus> {
    this.tick();
    const tx = this.txs.get(signature);
    if (tx?.state === 'confirmed') return 'confirmed';
    if (tx?.state === 'failed') return 'failed';
    return this.blockHeight > lastValidBlockHeight ? 'expired' : 'pending';
  }
  async confirm(signature: string, lastValidBlockHeight: number): Promise<TxStatus> {
    const tx = this.txs.get(signature);
    if (tx?.confirmFault === 'crash') {
      delete tx.confirmFault;
      throw new Crash('while waiting for confirmation (the transaction had landed)');
    }
    if (tx?.confirmFault === 'transient') {
      delete tx.confirmFault;
      throw new TransientChainError(`confirmation of ${signature} timed out`);
    }
    const s = await this.status(signature, lastValidBlockHeight);
    if (s !== 'pending') return s;
    // Nothing will land: the real sender polls until the blockhash expires.
    this.blockHeight = Math.max(this.blockHeight, lastValidBlockHeight + 1);
    return 'expired';
  }

  // ------------------------------------------------------------ TransferSender
  async maxTransfersPerTx(): Promise<number> {
    return this.batchSize;
  }
  async prepareTransfers(mint: string, transfers: readonly Transfer[]): Promise<PreparedTransfer> {
    this.prepareCalls++;
    const ixs = buildTransferInstructions(this.payer, new PublicKey(mint), transfers);
    const bh = this.newBlockhash();
    const sig = this.signatureFor(bh.blockhash, ixs);
    const tx: Tx = { state: 'pending', lastValidBlockHeight: bh.lastValidBlockHeight, ixs, memos: [] };
    const self = this;
    return {
      signature: sig,
      lastValidBlockHeight: bh.lastValidBlockHeight,
      async submit() {
        self.transferSubmits++;
        const fault = self.transferFaults.shift() ?? 'ok';
        self.submitWithFault(sig, tx, fault);
      },
    };
  }

  // ------------------------------------------------------------ ChainReader
  async getTokenSupply(mint: PublicKey): Promise<{ amount: bigint; decimals: number }> {
    const m = this.mints.get(mint.toBase58());
    if (!m) throw new Error('ledger: unknown mint');
    return { amount: m.supply, decimals: m.decimals };
  }
  async getTokenBalance(owner: PublicKey, mint: PublicKey): Promise<bigint> {
    return this.balanceOf(owner, mint);
  }
  async getSlot(): Promise<number> {
    return this.slot;
  }
  async getBalanceLamports(): Promise<bigint> {
    return 10n ** 12n;
  }

  // ------------------------------------------------------------ TokenAccountSource
  async listByMint(mint: string): Promise<TokenAccountPage> {
    const rows = [...this.accounts.entries()].filter(([, a]) => a.mint === mint).map(([address, a]) => ({ address, owner: a.owner, amount: a.amount, frozen: false }));
    return { rows, observedSlot: this.slot, source: this.name };
  }
}
