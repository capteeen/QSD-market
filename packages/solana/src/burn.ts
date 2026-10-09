/**
 * Hourly buy-and-burn: tally lamports received by the fee wallet since the
 * last run (journalled by signature), swap SOL → $QSD through Jupiter, burn
 * 100 % of what arrived, log every signature.
 *
 * Jupiter — confirmed 2026-10-09 at https://developers.jup.ag/docs/swap/v2/get-quote.md
 * (Swap V2; the docs mark Swap V1 `api.jup.ag/swap/v1/{quote,swap}` as
 * "no longer actively maintained and has been superseded by Swap V2"):
 *   GET  https://api.jup.ag/swap/v2/order?inputMint&outputMint&amount&taker&slippageBps   x-api-key: <JUPITER_API_KEY>
 *        → { requestId, transaction (base64 VersionedTransaction, present when `taker` set), outAmount, ... }
 *   The signed transaction is sent through our own RPC (Jupiter also offers POST /execute).
 * Throws ChainConfigError when $QSD's mint (`QSD_TOKEN_MINT`) is unset.
 */
import { PublicKey, VersionedTransaction, type Connection } from '@solana/web3.js';
import { createBurnInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ChainConfigError, ChainUnavailableError, TransientChainError, errorMessage } from './errors.js';
import type { JournalStore } from './journal.js';
import type { ChainObserver } from './observer.js';
import type { ChainReader, TransactionSender } from './sender.js';

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const JUPITER_DOCS_URL = 'https://developers.jup.ag/docs/swap/v2/get-quote.md';
export const JUPITER_CONFIRMED_ON = '2026-10-09';

type FetchLike = typeof fetch;

export interface JupiterOrderParams {
  inputMint: string;
  outputMint: string;
  /** Base units of the input (lamports for SOL). */
  amount: bigint;
  taker: string;
  slippageBps?: number;
}

export interface JupiterOrderRequest {
  url: string;
  headers: Record<string, string>;
}

/** Pure: the documented Swap V2 `/order` request. */
export function buildJupiterOrderRequest(apiUrl: string, p: JupiterOrderParams, apiKey?: string): JupiterOrderRequest {
  if (p.amount <= 0n) throw new ChainConfigError('swap amount must be positive');
  const u = new URL(`${apiUrl.replace(/\/+$/, '')}/swap/v2/order`);
  u.searchParams.set('inputMint', p.inputMint);
  u.searchParams.set('outputMint', p.outputMint);
  u.searchParams.set('amount', p.amount.toString());
  u.searchParams.set('taker', p.taker);
  if (p.slippageBps !== undefined) u.searchParams.set('slippageBps', String(p.slippageBps));
  const headers: Record<string, string> = { accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;
  return { url: u.toString(), headers };
}

export interface JupiterOrderResponse {
  requestId: string;
  transaction?: string;
  inAmount?: string;
  outAmount?: string;
  [k: string]: unknown;
}

export async function fetchJupiterOrder(req: JupiterOrderRequest, fetchImpl: FetchLike = fetch): Promise<JupiterOrderResponse> {
  let res: Response;
  try {
    res = await fetchImpl(req.url, { headers: req.headers });
  } catch (e) {
    throw new ChainUnavailableError(`Jupiter /order: ${errorMessage(e)}`, { cause: e });
  }
  if (res.status === 429 || res.status >= 500) throw new TransientChainError(`Jupiter /order returned HTTP ${res.status}`);
  if (!res.ok) throw new ChainUnavailableError(`Jupiter /order returned HTTP ${res.status}`);
  const json = (await res.json()) as JupiterOrderResponse;
  if (!json.transaction) throw new ChainUnavailableError('Jupiter /order returned no transaction (is `taker` set? is the route available?)');
  return json;
}

// ------------------------------------------------------------------ fee ledger

export interface FeeLedger {
  /** Signatures touching `wallet` newer than `untilSignature` (oldest first). */
  signaturesSince(wallet: string, untilSignature: string | undefined): Promise<string[]>;
  /** Lamports credited to `wallet` by each signature (post − pre, only positive). */
  creditedLamports(wallet: string, signatures: readonly string[]): Promise<Map<string, bigint>>;
}

export class Web3FeeLedger implements FeeLedger {
  constructor(private readonly connection: Connection) {}
  async signaturesSince(wallet: string, untilSignature: string | undefined): Promise<string[]> {
    const key = new PublicKey(wallet);
    const out: string[] = [];
    let before: string | undefined;
    try {
      for (let page = 0; page < 1000; page++) {
        const opts: { limit: number; until?: string; before?: string } = { limit: 1000 };
        if (untilSignature) opts.until = untilSignature;
        if (before) opts.before = before;
        const infos = await this.connection.getSignaturesForAddress(key, opts, 'confirmed');
        for (const i of infos) if (!i.err) out.push(i.signature);
        if (infos.length < 1000) break;
        before = infos[infos.length - 1]?.signature;
      }
    } catch (e) {
      throw new ChainUnavailableError(`getSignaturesForAddress: ${errorMessage(e)}`, { cause: e });
    }
    return out.reverse();
  }
  async creditedLamports(wallet: string, signatures: readonly string[]): Promise<Map<string, bigint>> {
    const m = new Map<string, bigint>();
    for (let i = 0; i < signatures.length; i += 100) {
      const chunk = signatures.slice(i, i + 100);
      let txs;
      try {
        txs = await this.connection.getTransactions(chunk, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
      } catch (e) {
        throw new ChainUnavailableError(`getTransactions: ${errorMessage(e)}`, { cause: e });
      }
      txs.forEach((tx, j) => {
        const sig = chunk[j] as string;
        if (!tx || !tx.meta) return;
        const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses ?? null }).staticAccountKeys;
        const idx = keys.findIndex((k) => k.toBase58() === wallet);
        if (idx < 0) return;
        const delta = BigInt(tx.meta.postBalances[idx] ?? 0) - BigInt(tx.meta.preBalances[idx] ?? 0);
        if (delta > 0n) m.set(sig, delta);
      });
    }
    return m;
  }
}

// ------------------------------------------------------------------ journal

export interface BurnRunRecord {
  startedAt: string;
  tallyFromSignature?: string;
  tallyToSignature?: string;
  lamports: string;
  swapSignature?: string;
  swapLastValidBlockHeight?: number;
  qsdUnits?: string;
  burnSignature?: string;
  completedAt?: string;
  error?: string;
}

export interface BurnJournalDoc {
  version: 1;
  feeWallet: string;
  qsdMint: string;
  /** Newest signature already tallied. */
  lastTalliedSignature?: string;
  runs: BurnRunRecord[];
}

export type BurnJournal = JournalStore<BurnJournalDoc>;

export interface BuyAndBurnArgs {
  feeWallet: string;
  qsdMint: string | undefined;
  /** The fee wallet keypair must be the sender's payer. */
  sender: TransactionSender;
  reader: ChainReader;
  ledger: FeeLedger;
  journal: BurnJournal;
  jupiterApiUrl: string;
  jupiterApiKey?: string;
  slippageBps?: number;
  /** Keep this many lamports for fees; never swap below it. */
  reserveLamports?: bigint;
  /** Do not swap less than this (dust guard). */
  minSwapLamports?: bigint;
  observer?: ChainObserver;
  fetchImpl?: FetchLike;
  log?: (line: string) => void;
}

export interface BuyAndBurnReport {
  lamportsTallied: bigint;
  swapped: boolean;
  swapSignature?: string;
  burnSignature?: string;
  qsdUnitsBurned: bigint;
}

/**
 * One hourly run. Steps are journalled so an interrupted run resumes: a run
 * with a swap signature but no burn re-checks the swap and burns; a run with
 * neither re-tallies from the last tallied signature.
 */
export async function hourlyBuyAndBurn(a: BuyAndBurnArgs): Promise<BuyAndBurnReport> {
  if (!a.qsdMint) throw new ChainConfigError('QSD_TOKEN_MINT is unset: cannot buy-and-burn without the $QSD mint');
  const qsdMint = new PublicKey(a.qsdMint);
  const feeWallet = new PublicKey(a.feeWallet);
  if (!feeWallet.equals(a.sender.payer)) throw new ChainConfigError('the fee wallet must be the sender payer');
  const log = a.log ?? (() => undefined);
  const doc: BurnJournalDoc = (await a.journal.load()) ?? { version: 1, feeWallet: a.feeWallet, qsdMint: a.qsdMint, runs: [] };
  if (doc.feeWallet !== a.feeWallet || doc.qsdMint !== a.qsdMint) throw new ChainConfigError('burn journal belongs to a different fee wallet or mint');
  const save = () => a.journal.save(doc);

  // Resume an unfinished run first.
  let run = doc.runs.find((r) => !r.completedAt && !r.error);
  if (!run) {
    const sigs = await a.ledger.signaturesSince(a.feeWallet, doc.lastTalliedSignature);
    const credits = await a.ledger.creditedLamports(a.feeWallet, sigs);
    let lamports = 0n;
    for (const v of credits.values()) lamports += v;
    run = { startedAt: new Date().toISOString(), lamports: lamports.toString() };
    if (doc.lastTalliedSignature) run.tallyFromSignature = doc.lastTalliedSignature;
    const newest = sigs[sigs.length - 1];
    if (newest) {
      run.tallyToSignature = newest;
      doc.lastTalliedSignature = newest;
    }
    doc.runs.push(run);
    await save();
    log(`tallied ${lamports} lamports over ${sigs.length} signatures`);
  }
  const lamports = BigInt(run.lamports);
  const balance = await a.reader.getBalanceLamports(feeWallet);
  const reserve = a.reserveLamports ?? 10_000_000n;
  const spendable = balance - reserve < lamports ? balance - reserve : lamports;
  const minSwap = a.minSwapLamports ?? 1_000_000n;
  if (!run.swapSignature && spendable < minSwap) {
    run.completedAt = new Date().toISOString();
    await save();
    log(`nothing to swap (${spendable} spendable lamports < ${minSwap})`);
    return { lamportsTallied: lamports, swapped: false, qsdUnitsBurned: 0n };
  }

  // Swap.
  if (!run.swapSignature) {
    const req = buildJupiterOrderRequest(a.jupiterApiUrl, { inputMint: WSOL_MINT, outputMint: a.qsdMint, amount: spendable, taker: a.feeWallet, slippageBps: a.slippageBps ?? 100 }, a.jupiterApiKey);
    const order = await fetchJupiterOrder(req, a.fetchImpl ?? fetch);
    const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction as string, 'base64'));
    const sent = await a.sender.sendVersioned(tx);
    run.swapSignature = sent.signature;
    run.swapLastValidBlockHeight = sent.lastValidBlockHeight;
    await save();
    log(`swap sent ${sent.signature}`);
  }
  const swapStatus = await a.sender.confirm(run.swapSignature, run.swapLastValidBlockHeight ?? 0);
  if (swapStatus === 'failed' || swapStatus === 'expired') {
    run.error = `swap ${run.swapSignature} ${swapStatus}`;
    delete run.swapSignature;
    await save();
    throw new ChainUnavailableError(run.error);
  }

  // Burn 100 % of the $QSD the fee wallet holds.
  const units = await a.reader.getTokenBalance(feeWallet, qsdMint);
  if (units <= 0n) {
    run.error = 'swap confirmed but the fee wallet holds no $QSD';
    await save();
    throw new ChainUnavailableError(run.error);
  }
  if (!run.burnSignature) {
    const ata = getAssociatedTokenAddressSync(qsdMint, feeWallet);
    const sent = await a.sender.send([createBurnInstruction(ata, qsdMint, feeWallet, units)]);
    run.burnSignature = sent.signature;
    run.qsdUnits = units.toString();
    await save();
    const s = await a.sender.confirm(sent.signature, sent.lastValidBlockHeight);
    if (s === 'failed' || s === 'expired') {
      run.error = `burn ${sent.signature} ${s}`;
      delete run.burnSignature;
      await save();
      throw new ChainUnavailableError(run.error);
    }
    a.observer?.emit({ type: 'burnSent', txSignature: sent.signature, mint: a.qsdMint, units: units.toString() });
    log(`burned ${units} $QSD units in ${sent.signature}`);
  }
  run.completedAt = new Date().toISOString();
  await save();
  return { lamportsTallied: lamports, swapped: true, swapSignature: run.swapSignature, burnSignature: run.burnSignature, qsdUnitsBurned: BigInt(run.qsdUnits ?? '0') };
}
