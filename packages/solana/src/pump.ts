/**
 * pump.fun bonding-curve arithmetic and accounts, used to size dev buys and
 * to tell real creator-fee income apart from every other deposit.
 *
 * pump.fun program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P (pump.fun IDL):
 *   bonding curve  PDA ["bonding-curve", mint]   8-byte discriminator, then
 *                  u64 virtualTokenReserves, u64 virtualSolReserves,
 *                  u64 realTokenReserves, u64 realSolReserves,
 *                  u64 tokenTotalSupply, bool complete (little-endian)
 *   creator vault  PDA ["creator-vault", creator]  holds the coin creator's
 *                  trading fees until `collect_creator_fee` pays them out
 * A fresh curve starts at 30 SOL virtual / 1 073 000 000 tokens virtual
 * (6 decimals); a buy of x lamports returns vTok·x / (vSol + x) units.
 *
 * Costs computed here are ESTIMATES: pump.fun takes a trading fee on top of
 * the curve price, which FEE_MARGIN_BPS over-covers. Buying a little more
 * than needed is harmless (the treasury keeps the excess); buying less stops
 * the collapse, so the margin errs high.
 */
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { ChainConfigError, ChainUnavailableError, TransientChainError, errorMessage } from './errors.js';
import { pumpPortalTradeLocalUrl } from './launch.js';
import type { SentTransaction, TransactionSender } from './sender.js';

type FetchLike = typeof fetch;

export const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMP_INITIAL_VIRTUAL_SOL_LAMPORTS = 30_000_000_000n;
export const PUMP_INITIAL_VIRTUAL_TOKEN_UNITS = 1_073_000_000_000_000n;
export const PUMP_DECIMALS = 6;
/** Added on top of the curve price to cover pump.fun's trading fee (estimate, errs high). */
export const PUMP_FEE_MARGIN_BPS = 300n;

export function bondingCurvePda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], PUMP_PROGRAM_ID)[0];
}

export function creatorVaultPda(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM_ID)[0];
}

export interface BondingCurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  /** True once the coin graduated off the curve (trades on the AMM instead). */
  complete: boolean;
}

export function decodeBondingCurve(data: Uint8Array): BondingCurveState {
  if (data.length < 49) throw new ChainUnavailableError(`bonding curve account is ${data.length} bytes, expected at least 49`);
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u64 = (o: number) => v.getBigUint64(o, true);
  return {
    virtualTokenReserves: u64(8),
    virtualSolReserves: u64(16),
    realTokenReserves: u64(24),
    realSolReserves: u64(32),
    tokenTotalSupply: u64(40),
    complete: data[48] === 1,
  };
}

export const INITIAL_CURVE: Pick<BondingCurveState, 'virtualSolReserves' | 'virtualTokenReserves'> = {
  virtualSolReserves: PUMP_INITIAL_VIRTUAL_SOL_LAMPORTS,
  virtualTokenReserves: PUMP_INITIAL_VIRTUAL_TOKEN_UNITS,
};

/** Lamports to buy `units` from a curve, fee margin included (rounded up). Estimate. */
export function buyCostLamports(curve: Pick<BondingCurveState, 'virtualSolReserves' | 'virtualTokenReserves'>, units: bigint): bigint {
  if (units < 0n) throw new ChainConfigError('units must be >= 0');
  if (units === 0n) return 0n;
  if (units >= curve.virtualTokenReserves) throw new ChainConfigError(`cannot buy ${units} units from a curve holding ${curve.virtualTokenReserves}`);
  const num = curve.virtualSolReserves * units;
  const den = curve.virtualTokenReserves - units;
  const price = (num + den - 1n) / den;
  return (price * (10_000n + PUMP_FEE_MARGIN_BPS) + 9_999n) / 10_000n;
}

/** SOL (as a JS number for PumpPortal's `amount`) a creator's dev buy needs to receive at least `units` of a fresh coin. */
export function devBuySolForUnits(units: bigint): number {
  const lamports = buyCostLamports(INITIAL_CURVE, units);
  // round up to the micro-SOL so the float never falls below the lamport figure
  return Math.ceil(Number(lamports) / 1_000) / 1_000_000;
}

/**
 * Real creator-fee income in one transaction: the lamports that left the fee
 * wallet's pump.fun creator vault, counted only when the fee wallet itself
 * was credited. A user's launch payment, an operator top-up or any other
 * transfer never touches the vault and counts as 0. Fees from coins that
 * graduated to pump.fun's AMM are paid in a different account and are not
 * counted (the burn under-counts rather than over-counts).
 */
export function creatorFeeCredit(tx: { accountKeys: readonly string[]; preBalances: readonly (number | bigint)[]; postBalances: readonly (number | bigint)[] }, feeWallet: string): bigint {
  const vault = creatorVaultPda(new PublicKey(feeWallet)).toBase58();
  const w = tx.accountKeys.indexOf(feeWallet);
  const vi = tx.accountKeys.indexOf(vault);
  if (w < 0 || vi < 0) return 0n;
  const walletDelta = BigInt(tx.postBalances[w] ?? 0) - BigInt(tx.preBalances[w] ?? 0);
  const vaultOut = BigInt(tx.preBalances[vi] ?? 0) - BigInt(tx.postBalances[vi] ?? 0);
  // the wallet pays the network fee for its own claim, so it may be credited slightly less than the vault paid
  if (vaultOut <= 0n || walletDelta <= 0n) return 0n;
  return vaultOut;
}

// ------------------------------------------------------------------ buy

export interface PumpPortalBuyRequest {
  publicKey: string;
  action: 'buy';
  mint: string;
  denominatedInSol: 'false';
  /** Whole tokens (UI amount). */
  amount: number;
  slippage: number;
  priorityFee: number;
  pool: 'pump';
}

/** Pure: PumpPortal `trade-local` body for buying an exact token amount on the bonding curve. */
export function buildPumpPortalBuyRequest(p: { buyer: PublicKey; mint: PublicKey; units: bigint; decimals: number; slippagePercent?: number; priorityFeeSol?: number }): PumpPortalBuyRequest {
  if (p.units <= 0n) throw new ChainConfigError('buy amount must be positive');
  const scale = 10 ** p.decimals;
  // round the whole-token amount up so the buy never lands short
  const tokens = Math.ceil((Number(p.units) / scale) * 1e6) / 1e6;
  return {
    publicKey: p.buyer.toBase58(),
    action: 'buy',
    mint: p.mint.toBase58(),
    denominatedInSol: 'false',
    amount: tokens,
    slippage: p.slippagePercent ?? 10,
    priorityFee: p.priorityFeeSol ?? 0.0005,
    pool: 'pump',
  };
}

export interface PumpBuyDeps {
  sender: TransactionSender;
  pumpPortalApiUrl: string;
  fetchImpl?: FetchLike;
  /** Called with the signature before confirmation so the caller can journal it. */
  onSent?: (sent: SentTransaction) => Promise<void> | void;
}

/** Buy `units` of `mint` on its bonding curve through PumpPortal, paid by sender.payer. Returns the confirmed signature. */
export async function buyOnPumpFun(p: { mint: PublicKey; units: bigint; decimals: number }, deps: PumpBuyDeps): Promise<string> {
  const body = buildPumpPortalBuyRequest({ buyer: deps.sender.payer, ...p });
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(pumpPortalTradeLocalUrl(deps.pumpPortalApiUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ChainUnavailableError(`PumpPortal trade-local (buy): ${errorMessage(e)}`, { cause: e });
  }
  if (res.status !== 200) {
    const err = `PumpPortal trade-local (buy) returned HTTP ${res.status}`;
    if (res.status === 429 || res.status >= 500) throw new TransientChainError(err);
    throw new ChainUnavailableError(err);
  }
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(new Uint8Array(await res.arrayBuffer()));
  } catch (e) {
    throw new ChainUnavailableError(`PumpPortal returned a body that is not a VersionedTransaction: ${errorMessage(e)}`, { cause: e });
  }
  const sent = await deps.sender.sendVersioned(tx);
  await deps.onSent?.(sent);
  const status = await deps.sender.confirm(sent.signature, sent.lastValidBlockHeight);
  if (status === 'failed' || status === 'expired') throw new ChainUnavailableError(`pump.fun buy ${sent.signature} ${status}`);
  return sent.signature;
}
