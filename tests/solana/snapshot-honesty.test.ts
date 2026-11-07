/**
 * Agent H — snapshot honesty: no holding facts are ever defaulted, stale data
 * is refused, every source failure surfaces. Spec §2 l.96-97 ("Nothing
 * invented"), §9 l.382-384, README §9.
 */
import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { ChainUnavailableError, NotImplementedError, holderSnapshotAtSlot, mergeByOwner, type HoldingHistory, type TokenAccountSource } from '@qsd/solana';
import { Ledger } from './ledger.js';

function world() {
  const payer = Keypair.generate();
  const ledger = new Ledger(payer);
  const mint = Keypair.generate().publicKey;
  ledger.createMint(mint, 6);
  const a = Keypair.generate().publicKey;
  const b = Keypair.generate().publicKey;
  const z = Keypair.generate().publicKey;
  ledger.mintTo(mint, a, 500n);
  ledger.mintTo(mint, b, 300n);
  ledger.mintTo(mint, payer.publicKey, 10_000n);
  ledger.accounts.set('ZeroAcct', { owner: z.toBase58(), mint: mint.toBase58(), amount: 0n });
  const req = { mint: mint.toBase58(), bornAt: 1000, collapseAt: 2000, collapseSlot: ledger.slot, quietPeriodStart: 1500, measurements: [], excludeOwners: [payer.publicKey.toBase58()] };
  const history: HoldingHistory = { async factsFor(_w, _b, ctx) { return { firstAcquiredAt: ctx.bornAt + 100, heldThroughMeasurementIds: [], heldThroughQuietPeriod: true }; } };
  return { payer, ledger, mint, a, b, z, req, history };
}

describe('holderSnapshotAtSlot', () => {
  it('without a HoldingHistory throws NotImplemented naming the missing facts — never zeros', async () => {
    const w = world();
    await expect(holderSnapshotAtSlot(w.req, { sources: [w.ledger] })).rejects.toBeInstanceOf(NotImplementedError);
    await expect(holderSnapshotAtSlot(w.req, { sources: [w.ledger] })).rejects.toThrow(/HoldingHistory|firstAcquiredAt/);
  });

  it('data observed before the collapse slot is refused', async () => {
    const w = world();
    await expect(holderSnapshotAtSlot({ ...w.req, collapseSlot: w.ledger.slot + 1 }, { sources: [w.ledger], history: w.history })).rejects.toThrow(/before the collapse slot/);
    const ok = await holderSnapshotAtSlot(w.req, { sources: [w.ledger], history: w.history });
    expect(ok.observedSlot).toBe(w.ledger.slot);
    expect(ok.requestedSlot).toBe(w.req.collapseSlot);
  });

  it('no sources / every source failing throws with every reason; a failing first source falls through to the next', async () => {
    const w = world();
    const failing: TokenAccountSource = { name: 'helius-das', async listByMint() { throw new ChainUnavailableError('DAS down'); } };
    await expect(holderSnapshotAtSlot(w.req, { sources: [], history: w.history })).rejects.toThrow(/no token-account source/);
    await expect(holderSnapshotAtSlot(w.req, { sources: [failing], history: w.history })).rejects.toThrow(/every holder source failed.*DAS down/);
    const r = await holderSnapshotAtSlot(w.req, { sources: [failing, w.ledger], history: w.history });
    expect(r.source).toBe('getProgramAccounts');
  });

  it('excluded owners (treasury) and zero balances are dropped; balances come from the ledger, facts from the history; the quiet flag is coerced false when acquired after the quiet period started', async () => {
    const w = world();
    const r = await holderSnapshotAtSlot(w.req, { sources: [w.ledger], history: w.history });
    expect(r.holders.map((h) => h.wallet).sort()).toEqual([w.a.toBase58(), w.b.toBase58()].sort());
    expect(r.holders.find((h) => h.wallet === w.a.toBase58())!.balance).toBe(500n);
    expect(r.holders.every((h) => h.firstAcquiredAt === 1100 && h.heldThroughQuietPeriod)).toBe(true);
    expect(r.tokenAccounts).toBe(4);
    const late: HoldingHistory = { async factsFor() { return { firstAcquiredAt: 1600, heldThroughMeasurementIds: [], heldThroughQuietPeriod: true }; } };
    const r2 = await holderSnapshotAtSlot(w.req, { sources: [w.ledger], history: late });
    expect(r2.holders.every((h) => h.heldThroughQuietPeriod === false)).toBe(true);
  });

  it('a history that answers with an impossible firstAcquiredAt (after the collapse, NaN) is refused rather than clamped', async () => {
    const w = world();
    const bad: HoldingHistory = { async factsFor() { return { firstAcquiredAt: 2001, heldThroughMeasurementIds: [], heldThroughQuietPeriod: false }; } };
    await expect(holderSnapshotAtSlot(w.req, { sources: [w.ledger], history: bad })).rejects.toThrow(/invalid firstAcquiredAt/);
    const nan: HoldingHistory = { async factsFor() { return { firstAcquiredAt: NaN, heldThroughMeasurementIds: [], heldThroughQuietPeriod: false }; } };
    await expect(holderSnapshotAtSlot(w.req, { sources: [w.ledger], history: nan })).rejects.toThrow(/invalid firstAcquiredAt/);
  });

  it('mergeByOwner sums several token accounts per owner, drops zeros, sorts', () => {
    const o1 = new PublicKey(Keypair.generate().publicKey).toBase58();
    const o2 = Keypair.generate().publicKey.toBase58();
    const rows = [
      { address: 'x1', owner: o1, amount: 5n, frozen: false },
      { address: 'x2', owner: o1, amount: 7n, frozen: false },
      { address: 'x3', owner: o2, amount: 0n, frozen: false },
    ];
    const m = mergeByOwner(rows);
    expect(m).toEqual([{ wallet: o1, balance: 12n }]);
  });
});
