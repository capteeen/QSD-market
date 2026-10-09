import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  ChainConfigError,
  INITIAL_CURVE,
  PUMP_PROGRAM_ID,
  buildPumpPortalBuyRequest,
  buyCostLamports,
  creatorFeeCredit,
  creatorVaultPda,
  decodeBondingCurve,
  devBuySolForUnits,
} from '../src/index.js';

const SUPPLY = 1_000_000_000_000_000n; // 1B tokens, 6 decimals

describe('pump.fun curve arithmetic (estimates)', () => {
  it('prices a 5 % pool on a fresh curve at about 1.5 SOL, fee margin included, and never undershoots the curve', () => {
    const units = (SUPPLY * 5n) / 100n;
    const lamports = buyCostLamports(INITIAL_CURVE, units);
    expect(Number(lamports) / 1e9).toBeCloseTo(1.51, 2);
    // the curve price alone: tokens out for that SOL (minus the margin) still covers the pool
    const net = (lamports * 10_000n) / 10_300n;
    expect((INITIAL_CURVE.virtualTokenReserves * net) / (INITIAL_CURVE.virtualSolReserves + net)).toBeGreaterThanOrEqual(units - 1n);
    expect(devBuySolForUnits(units)).toBeGreaterThanOrEqual(Number(lamports) / 1e9);
    expect(Number(buyCostLamports(INITIAL_CURVE, (SUPPLY * 2n) / 100n)) / 1e9).toBeCloseTo(0.6, 1);
    expect(buyCostLamports(INITIAL_CURVE, 0n)).toBe(0n);
    expect(() => buyCostLamports(INITIAL_CURVE, INITIAL_CURVE.virtualTokenReserves)).toThrow(ChainConfigError);
  });

  it('decodes the bonding curve account layout', () => {
    const data = new Uint8Array(49);
    const v = new DataView(data.buffer);
    [1n, 2n, 3n, 4n, 5n].forEach((x, i) => v.setBigUint64(8 + i * 8, x, true));
    data[48] = 1;
    expect(decodeBondingCurve(data)).toEqual({ virtualTokenReserves: 1n, virtualSolReserves: 2n, realTokenReserves: 3n, realSolReserves: 4n, tokenTotalSupply: 5n, complete: true });
  });

  it('builds a PumpPortal buy for an exact token amount, rounded up', () => {
    const buyer = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const body = buildPumpPortalBuyRequest({ buyer, mint, units: 1_234_567n, decimals: 6 });
    expect(body).toMatchObject({ publicKey: buyer.toBase58(), action: 'buy', mint: mint.toBase58(), denominatedInSol: 'false', pool: 'pump' });
    expect(body.amount).toBeCloseTo(1.234567, 6);
    expect(() => buildPumpPortalBuyRequest({ buyer, mint, units: 0n, decimals: 6 })).toThrow(ChainConfigError);
  });
});

describe('creatorFeeCredit: only creator-vault payouts are fees', () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const vault = creatorVaultPda(new PublicKey(wallet)).toBase58();
  const user = Keypair.generate().publicKey.toBase58();

  it('derives the vault from the pump.fun program', () => {
    expect(PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), new PublicKey(wallet).toBuffer()], PUMP_PROGRAM_ID)[0].toBase58()).toBe(vault);
  });

  it('counts what left the vault when the wallet claims its fees', () => {
    expect(creatorFeeCredit({ accountKeys: [wallet, vault], preBalances: [1_000_000_000, 250_000_000], postBalances: [1_149_995_000, 100_000_000] }, wallet)).toBe(150_000_000n);
  });

  it('a launch payment or an operator top-up is not a fee', () => {
    expect(creatorFeeCredit({ accountKeys: [user, wallet], preBalances: [5e9, 1e9], postBalances: [4.85e9, 1.15e9] }, wallet)).toBe(0n);
  });

  it('the wallet spending (vault untouched or wallet debited) is not a fee', () => {
    expect(creatorFeeCredit({ accountKeys: [wallet, vault], preBalances: [1e9, 5e7], postBalances: [0.9e9, 5e7] }, wallet)).toBe(0n);
    expect(creatorFeeCredit({ accountKeys: [wallet, vault], preBalances: [1e9, 5e7], postBalances: [0.9e9, 0] }, wallet)).toBe(0n);
  });
});
