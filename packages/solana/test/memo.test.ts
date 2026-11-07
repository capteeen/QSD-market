import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { ANCHOR_MEMO_PREFIX, ChainError, MEMO_PROGRAM_ID, createAnchorMemoInstruction, createMemoInstruction, decodeAnchorMemo, encodeAnchorMemo } from '../src/index.js';

const h = 'ab'.repeat(32);
const n = 'cd'.repeat(32);

describe('memo instruction', () => {
  it('encodes qsd:v1:<kind>:<hex> and the precommit form', () => {
    expect(encodeAnchorMemo('proof', h)).toBe(`${ANCHOR_MEMO_PREFIX}:proof:${h}`);
    expect(encodeAnchorMemo('allocation-root', h)).toBe(`qsd:v1:allocation-root:${h}`);
    expect(encodeAnchorMemo('precommit', h, n)).toBe(`qsd:v1:precommit:${h}:${n}`);
    expect(decodeAnchorMemo(`qsd:v1:proof:${h}`)).toEqual({ kind: 'proof', hash: h });
    expect(decodeAnchorMemo(`qsd:v1:precommit:${h}:${n}`)).toEqual({ kind: 'precommit', hash: h, nonce: n });
    expect(decodeAnchorMemo('qsd:v1:proof:zz')).toBeUndefined();
  });

  it('rejects malformed inputs', () => {
    expect(() => encodeAnchorMemo('proof', 'AB'.repeat(32))).toThrow(ChainError);
    expect(() => encodeAnchorMemo('proof', h.slice(1))).toThrow(ChainError);
    expect(() => encodeAnchorMemo('precommit', h)).toThrow(/nonce/);
    expect(() => encodeAnchorMemo('proof', h, n)).toThrow(/no nonce/);
    expect(() => encodeAnchorMemo('bogus' as never, h)).toThrow(/unknown anchor kind/);
    expect(() => createMemoInstruction('')).toThrow(/empty/);
    expect(() => createMemoInstruction('x'.repeat(567))).toThrow(/max 566/);
  });

  it('builds a Memo-program instruction with the signer and utf8 data', () => {
    const signer = Keypair.generate().publicKey;
    const ix = createAnchorMemoInstruction('proof', h, signer);
    expect(ix.programId.equals(MEMO_PROGRAM_ID)).toBe(true);
    expect(ix.keys).toEqual([{ pubkey: signer, isSigner: true, isWritable: false }]);
    expect(Buffer.from(ix.data).toString('utf8')).toBe(`qsd:v1:proof:${h}`);
    expect(ix.data.length).toBe('qsd:v1:proof:'.length + 64);
  });
});
