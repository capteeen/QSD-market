import 'server-only';
import { randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import { ed25519Verify, bytesToHex } from '@qsd/quantum';
import { db } from './db';

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function challengeMessage(purpose: string, wallet: string, nonce: string, subject: string): string {
  return `qsd.market\npurpose: ${purpose}\nwallet: ${wallet}\nsubject: ${subject}\nnonce: ${nonce}`;
}

/** Issue a one-time nonce the wallet must sign (stored in Postgres with a TTL). */
export async function issueChallenge(purpose: string, wallet: string, subject: string): Promise<{ nonce: string; message: string; expiresAt: string }> {
  const nonce = randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await db().authChallenge.create({ data: { nonce, wallet, purpose, expiresAt } });
  return { nonce, message: challengeMessage(purpose, wallet, nonce, subject), expiresAt: expiresAt.toISOString() };
}

export class AuthError extends Error {
  override readonly name = 'AuthError';
}

/** Verify an Ed25519 signature over the challenge message and consume the nonce. */
export async function verifyChallenge(args: { purpose: string; wallet: string; subject: string; nonce: string; signature: string }): Promise<void> {
  const { purpose, wallet, subject, nonce, signature } = args;
  if (!wallet || !nonce || !signature) throw new AuthError('wallet, nonce and signature are required');
  const row = await db().authChallenge.findUnique({ where: { nonce } });
  if (!row || row.wallet !== wallet || row.purpose !== purpose) throw new AuthError('unknown challenge');
  if (row.usedAt) throw new AuthError('challenge already used');
  if (row.expiresAt.getTime() < Date.now()) throw new AuthError('challenge expired');
  let pk: Uint8Array;
  let sig: Uint8Array;
  try {
    pk = bs58.decode(wallet);
    sig = /^[0-9a-f]{128}$/i.test(signature) ? Buffer.from(signature, 'hex') : bs58.decode(signature);
  } catch {
    throw new AuthError('malformed wallet or signature');
  }
  const msg = new TextEncoder().encode(challengeMessage(purpose, wallet, nonce, subject));
  if (!ed25519Verify(bytesToHex(sig), msg, bytesToHex(pk))) throw new AuthError('signature does not verify for this wallet');
  await db().authChallenge.update({ where: { nonce }, data: { usedAt: new Date() } });
}
