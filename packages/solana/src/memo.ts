/**
 * Memo program instruction, built by hand (no @solana/spl-memo dependency).
 * Program: MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr (Memo v2).
 * Data is the UTF-8 memo; signers listed as keys must sign the transaction.
 */
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { ChainError } from './errors.js';
import type { AnchorKind } from './observer.js';

export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const ANCHOR_MEMO_PREFIX = 'qsd:v1';
/** Memo v2 rejects memos longer than this many bytes. */
export const MEMO_MAX_BYTES = 566;

export function createMemoInstruction(memo: string, signers: PublicKey[] = []): TransactionInstruction {
  const data = Buffer.from(memo, 'utf8');
  if (data.length === 0) throw new ChainError('memo must not be empty');
  if (data.length > MEMO_MAX_BYTES) throw new ChainError(`memo is ${data.length} bytes; max ${MEMO_MAX_BYTES}`);
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: signers.map((pubkey) => ({ pubkey, isSigner: true, isWritable: false })),
    data,
  });
}

export const ANCHOR_KINDS: readonly AnchorKind[] = ['precommit', 'proof', 'allocation-root'];
const HEX32 = /^[0-9a-f]{64}$/;

/**
 * The exact string anchored on-chain:
 *   `qsd:v1:proof:<bundleHash>`                      after a measurement
 *   `qsd:v1:allocation-root:<merkleRoot>`            before an airdrop
 *   `qsd:v1:precommit:<inputsHash>:<nonce>`          BEFORE the QRNG draw (security.md H-Q3):
 *     inputsHash = hashJson(measurementInputs), nonce = 32 random bytes, both hex.
 */
export function encodeAnchorMemo(kind: AnchorKind, hashHex: string, nonceHex?: string): string {
  if (!ANCHOR_KINDS.includes(kind)) throw new ChainError(`unknown anchor kind '${String(kind)}'`);
  if (!HEX32.test(hashHex)) throw new ChainError('anchor hash must be 64 lowercase hex characters (sha256)');
  if (kind === 'precommit') {
    if (nonceHex === undefined || !HEX32.test(nonceHex)) throw new ChainError('precommit anchors need a 32-byte nonce (64 lowercase hex)');
    return `${ANCHOR_MEMO_PREFIX}:${kind}:${hashHex}:${nonceHex}`;
  }
  if (nonceHex !== undefined) throw new ChainError(`anchor kind '${kind}' takes no nonce`);
  return `${ANCHOR_MEMO_PREFIX}:${kind}:${hashHex}`;
}

export interface DecodedAnchorMemo {
  kind: AnchorKind;
  hash: string;
  nonce?: string;
}

export function decodeAnchorMemo(memo: string): DecodedAnchorMemo | undefined {
  const m = /^qsd:v1:(proof|allocation-root):([0-9a-f]{64})$/.exec(memo);
  if (m) return { kind: m[1] as AnchorKind, hash: m[2] as string };
  const p = /^qsd:v1:precommit:([0-9a-f]{64}):([0-9a-f]{64})$/.exec(memo);
  if (p) return { kind: 'precommit', hash: p[1] as string, nonce: p[2] as string };
  return undefined;
}

export function createAnchorMemoInstruction(kind: AnchorKind, hashHex: string, signer: PublicKey, nonceHex?: string): TransactionInstruction {
  return createMemoInstruction(encodeAnchorMemo(kind, hashHex, nonceHex), [signer]);
}
