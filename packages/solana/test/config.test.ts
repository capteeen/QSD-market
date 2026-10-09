import { describe, expect, it } from 'vitest';
import { ChainConfigError, ENV, describeConfig, heliusRpcUrl, loadChainConfig, redactSecrets } from '../src/index.js';

const KEK = 'ab'.repeat(32);
const base = { [ENV.KEY_ENCRYPTION_KEY]: KEK };

describe('loadChainConfig', () => {
  it('defaults to mainnet-beta and fails closed without the real-funds flag', () => {
    expect(() => loadChainConfig(base)).toThrow(/QSD_MAINNET_ENABLED=true/);
    const c = loadChainConfig({ ...base, [ENV.MAINNET_ENABLED]: 'true' });
    expect(c.cluster).toBe('mainnet-beta');
    expect(c.isMainnet).toBe(true);
    expect(c.rpcUrl).toBe('https://api.mainnet-beta.solana.com');
  });

  it('devnet is selectable with SOLANA_CLUSTER=devnet and uses the public devnet RPC', () => {
    const c = loadChainConfig({ ...base, [ENV.CLUSTER]: 'devnet' });
    expect(c.cluster).toBe('devnet');
    expect(c.isMainnet).toBe(false);
    expect(c.rpcUrl).toBe('https://api.devnet.solana.com');
    expect(c.keyEncryptionKey).toHaveLength(32);
  });

  it('mainnet without QSD_MAINNET_ENABLED=true throws', () => {
    expect(() => loadChainConfig({ ...base, [ENV.CLUSTER]: 'mainnet-beta' })).toThrow(ChainConfigError);
    expect(() => loadChainConfig({ ...base, [ENV.CLUSTER]: 'mainnet-beta', [ENV.MAINNET_ENABLED]: 'yes' })).toThrow(/QSD_MAINNET_ENABLED=true/);
    const ok = loadChainConfig({ ...base, [ENV.CLUSTER]: 'mainnet-beta', [ENV.MAINNET_ENABLED]: 'true' });
    expect(ok.isMainnet).toBe(true);
    expect(ok.rpcUrl).toBe('https://api.mainnet-beta.solana.com');
  });

  it('rejects unknown clusters and bad RPC URLs', () => {
    expect(() => loadChainConfig({ ...base, [ENV.CLUSTER]: 'testnet' })).toThrow(ChainConfigError);
    expect(() => loadChainConfig({ ...base, [ENV.CLUSTER]: 'devnet', [ENV.RPC_URL]: 'ftp://x' })).toThrow(ChainConfigError);
  });

  it('never echoes a secret value in an error', () => {
    const badKey = 'deadbeef'.repeat(7); // 56 chars, wrong length
    try {
      loadChainConfig({ [ENV.KEY_ENCRYPTION_KEY]: badKey });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ChainConfigError);
      expect((e as Error).message).not.toContain(badKey);
      expect((e as Error).message).toContain(ENV.KEY_ENCRYPTION_KEY);
    }
    expect(() => loadChainConfig({})).toThrow(/QSD_KEY_ENCRYPTION_KEY is required/);
  });

  it('describeConfig redacts every secret', () => {
    const c = loadChainConfig({ ...base, [ENV.CLUSTER]: 'devnet', [ENV.HELIUS_API_KEY]: 'helius-secret-123', [ENV.JUPITER_API_KEY]: 'jup-secret', [ENV.WEBHOOK_SECRET]: 'whsec', [ENV.RPC_URL]: 'https://devnet.helius-rpc.com/?api-key=helius-secret-123' });
    const text = JSON.stringify(describeConfig(c));
    expect(text).not.toContain('helius-secret-123');
    expect(text).not.toContain('jup-secret');
    expect(text).not.toContain('whsec');
    expect(text).not.toContain(KEK);
    expect(heliusRpcUrl(c)).toContain('devnet.helius-rpc.com');
  });

  it('redactSecrets masks hex keys, bearer tokens and api-key query params', () => {
    const s = redactSecrets(`key ${KEK} Bearer abcdefghijklmnop url?api-key=zzz&x=1`);
    expect(s).not.toContain(KEK);
    expect(s).not.toContain('abcdefghijklmnop');
    expect(s).not.toContain('zzz');
  });
});
