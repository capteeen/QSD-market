/**
 * Generate the secrets qsd.market needs that no outside service hands you:
 *
 *   QSD_KEY_ENCRYPTION_KEY       32 random bytes (hex) that encrypt every key at rest
 *   QSD_PROTOCOL_CREATOR_SECRET  the creator / fee wallet, encrypted under that key
 *   QSD_FEE_WALLET               the creator wallet's public address (fund this with SOL)
 *   QSD_WITNESS_SECRET_KEY       Ed25519 seed that signs each QRNG response
 *   QSD_WITNESS_PUBLIC_KEYS      its public key (also NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS)
 *   QSD_WEBHOOK_SECRET           shared secret registered with the Helius webhook
 *
 * Usage:
 *   pnpm --filter @qsd/solana generate-secrets                      # new creator wallet
 *   pnpm --filter @qsd/solana generate-secrets ~/creator.json       # encrypt an existing Solana CLI keypair file
 *   QSD_KEY_ENCRYPTION_KEY=<hex> pnpm --filter @qsd/solana generate-secrets   # reuse an existing key
 *
 * Runs offline. Prints dotenv lines to stdout; nothing is written to disk or sent anywhere.
 * Treat the output as secret: store it in your password manager and your host's env settings.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { CREATOR_KEY_LABEL, encryptKeypair } from '../src/index.js';

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

function keyEncryptionKey(): Uint8Array {
  const existing = process.env.QSD_KEY_ENCRYPTION_KEY?.trim();
  if (!existing) return new Uint8Array(randomBytes(32));
  if (!/^[0-9a-fA-F]{64}$/.test(existing)) throw new Error('QSD_KEY_ENCRYPTION_KEY must be 64 hex characters');
  return new Uint8Array(Buffer.from(existing, 'hex'));
}

function creatorKeypair(path: string | undefined): Keypair {
  if (!path) return Keypair.generate();
  const bytes = JSON.parse(readFileSync(path, 'utf8')) as number[];
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error(`${path} is not a Solana CLI keypair file (a JSON array of 64 numbers)`);
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

const kek = keyEncryptionKey();
const creator = creatorKeypair(process.argv[2]);
const witnessSeed = new Uint8Array(randomBytes(32));
// A Solana keypair is a plain Ed25519 keypair, so its public key is the witness public key for this seed.
const witnessPublic = Keypair.fromSeed(witnessSeed).publicKey.toBytes();

const lines = [
  `# generated ${new Date().toISOString()} — secret, do not commit`,
  `QSD_KEY_ENCRYPTION_KEY=${hex(kek)}`,
  `QSD_PROTOCOL_CREATOR_SECRET='${JSON.stringify(encryptKeypair(kek, creator, CREATOR_KEY_LABEL))}'`,
  `QSD_FEE_WALLET=${creator.publicKey.toBase58()}`,
  `QSD_WITNESS_SECRET_KEY=${hex(witnessSeed)}`,
  `QSD_WITNESS_PUBLIC_KEYS=${hex(witnessPublic)}`,
  `NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS=${hex(witnessPublic)}`,
  `QSD_WEBHOOK_SECRET=${randomBytes(32).toString('base64url')}`,
];
process.stdout.write(lines.join('\n') + '\n');
process.stderr.write(`\nCreator / fee wallet: ${creator.publicKey.toBase58()}\nFund it with SOL before launching; every launch and collapse is paid from it.\n`);
