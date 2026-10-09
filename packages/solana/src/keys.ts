/**
 * Keys at rest. Every keypair the chain package holds (protocol creator,
 * per-launch mint keypairs, identity-reserve seeds) is encrypted with
 * XChaCha20-Poly1305 under one 32-byte key-encryption key (`QSD_KEY_ENCRYPTION_KEY`).
 *
 *   nonce  = 24 random bytes
 *   AAD    = utf8(label)                     (a blob cannot be swapped between labels)
 *   blob   = { v: 1, alg: 'xchacha20poly1305', label, nonce: hex, ct: hex }
 *
 * Nothing here logs; decrypt failures say only "authentication failed".
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/ciphers/webcrypto.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { Keypair } from '@solana/web3.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { KeyVaultError } from './errors.js';

export interface EncryptedBlob {
  v: 1;
  alg: 'xchacha20poly1305';
  label: string;
  nonce: string; // 24 bytes hex
  ct: string; // ciphertext || tag, hex
}

export const KEK_BYTES = 32;
export const NONCE_BYTES = 24;

function assertKek(kek: Uint8Array): void {
  if (!(kek instanceof Uint8Array) || kek.length !== KEK_BYTES) {
    throw new KeyVaultError(`key-encryption key must be ${KEK_BYTES} bytes`);
  }
}

export function encryptBytes(kek: Uint8Array, plaintext: Uint8Array, label: string): EncryptedBlob {
  assertKek(kek);
  if (typeof label !== 'string' || label.length === 0) throw new KeyVaultError('label must be a non-empty string');
  const nonce = randomBytes(NONCE_BYTES);
  const aad = new TextEncoder().encode(label);
  const ct = xchacha20poly1305(kek, nonce, aad).encrypt(plaintext);
  return { v: 1, alg: 'xchacha20poly1305', label, nonce: bytesToHex(nonce), ct: bytesToHex(ct) };
}

export function decryptBytes(kek: Uint8Array, blob: EncryptedBlob, expectedLabel?: string): Uint8Array {
  assertKek(kek);
  if (!blob || blob.v !== 1 || blob.alg !== 'xchacha20poly1305') throw new KeyVaultError('unsupported blob format');
  if (expectedLabel !== undefined && blob.label !== expectedLabel) {
    throw new KeyVaultError(`blob label mismatch (expected '${expectedLabel}', blob says '${blob.label}')`);
  }
  let nonce: Uint8Array;
  let ct: Uint8Array;
  try {
    nonce = hexToBytes(blob.nonce);
    ct = hexToBytes(blob.ct);
  } catch {
    throw new KeyVaultError('blob is not valid hex');
  }
  if (nonce.length !== NONCE_BYTES) throw new KeyVaultError('blob nonce has the wrong length');
  const aad = new TextEncoder().encode(blob.label);
  try {
    return xchacha20poly1305(kek, nonce, aad).decrypt(ct);
  } catch {
    throw new KeyVaultError('authentication failed: wrong key, wrong label, or tampered blob');
  }
}

/** Encrypt a Solana keypair (its 64-byte secret key). */
export function encryptKeypair(kek: Uint8Array, keypair: Keypair, label: string): EncryptedBlob {
  return encryptBytes(kek, keypair.secretKey, label);
}

export function decryptKeypair(kek: Uint8Array, blob: EncryptedBlob, expectedLabel?: string): Keypair {
  const sk = decryptBytes(kek, blob, expectedLabel);
  if (sk.length !== 64) throw new KeyVaultError('decrypted secret is not a 64-byte ed25519 secret key');
  return Keypair.fromSecretKey(sk);
}

/** Where encrypted blobs live. Implementations never see plaintext. */
export interface KeyStore {
  get(label: string): Promise<EncryptedBlob | undefined>;
  put(label: string, blob: EncryptedBlob): Promise<void>;
  delete(label: string): Promise<void>;
  list(): Promise<string[]>;
}

export class MemoryKeyStore implements KeyStore {
  private readonly m = new Map<string, EncryptedBlob>();
  async get(label: string): Promise<EncryptedBlob | undefined> {
    const b = this.m.get(label);
    return b ? { ...b } : undefined;
  }
  async put(label: string, blob: EncryptedBlob): Promise<void> {
    this.m.set(label, { ...blob });
  }
  async delete(label: string): Promise<void> {
    this.m.delete(label);
  }
  async list(): Promise<string[]> {
    return [...this.m.keys()].sort();
  }
}

/** Atomic text file write: tmp file + rename, mode 0600. */
export async function writeTextAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, text, { mode: 0o600 });
  await fs.rename(tmp, file);
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeTextAtomic(file, JSON.stringify(value, null, 2));
}

export async function readTextFile(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

export async function readJsonFile<T>(file: string): Promise<T | undefined> {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

/** One JSON file holding every blob, keyed by label. Only ciphertext is on disk. */
export class FileKeyStore implements KeyStore {
  constructor(readonly file: string) {}
  private async load(): Promise<Record<string, EncryptedBlob>> {
    return (await readJsonFile<Record<string, EncryptedBlob>>(this.file)) ?? {};
  }
  async get(label: string): Promise<EncryptedBlob | undefined> {
    return (await this.load())[label];
  }
  async put(label: string, blob: EncryptedBlob): Promise<void> {
    const all = await this.load();
    all[label] = blob;
    await writeJsonAtomic(this.file, all);
  }
  async delete(label: string): Promise<void> {
    const all = await this.load();
    delete all[label];
    await writeJsonAtomic(this.file, all);
  }
  async list(): Promise<string[]> {
    return Object.keys(await this.load()).sort();
  }
}

/**
 * The vault: a key-encryption key plus a store. Keypairs leave the vault only
 * as `Keypair` objects in memory; the store only ever holds ciphertext.
 */
export class KeyVault {
  readonly #kek: Uint8Array;
  constructor(kek: Uint8Array, readonly store: KeyStore) {
    assertKek(kek);
    this.#kek = new Uint8Array(kek);
  }

  async storeKeypair(label: string, keypair: Keypair): Promise<void> {
    await this.store.put(label, encryptKeypair(this.#kek, keypair, label));
  }

  async loadKeypair(label: string): Promise<Keypair> {
    const blob = await this.store.get(label);
    if (!blob) throw new KeyVaultError(`no key stored under label '${label}'`);
    return decryptKeypair(this.#kek, blob, label);
  }

  async hasKeypair(label: string): Promise<boolean> {
    return (await this.store.get(label)) !== undefined;
  }

  /** Generate, store encrypted, and return a new keypair. */
  async generateKeypair(label: string): Promise<Keypair> {
    if (await this.hasKeypair(label)) throw new KeyVaultError(`a key already exists under label '${label}'`);
    const kp = Keypair.generate();
    await this.storeKeypair(label, kp);
    return kp;
  }

  async storeSecret(label: string, bytes: Uint8Array): Promise<void> {
    await this.store.put(label, encryptBytes(this.#kek, bytes, label));
  }

  async loadSecret(label: string): Promise<Uint8Array> {
    const blob = await this.store.get(label);
    if (!blob) throw new KeyVaultError(`no secret stored under label '${label}'`);
    return decryptBytes(this.#kek, blob, label);
  }

  /** Decrypt a blob handed in from outside the store (e.g. QSD_PROTOCOL_CREATOR_SECRET). */
  decryptBlob(blob: EncryptedBlob, expectedLabel?: string): Keypair {
    return decryptKeypair(this.#kek, blob, expectedLabel);
  }

  encryptBlob(keypair: Keypair, label: string): EncryptedBlob {
    return encryptKeypair(this.#kek, keypair, label);
  }

  /** Never reveal the key through inspection. */
  toJSON(): { store: string } {
    return { store: this.store.constructor.name };
  }
}

export const CREATOR_KEY_LABEL = 'qsd/protocol-creator';

/**
 * Load the protocol creator keypair from `QSD_PROTOCOL_CREATOR_SECRET`: either
 * an inline JSON `EncryptedBlob` or a path to a file containing one.
 */
export async function loadCreatorKeypair(vault: KeyVault, secretOrPath: string | undefined): Promise<Keypair> {
  if (!secretOrPath) {
    if (await vault.hasKeypair(CREATOR_KEY_LABEL)) return vault.loadKeypair(CREATOR_KEY_LABEL);
    throw new KeyVaultError('QSD_PROTOCOL_CREATOR_SECRET is unset and the key store has no protocol creator key');
  }
  let text = secretOrPath.trim();
  if (!text.startsWith('{')) {
    try {
      text = await fs.readFile(text, 'utf8');
    } catch {
      throw new KeyVaultError('QSD_PROTOCOL_CREATOR_SECRET is neither an inline encrypted blob nor a readable file path');
    }
  }
  let blob: EncryptedBlob;
  try {
    blob = JSON.parse(text) as EncryptedBlob;
  } catch {
    throw new KeyVaultError('QSD_PROTOCOL_CREATOR_SECRET does not hold valid JSON');
  }
  return vault.decryptBlob(blob, CREATOR_KEY_LABEL);
}
