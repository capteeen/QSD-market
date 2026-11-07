import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { ChainConfigError, ChainUnavailableError, buildDevnetSplMintInstructions, buildPumpPortalCreateRequest, launchDevnetSplToken, launchOnPumpFun, pumpPortalTradeLocalUrl, transactionSize, uploadTokenMetadata } from '../src/index.js';
import { FakeChain } from './helpers/fakeChain.js';

describe('PumpPortal request builder', () => {
  it('produces the documented trade-local create body', () => {
    const creator = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const body = buildPumpPortalCreateRequest({ creator, mint, metadataUri: 'https://ipfs.io/ipfs/bafy', name: 'QSD', symbol: 'QSD', devBuySol: 0.5 });
    expect(body).toEqual({
      publicKey: creator.toBase58(),
      action: 'create',
      tokenMetadata: { name: 'QSD', symbol: 'QSD', uri: 'https://ipfs.io/ipfs/bafy' },
      mint: mint.toBase58(),
      denominatedInSol: 'true',
      amount: 0.5,
      slippage: 10,
      priorityFee: 0.0005,
      pool: 'pump',
    });
    expect(Object.keys(body)).toEqual(['publicKey', 'action', 'tokenMetadata', 'mint', 'denominatedInSol', 'amount', 'slippage', 'priorityFee', 'pool']);
    expect(pumpPortalTradeLocalUrl('https://pumpportal.fun/api/')).toBe('https://pumpportal.fun/api/trade-local');
    expect(() => buildPumpPortalCreateRequest({ creator, mint, metadataUri: 'ipfs://x', name: 'a', symbol: 'b', devBuySol: 1 })).toThrow(ChainConfigError);
    expect(() => buildPumpPortalCreateRequest({ creator, mint, metadataUri: 'https://x', name: 'a', symbol: 'b', devBuySol: -1 })).toThrow(ChainConfigError);
  });

  it('uploads image then metadata to Pinata with the documented form fields (mocked fetch)', async () => {
    const calls: { url: string; auth: string | undefined; fields: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      const fields: Record<string, unknown> = {};
      for (const [k, v] of form.entries()) fields[k] = v instanceof Blob ? await v.text() : v;
      calls.push({ url: String(url), auth: (init?.headers as Record<string, string>)['Authorization'], fields });
      return new Response(JSON.stringify({ data: { cid: `cid${calls.length}` } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await uploadTokenMetadata({ metadata: { name: 'N', symbol: 'S', description: 'd' }, imageBytes: new Uint8Array([1, 2, 3]), pinataJwt: 'jwt' }, fetchImpl);
    expect(r).toEqual({ imageUri: 'https://ipfs.io/ipfs/cid1', metadataUri: 'https://ipfs.io/ipfs/cid2' });
    expect(calls[0]!.url).toBe('https://uploads.pinata.cloud/v3/files');
    expect(calls[0]!.auth).toBe('Bearer jwt');
    expect(calls[0]!.fields['network']).toBe('public');
    expect(JSON.parse(calls[1]!.fields['file'] as string)).toEqual({ name: 'N', symbol: 'S', image: 'https://ipfs.io/ipfs/cid1', description: 'd' });
    await expect(uploadTokenMetadata({ metadata: { name: 'N', symbol: 'S' }, imageBytes: new Uint8Array(1), pinataJwt: undefined }, fetchImpl)).rejects.toThrow(/PINATA_JWT/);
  });

  it('refuses pump.fun launches on devnet', async () => {
    const payer = Keypair.generate();
    const chain = new FakeChain(payer);
    await expect(
      launchOnPumpFun({ metadata: { name: 'a', symbol: 'b' }, imageBytes: new Uint8Array(1), devBuySol: 0.1, creator: payer }, { cluster: 'devnet', sender: chain, reader: chain, pumpPortalApiUrl: 'https://pumpportal.fun/api' }),
    ).rejects.toThrow(/mainnet-only/);
  });
});

describe('devnet SPL launch', () => {
  it('mints the whole supply to the payer in one transaction that fits the packet limit', async () => {
    const payer = Keypair.generate();
    const chain = new FakeChain(payer);
    const mint = Keypair.generate();
    const ixs = buildDevnetSplMintInstructions(payer.publicKey, mint.publicKey, 6, 1_000_000_000_000_000n, 1_461_600);
    expect(ixs).toHaveLength(4);
    expect(transactionSize(payer.publicKey, ixs)).toBeLessThanOrEqual(1232);
    const r = await launchDevnetSplToken({ supplyUnits: 1_000_000_000_000_000n, decimals: 6, mint }, { cluster: 'devnet', sender: chain, reader: chain, getMintRentLamports: async () => 1_461_600 });
    expect(r.ca).toBe(mint.publicKey.toBase58());
    expect(r.supply).toEqual({ totalUnits: 1_000_000_000_000_000n, decimals: 6 });
    expect(chain.balanceOf(payer.publicKey, mint.publicKey)).toBe(1_000_000_000_000_000n);
    await expect(launchDevnetSplToken({ supplyUnits: 1n, decimals: 6 }, { cluster: 'mainnet-beta', sender: chain, reader: chain, getMintRentLamports: async () => 0 })).rejects.toThrow(ChainUnavailableError);
  });
});
