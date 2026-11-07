import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CREATOR_KEY_LABEL, FileKeyStore, KeyVault, KeyVaultError, MemoryKeyStore, decryptKeypair, encryptKeypair, loadCreatorKeypair } from '../src/index.js';

const kek = randomBytes(32);

describe('KeyVault', () => {
  it('round-trips a keypair', () => {
    const kp = Keypair.generate();
    const blob = encryptKeypair(kek, kp, 'test');
    expect(blob.alg).toBe('xchacha20poly1305');
    expect(blob.nonce).toHaveLength(48);
    expect(JSON.stringify(blob)).not.toContain(Buffer.from(kp.secretKey).toString('hex'));
    const back = decryptKeypair(kek, blob, 'test');
    expect(back.publicKey.equals(kp.publicKey)).toBe(true);
    expect(Buffer.from(back.secretKey).equals(Buffer.from(kp.secretKey))).toBe(true);
  });

  it('detects tampering, wrong key and label swaps', () => {
    const kp = Keypair.generate();
    const blob = encryptKeypair(kek, kp, 'a');
    const flipped = { ...blob, ct: (parseInt(blob.ct.slice(0, 2), 16) ^ 1).toString(16).padStart(2, '0') + blob.ct.slice(2) };
    expect(() => decryptKeypair(kek, flipped)).toThrow(KeyVaultError);
    expect(() => decryptKeypair(randomBytes(32), blob)).toThrow(/authentication failed/);
    expect(() => decryptKeypair(kek, { ...blob, label: 'b' })).toThrow(/authentication failed/); // AAD = label
    expect(() => decryptKeypair(kek, blob, 'b')).toThrow(/label mismatch/);
    expect(() => encryptKeypair(randomBytes(16), kp, 'a')).toThrow(/32 bytes/);
  });

  it('memory and file stores hold only ciphertext; vault loads what it stored', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'qsd-keys-'));
    for (const store of [new MemoryKeyStore(), new FileKeyStore(path.join(dir, 'keys.json'))]) {
      const vault = new KeyVault(kek, store);
      const kp = await vault.generateKeypair('x');
      await expect(vault.generateKeypair('x')).rejects.toThrow(/already exists/);
      const back = await vault.loadKeypair('x');
      expect(back.publicKey.equals(kp.publicKey)).toBe(true);
      expect(await store.list()).toEqual(['x']);
      const raw = JSON.stringify(await store.get('x'));
      expect(raw).not.toContain(Buffer.from(kp.secretKey).toString('hex'));
      expect(raw).not.toContain(kp.publicKey.toBase58().slice(0, 10)); // nothing recognisable leaks
      await expect(vault.loadKeypair('nope')).rejects.toThrow(/no key stored/);
      expect(JSON.stringify(vault)).not.toContain(Buffer.from(kek).toString('hex'));
    }
  });

  it('loadCreatorKeypair accepts an inline blob or a file path, with the creator label', async () => {
    const vault = new KeyVault(kek, new MemoryKeyStore());
    const kp = Keypair.generate();
    const blob = vault.encryptBlob(kp, CREATOR_KEY_LABEL);
    const inline = await loadCreatorKeypair(vault, JSON.stringify(blob));
    expect(inline.publicKey.equals(kp.publicKey)).toBe(true);
    const dir = mkdtempSync(path.join(tmpdir(), 'qsd-creator-'));
    const file = path.join(dir, 'creator.json');
    await import('node:fs/promises').then((fs) => fs.writeFile(file, JSON.stringify(blob)));
    const fromFile = await loadCreatorKeypair(vault, file);
    expect(fromFile.publicKey.equals(kp.publicKey)).toBe(true);
    await expect(loadCreatorKeypair(vault, JSON.stringify(vault.encryptBlob(kp, 'other')))).rejects.toThrow(/label mismatch/);
    await expect(loadCreatorKeypair(vault, undefined)).rejects.toThrow(/unset/);
  });
});
