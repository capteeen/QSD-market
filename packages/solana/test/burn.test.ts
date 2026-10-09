import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { ChainConfigError, MemoryJournalStore, WSOL_MINT, buildJupiterOrderRequest, fetchJupiterOrder, hourlyBuyAndBurn, type BurnJournalDoc, type FeeLedger } from '../src/index.js';
import { FakeChain } from './helpers/fakeChain.js';

describe('Jupiter request builder', () => {
  it('builds the documented Swap V2 /order request with x-api-key', () => {
    const r = buildJupiterOrderRequest('https://api.jup.ag', { inputMint: WSOL_MINT, outputMint: 'QSDmint', amount: 123n, taker: 'wallet', slippageBps: 50 }, 'key-1');
    const u = new URL(r.url);
    expect(u.origin + u.pathname).toBe('https://api.jup.ag/swap/v2/order');
    expect(Object.fromEntries(u.searchParams)).toEqual({ inputMint: WSOL_MINT, outputMint: 'QSDmint', amount: '123', taker: 'wallet', slippageBps: '50' });
    expect(r.headers['x-api-key']).toBe('key-1');
    expect(buildJupiterOrderRequest('https://api.jup.ag/', { inputMint: WSOL_MINT, outputMint: 'm', amount: 1n, taker: 't' }).headers['x-api-key']).toBeUndefined();
    expect(() => buildJupiterOrderRequest('https://api.jup.ag', { inputMint: WSOL_MINT, outputMint: 'm', amount: 0n, taker: 't' })).toThrow(ChainConfigError);
  });

  it('fetchJupiterOrder requires a transaction in the response', async () => {
    const noTx = (async () => new Response(JSON.stringify({ requestId: 'r' }), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchJupiterOrder({ url: 'https://x', headers: {} }, noTx)).rejects.toThrow(/no transaction/);
    const tooMany = (async () => new Response('', { status: 429 })) as unknown as typeof fetch;
    await expect(fetchJupiterOrder({ url: 'https://x', headers: {} }, tooMany)).rejects.toThrow(/429/);
  });
});

describe('hourlyBuyAndBurn', () => {
  const ledger: FeeLedger = {
    async signaturesSince() {
      return ['sigA', 'sigB'];
    },
    async creditedLamports() {
      return new Map([
        ['sigA', 100_000n],
        ['sigB', 200_000n],
      ]);
    },
  };

  it('throws without the $QSD mint', async () => {
    const payer = Keypair.generate();
    const chain = new FakeChain(payer);
    await expect(
      hourlyBuyAndBurn({ feeWallet: payer.publicKey.toBase58(), qsdMint: undefined, sender: chain, reader: chain, ledger, journal: new MemoryJournalStore<BurnJournalDoc>(), jupiterApiUrl: 'https://api.jup.ag' }),
    ).rejects.toThrow(/QSD_TOKEN_MINT/);
  });

  it('tallies by signature, journals the cursor, and skips the swap below the dust threshold', async () => {
    const payer = Keypair.generate();
    const chain = new FakeChain(payer);
    const journal = new MemoryJournalStore<BurnJournalDoc>();
    const r = await hourlyBuyAndBurn({ feeWallet: payer.publicKey.toBase58(), qsdMint: Keypair.generate().publicKey.toBase58(), sender: chain, reader: chain, ledger, journal, jupiterApiUrl: 'https://api.jup.ag' });
    expect(r).toEqual({ lamportsTallied: 300_000n, swapped: false, qsdUnitsBurned: 0n });
    const doc = (await journal.load())!;
    expect(doc.lastTalliedSignature).toBe('sigB');
    expect(doc.runs[0]!.completedAt).toBeDefined();
  });
});
