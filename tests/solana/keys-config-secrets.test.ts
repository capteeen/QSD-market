/**
 * Agent H — keys at rest, secret hygiene, config guard, mainnet flag, webhook
 * auth. Spec §9 l.392-394 ("All keys encrypted at rest; no secrets in logs;
 * everything behind env. Devnet first. Mainnet behind an explicit flag").
 */
import { describe, expect, it } from 'vitest';
import { inspect } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Connection, Keypair } from '@solana/web3.js';
import {
  ChainConfigError,
  KeyVault,
  KeyVaultError,
  MemoryKeyStore,
  WebhookAuthError,
  Web3TransactionSender,
  createChain,
  decryptKeypair,
  describeConfig,
  encryptKeypair,
  loadChainConfig,
  parseHeliusWebhook,
  redactSecrets,
  verifyWebhookAuth,
  web3TransferSender,
  type EncryptedBlob,
} from '@qsd/solana';

const here = path.dirname(fileURLToPath(import.meta.url));
const KEK_HEX = 'a1'.repeat(32);
const KEK = Uint8Array.from(Buffer.from(KEK_HEX, 'hex'));
const flip = (hex: string, i: number) => hex.slice(0, i) + ((parseInt(hex[i]!, 16) ^ 1).toString(16)) + hex.slice(i + 1);

describe('KeyVault: keys encrypted at rest, tamper rejected (spec §9 l.392)', () => {
  const kp = Keypair.generate();
  const skHex = Buffer.from(kp.secretKey).toString('hex');

  it('round trip; the blob holds no plaintext secret; ciphertext / nonce / label tamper and a wrong key are rejected with a message that leaks nothing', () => {
    const blob = encryptKeypair(KEK, kp, 'qsd/mint/X');
    expect(JSON.stringify(blob)).not.toContain(skHex);
    expect(JSON.stringify(blob)).not.toContain(skHex.slice(0, 32));
    expect(decryptKeypair(KEK, blob, 'qsd/mint/X').publicKey.equals(kp.publicKey)).toBe(true);
    const variants: [string, EncryptedBlob][] = [
      ['ct first nibble', { ...blob, ct: flip(blob.ct, 0) }],
      ['ct last nibble (tag)', { ...blob, ct: flip(blob.ct, blob.ct.length - 1) }],
      ['ct truncated', { ...blob, ct: blob.ct.slice(0, -2) }],
      ['nonce', { ...blob, nonce: flip(blob.nonce, 3) }],
      ['nonce short', { ...blob, nonce: blob.nonce.slice(0, -2) }],
      ['label (AAD)', { ...blob, label: 'qsd/mint/Y' }],
      ['alg', { ...blob, alg: 'aes' as 'xchacha20poly1305' }],
      ['version', { ...blob, v: 2 as 1 }],
      ['not hex', { ...blob, ct: 'zz' + blob.ct.slice(2) }],
    ];
    for (const [name, v] of variants) {
      let err: unknown;
      try {
        decryptKeypair(KEK, v);
      } catch (e) {
        err = e;
      }
      expect(err, name).toBeInstanceOf(KeyVaultError);
      expect((err as Error).message).not.toContain(skHex.slice(0, 16));
      expect((err as Error).message).not.toContain(KEK_HEX.slice(0, 16));
    }
    const wrongKek = new Uint8Array(32).fill(7);
    expect(() => decryptKeypair(wrongKek, blob)).toThrow(KeyVaultError);
    expect(() => decryptKeypair(new Uint8Array(31), blob)).toThrow(KeyVaultError);
    // the label is bound: asking for the blob under a different expected label is refused even though the bytes are intact
    expect(() => decryptKeypair(KEK, blob, 'qsd/protocol-creator')).toThrow(/label/);
  });

  it('a blob moved to another slot in the store is refused (AAD = label); the store only ever holds ciphertext', async () => {
    const store = new MemoryKeyStore();
    const vault = new KeyVault(KEK, store);
    await vault.storeKeypair('qsd/mint/A', kp);
    const blob = (await store.get('qsd/mint/A'))!;
    await store.put('qsd/protocol-creator', blob);
    await expect(vault.loadKeypair('qsd/protocol-creator')).rejects.toThrow(KeyVaultError);
    expect(JSON.stringify(await store.list())).not.toContain(skHex.slice(0, 16));
    expect(JSON.stringify(blob)).not.toContain(skHex.slice(0, 16));
    await expect(vault.generateKeypair('qsd/mint/A')).rejects.toThrow(/already exists/);
    await expect(vault.loadKeypair('qsd/mint/nope')).rejects.toThrow(/no key/);
  });

  it('JSON.stringify / util.inspect of the vault show no key-encryption key', () => {
    const vault = new KeyVault(KEK, new MemoryKeyStore());
    for (const text of [JSON.stringify(vault), inspect(vault, { depth: 10, showHidden: true })]) {
      expect(text).not.toContain(KEK_HEX);
      expect(text).not.toMatch(/161,\s*161,\s*161/); // 0xa1 bytes
    }
  });

  it('FINDING H-S4a (MEDIUM): Web3TransactionSender / Web3TransferSender expose the payer SECRET KEY through JSON.stringify and util.inspect (TypeScript `private`, not `#private`)', () => {
    const connection = new Connection('http://127.0.0.1:1', 'confirmed'); // never contacted
    const sender = new Web3TransactionSender(connection, kp, 'devnet');
    const transfer = web3TransferSender(sender, connection, kp);
    const sk = kp.secretKey;
    const bytesPattern = new RegExp(`${sk[0]},\\s*${sk[1]},\\s*${sk[2]},\\s*${sk[3]},\\s*${sk[4]},\\s*${sk[5]},\\s*${sk[6]},\\s*${sk[7]}`);
    const jsonPattern = new RegExp(`"0":${sk[0]},"1":${sk[1]},"2":${sk[2]},"3":${sk[3]}`);
    const safeJson = (o: unknown) => {
      try {
        return JSON.stringify(o);
      } catch {
        return ''; // a circular Connection makes JSON.stringify throw; inspect still prints everything
      }
    };
    for (const [name, obj] of [
      ['Web3TransactionSender', sender],
      ['Web3TransferSender', transfer],
    ] as const) {
      const json = safeJson(obj);
      const ins = inspect(obj, { depth: 8 });
      expect(json, `${name} JSON`).not.toMatch(jsonPattern);
      expect(ins, `${name} inspect`).not.toMatch(bytesPattern);
      expect(ins, `${name} inspect`).not.toContain('secretKey');
    }
  });
});

describe('config: errors name variables, never values; mainnet behind the explicit flag (spec §9 l.393-394)', () => {
  const base = { QSD_KEY_ENCRYPTION_KEY: KEK_HEX };

  it('a malformed key names the variable and not the value; a bad cluster / RPC URL is named', () => {
    for (const bad of ['hunter2-definitely-not-hex', 'ab'.repeat(31), '', '  ']) {
      let err: unknown;
      try {
        loadChainConfig({ QSD_KEY_ENCRYPTION_KEY: bad });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ChainConfigError);
      expect((err as Error).message).toContain('QSD_KEY_ENCRYPTION_KEY');
      if (bad.trim()) expect((err as Error).message).not.toContain(bad.trim());
    }
    expect(() => loadChainConfig({ ...base, SOLANA_CLUSTER: 'testnet' })).toThrow(/SOLANA_CLUSTER/);
    expect(() => loadChainConfig({ ...base, SOLANA_RPC_URL: 'ftp://x' })).toThrow(/SOLANA_RPC_URL/);
    expect(loadChainConfig(base).cluster).toBe('devnet');
    expect(loadChainConfig(base).isMainnet).toBe(false);
  });

  it('mainnet-beta without QSD_MAINNET_ENABLED=true throws from loadChainConfig for every non-exact value', () => {
    for (const v of [undefined, '', 'false', '1', 'yes', 'TRUE', 'True', 'true ' + 'x']) {
      expect(() => loadChainConfig({ ...base, SOLANA_CLUSTER: 'mainnet-beta', ...(v === undefined ? {} : { QSD_MAINNET_ENABLED: v }) })).toThrow(/QSD_MAINNET_ENABLED/);
    }
    const ok = loadChainConfig({ ...base, SOLANA_CLUSTER: 'mainnet-beta', QSD_MAINNET_ENABLED: 'true', QSD_KEYSTORE_PATH: '/nonexistent/keystore.json' });
    expect(ok.isMainnet).toBe(true);
    expect(ok.rpcUrl).toBe('https://api.mainnet-beta.solana.com');
  });

  it('createChain refuses a memory-only key store on mainnet', () => {
    const cfg = loadChainConfig({ ...base, SOLANA_CLUSTER: 'mainnet-beta', QSD_MAINNET_ENABLED: 'true' });
    expect(() => createChain(cfg)).toThrow(/QSD_KEYSTORE_PATH/);
    const withStore = loadChainConfig({ ...base, SOLANA_CLUSTER: 'mainnet-beta', QSD_MAINNET_ENABLED: 'true', QSD_KEYSTORE_PATH: '/nonexistent/keystore.json' });
    expect(() => createChain(withStore)).not.toThrow(); // nothing touches the network until a method is called
  });

  it('FINDING H-S5 (MEDIUM): createChain is not itself behind the flag — a hand-built ChainConfig pointing at mainnet-beta with isMainnet=false is accepted (the config carries no record of QSD_MAINNET_ENABLED)', () => {
    const dev = loadChainConfig(base);
    const smuggled = { ...dev, cluster: 'mainnet-beta' as const, isMainnet: false, rpcUrl: 'https://api.mainnet-beta.solana.com' };
    expect(() => createChain(smuggled)).toThrow(/QSD_MAINNET_ENABLED|mainnet/);
  });

  it('describeConfig and redactSecrets hide every secret; loggable', async () => {
    const cfg = loadChainConfig({
      ...base,
      HELIUS_API_KEY: 'helius-secret-123456',
      PINATA_JWT: 'eyJ.pinata.secret',
      JUPITER_API_KEY: 'jup-secret-7890',
      QSD_WEBHOOK_SECRET: 'webhook-secret-xyz',
      SOLANA_RPC_URL: 'https://rpc.example/?api-key=rpc-secret-key',
    });
    const text = JSON.stringify(describeConfig(cfg));
    for (const s of ['helius-secret-123456', 'eyJ.pinata.secret', 'jup-secret-7890', 'webhook-secret-xyz', 'rpc-secret-key', KEK_HEX]) expect(text).not.toContain(s);
    expect(text).toContain('[set]');
    expect(redactSecrets(`key ${KEK_HEX} and Bearer abcdefghijklmnop and ?api-key=zzz`)).toBe('key [redacted] and [redacted] and ?[redacted]');
    const skB58 = (await import('bs58')).default.encode(Keypair.generate().secretKey);
    expect(redactSecrets(`sk ${skB58}`)).toBe('sk [redacted]');
  });

  it('FINDING H-S4b (MEDIUM): the ChainConfig object (and the Chain that embeds it) exposes the key-encryption key bytes and every API secret through JSON.stringify / util.inspect', () => {
    const cfg = loadChainConfig({ ...base, HELIUS_API_KEY: 'helius-secret-123456', PINATA_JWT: 'eyJ.pinata.secret', QSD_WEBHOOK_SECRET: 'webhook-secret-xyz' });
    const chain = createChain(cfg);
    for (const [name, obj] of [
      ['ChainConfig', cfg],
      ['Chain', chain],
    ] as const) {
      for (const text of [JSON.stringify(obj), inspect(obj, { depth: 6 })]) {
        expect(text, name).not.toContain('helius-secret-123456');
        expect(text, name).not.toContain('eyJ.pinata.secret');
        expect(text, name).not.toContain('webhook-secret-xyz');
        expect(text, name).not.toMatch(/161,\s*161,\s*161,\s*161/);
        expect(text, name).not.toContain('"0":161,"1":161');
      }
    }
  });
});

describe('webhook auth (spec §9 l.391)', () => {
  it('constant-time compare in source; bad / missing / unset secrets rejected; good accepted', () => {
    const src = readFileSync(path.join(here, '..', '..', 'packages', 'solana', 'src', 'webhooks.ts'), 'utf8');
    expect(src).toMatch(/timingSafeEqual\(/);
    expect(src).not.toMatch(/authHeader\s*===?\s*secret/);
    expect(src).not.toMatch(/secret\s*===?\s*authHeader/);
    expect(() => verifyWebhookAuth('s', undefined)).toThrow(WebhookAuthError);
    expect(() => verifyWebhookAuth(undefined, 's')).toThrow(WebhookAuthError);
    expect(() => verifyWebhookAuth('', 's')).toThrow(WebhookAuthError);
    expect(() => verifyWebhookAuth('secret-x', 'secret-y')).toThrow(WebhookAuthError);
    expect(() => verifyWebhookAuth('secret', 'secret-longer')).toThrow(WebhookAuthError);
    expect(() => verifyWebhookAuth('Secret', 'secret')).toThrow(WebhookAuthError);
    expect(() => verifyWebhookAuth('secret', 'secret')).not.toThrow();
    expect(() => parseHeliusWebhook([], 'nope', { secret: 'secret' })).toThrow(WebhookAuthError);
    expect(() => parseHeliusWebhook([], 'secret', { secret: undefined })).toThrow(WebhookAuthError);
    expect(parseHeliusWebhook([], 'secret', { secret: 'secret' })).toEqual([]);
    expect(() => parseHeliusWebhook('{not json', 'secret', { secret: 'secret' })).toThrow(/JSON/);
    expect(() => parseHeliusWebhook({}, 'secret', { secret: 'secret' })).toThrow(/array/);
    // the error message never echoes the secret
    try {
      verifyWebhookAuth('wrong-header-value', 'the-real-secret');
    } catch (e) {
      expect((e as Error).message).not.toContain('the-real-secret');
      expect((e as Error).message).not.toContain('wrong-header-value');
    }
  });
});
