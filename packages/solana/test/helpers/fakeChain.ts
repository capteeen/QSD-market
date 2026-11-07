/**
 * Test infrastructure for the sender boundary: an in-memory SPL ledger that
 * executes the REAL instructions the package builds (Token program transfer /
 * mintTo / burn / initializeMint2, ATA create, Memo) and fulfils
 * TransactionSender + TransferSender + ChainReader with fault injection.
 * It is not fake chain data in the product; it exists so crash-resume can be
 * exercised deterministically without an RPC.
 */
import { Keypair, PublicKey, SystemProgram, ComputeBudgetProgram, type TransactionInstruction, type VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { randomBytes } from '@noble/hashes/utils.js';
import bs58 from 'bs58';
import {
  MEMO_PROGRAM_ID,
  TransientChainError,
  buildTransferInstructions,
  type ChainReader,
  type PreparedTransfer,
  type SendOptions,
  type SentTransaction,
  type TransactionSender,
  type Transfer,
  type TransferSender,
  type TxStatus,
} from '../../src/index.js';

export type SubmitBehaviour = 'ok' | 'transient' | 'applied-then-throw' | 'expire' | 'fail';

interface TokenAccount {
  owner: string;
  mint: string;
  amount: bigint;
}

export class FakeChain implements TransactionSender, TransferSender, ChainReader {
  readonly cluster: string;
  readonly payer: PublicKey;
  readonly accounts = new Map<string, TokenAccount>();
  readonly mints = new Map<string, { supply: bigint; decimals: number }>();
  readonly txs = new Map<string, { status: TxStatus; memos: string[]; transfers: Transfer[]; mint?: string }>();
  readonly memos: { signature: string; memo: string }[] = [];
  readonly order: string[] = [];
  blockHeight = 1000;
  slot = 5000;
  lamports = 10_000_000_000n;
  /** Consumed one per TransferSender submit (airdrop batches); default 'ok'. */
  submitBehaviours: SubmitBehaviour[] = [];
  /** Consumed one per TransactionSender send (burns, memos, launches); default 'ok'. */
  sendBehaviours: SubmitBehaviour[] = [];
  batchSize = 4;
  sendCalls = 0;
  prepareCalls = 0;

  constructor(readonly payerKeypair: Keypair, cluster = 'devnet') {
    this.payer = payerKeypair.publicKey;
    this.cluster = cluster;
  }

  private sig(): string {
    return bs58.encode(randomBytes(64));
  }

  createMint(mint: PublicKey, decimals: number): void {
    this.mints.set(mint.toBase58(), { supply: 0n, decimals });
  }

  mintTo(mint: PublicKey, owner: PublicKey, amount: bigint): void {
    const m = this.mints.get(mint.toBase58());
    if (!m) throw new Error('fake: unknown mint');
    const ata = getAssociatedTokenAddressSync(mint, owner, true).toBase58();
    const acc = this.accounts.get(ata) ?? { owner: owner.toBase58(), mint: mint.toBase58(), amount: 0n };
    acc.amount += amount;
    this.accounts.set(ata, acc);
    m.supply += amount;
  }

  balanceOf(owner: PublicKey | string, mint: PublicKey | string): bigint {
    const o = typeof owner === 'string' ? owner : owner.toBase58();
    const mi = typeof mint === 'string' ? mint : mint.toBase58();
    let t = 0n;
    for (const a of this.accounts.values()) if (a.owner === o && a.mint === mi) t += a.amount;
    return t;
  }

  /** Execute instructions atomically against the ledger. */
  private apply(ixs: TransactionInstruction[], signature: string): string[] {
    const snapshotAccounts = new Map([...this.accounts].map(([k, v]) => [k, { ...v }]));
    const snapshotMints = new Map([...this.mints].map(([k, v]) => [k, { ...v }]));
    const memos: string[] = [];
    try {
      for (const ix of ixs) {
        const pid = ix.programId.toBase58();
        const keys = ix.keys.map((k) => k.pubkey.toBase58());
        const data = Buffer.from(ix.data);
        if (pid === MEMO_PROGRAM_ID.toBase58()) {
          const memo = data.toString('utf8');
          memos.push(memo);
          this.memos.push({ signature, memo });
        } else if (pid === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()) {
          const [, ata, owner, mint] = keys as [string, string, string, string];
          if (!this.mints.has(mint)) throw new Error(`fake: ATA for unknown mint ${mint}`);
          if (!this.accounts.has(ata)) this.accounts.set(ata, { owner, mint, amount: 0n });
        } else if (pid === TOKEN_PROGRAM_ID.toBase58()) {
          const op = data[0];
          const amount = data.length >= 9 ? data.readBigUInt64LE(1) : 0n;
          if (op === 20) {
            const mint = keys[0] as string;
            this.mints.set(mint, { supply: 0n, decimals: data[1] as number });
          } else if (op === 7) {
            const [mint, dest] = keys as [string, string];
            const m = this.mints.get(mint);
            const d = this.accounts.get(dest);
            if (!m || !d) throw new Error('fake: mintTo to unknown mint/account');
            d.amount += amount;
            m.supply += amount;
          } else if (op === 3) {
            const [src, dst] = keys as [string, string];
            const s = this.accounts.get(src);
            const d = this.accounts.get(dst);
            if (!s || !d) throw new Error('fake: transfer with unknown account');
            if (s.amount < amount) throw new Error(`fake: insufficient funds (${s.amount} < ${amount})`);
            s.amount -= amount;
            d.amount += amount;
          } else if (op === 8) {
            const [acc, mint] = keys as [string, string];
            const a = this.accounts.get(acc);
            const m = this.mints.get(mint);
            if (!a || !m) throw new Error('fake: burn on unknown account');
            if (a.amount < amount) throw new Error('fake: burn exceeds balance');
            a.amount -= amount;
            m.supply -= amount;
          } else {
            throw new Error(`fake: unsupported token op ${op}`);
          }
        } else if (pid === SystemProgram.programId.toBase58() || pid === ComputeBudgetProgram.programId.toBase58()) {
          // createAccount / budget: nothing to track
        } else {
          throw new Error(`fake: unsupported program ${pid}`);
        }
      }
    } catch (e) {
      this.accounts.clear();
      for (const [k, v] of snapshotAccounts) this.accounts.set(k, v);
      this.mints.clear();
      for (const [k, v] of snapshotMints) this.mints.set(k, v);
      throw e;
    }
    return memos;
  }

  // ---- TransactionSender
  async send(instructions: TransactionInstruction[], _opts: SendOptions = {}): Promise<SentTransaction> {
    this.sendCalls++;
    const signature = this.sig();
    const b = this.sendBehaviours.shift() ?? 'ok';
    if (b === 'transient') throw new TransientChainError('fake: rpc 503');
    if (b === 'expire') {
      // dropped by the network: never lands, its blockhash runs out
      this.blockHeight++;
      return { signature, lastValidBlockHeight: this.blockHeight + 150 };
    }
    let memos: string[] = [];
    let status: TxStatus = 'confirmed';
    if (b === 'fail') status = 'failed';
    else memos = this.apply(instructions, signature);
    this.txs.set(signature, { status, memos, transfers: [] });
    this.order.push(signature);
    this.blockHeight++;
    this.slot++;
    return { signature, lastValidBlockHeight: this.blockHeight + 150 };
  }

  async sendVersioned(_tx: VersionedTransaction): Promise<SentTransaction> {
    throw new TransientChainError('fake: sendVersioned not supported in the fake chain');
  }

  async status(signature: string, lastValidBlockHeight: number): Promise<TxStatus> {
    const t = this.txs.get(signature);
    if (t) return t.status;
    return this.blockHeight > lastValidBlockHeight ? 'expired' : 'pending';
  }

  async confirm(signature: string, lastValidBlockHeight: number): Promise<TxStatus> {
    const s = await this.status(signature, lastValidBlockHeight);
    if (s === 'pending') {
      // Nothing will land a tx the fake never saw: advance past its validity.
      this.blockHeight = lastValidBlockHeight + 1;
      return 'expired';
    }
    return s;
  }

  // ---- TransferSender
  async maxTransfersPerTx(): Promise<number> {
    return this.batchSize;
  }

  async prepareTransfers(mint: string, transfers: readonly Transfer[]): Promise<PreparedTransfer> {
    this.prepareCalls++;
    const ixs = buildTransferInstructions(this.payer, new PublicKey(mint), transfers);
    const signature = this.sig();
    const lastValidBlockHeight = this.blockHeight + 150;
    const list = transfers.map((t) => ({ ...t }));
    return {
      signature,
      lastValidBlockHeight,
      submit: async () => {
        const b = this.submitBehaviours.shift() ?? 'ok';
        if (b === 'transient') throw new TransientChainError('fake: rpc 503 before submit');
        if (b === 'expire') {
          this.blockHeight = lastValidBlockHeight + 1;
          return;
        }
        if (b === 'fail') {
          this.txs.set(signature, { status: 'failed', memos: [], transfers: [], mint });
          this.order.push(signature);
          return;
        }
        this.apply(ixs, signature);
        this.txs.set(signature, { status: 'confirmed', memos: [], transfers: list, mint });
        this.order.push(signature);
        this.blockHeight++;
        this.slot++;
        if (b === 'applied-then-throw') throw new TransientChainError('fake: connection reset after submit');
      },
    };
  }

  // ---- ChainReader
  async getTokenSupply(mint: PublicKey): Promise<{ amount: bigint; decimals: number }> {
    const m = this.mints.get(mint.toBase58());
    if (!m) throw new Error('fake: unknown mint');
    return { amount: m.supply, decimals: m.decimals };
  }
  async getTokenBalance(owner: PublicKey, mint: PublicKey): Promise<bigint> {
    return this.balanceOf(owner, mint);
  }
  async getSlot(): Promise<number> {
    return this.slot;
  }
  async getBalanceLamports(): Promise<bigint> {
    return this.lamports;
  }

  /** Σ units confirmed on-chain to each wallet for a mint. */
  receivedByWallet(mint: string): Map<string, bigint> {
    const m = new Map<string, bigint>();
    for (const t of this.txs.values()) {
      if (t.status !== 'confirmed' || t.mint !== mint) continue;
      for (const tr of t.transfers) m.set(tr.wallet, (m.get(tr.wallet) ?? 0n) + tr.units);
    }
    return m;
  }
}

/** A snapshot-source over the fake ledger (what DAS/gPA would return). */
export function fakeTokenAccountSource(chain: FakeChain) {
  return {
    name: 'helius-das' as const,
    async listByMint(mint: string) {
      const rows = [...chain.accounts.entries()].filter(([, a]) => a.mint === mint).map(([address, a]) => ({ address, owner: a.owner, amount: a.amount, frozen: false }));
      return { rows, observedSlot: chain.slot, source: 'helius-das' as const };
    },
  };
}
