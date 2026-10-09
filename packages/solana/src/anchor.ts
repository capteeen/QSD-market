/**
 * Proof anchoring: `qsd:v1:<kind>:<hex>` in a Memo instruction signed by the
 * protocol creator. Returns the real tx signature and emits `anchored` on the
 * ChainObserver for the scene's stage 7.
 */
import { createAnchorMemoInstruction } from './memo.js';
import type { AnchorKind, ChainObserver } from './observer.js';
import type { SentTransaction, TransactionSender } from './sender.js';
import { ChainUnavailableError } from './errors.js';

export interface AnchorResult {
  kind: AnchorKind;
  hash: string;
  /** Present for 'precommit' anchors. */
  nonce?: string;
  txSignature: string;
  lastValidBlockHeight: number;
  status: 'confirmed' | 'finalized';
}

export interface AnchorDeps {
  sender: TransactionSender;
  observer?: ChainObserver;
  /** Wait for confirmation (default true). */
  confirm?: boolean;
}

export async function anchorCommitment(hashHex: string, kind: AnchorKind, deps: AnchorDeps, nonceHex?: string): Promise<AnchorResult> {
  const { sender, observer } = deps;
  observer?.emit({ type: 'anchorRequested', kind, hash: hashHex });
  const ix = createAnchorMemoInstruction(kind, hashHex, sender.payer, nonceHex);
  const sent: SentTransaction = await sender.send([ix]);
  let status: AnchorResult['status'] = 'confirmed';
  if (deps.confirm !== false) {
    const s = await sender.confirm(sent.signature, sent.lastValidBlockHeight);
    if (s === 'failed' || s === 'expired') throw new ChainUnavailableError(`anchor transaction ${sent.signature} ${s}`);
    status = s === 'finalized' ? 'finalized' : 'confirmed';
  }
  observer?.emit({ type: 'anchored', kind, hash: hashHex, txSignature: sent.signature, cluster: sender.cluster });
  const out: AnchorResult = { kind, hash: hashHex, txSignature: sent.signature, lastValidBlockHeight: sent.lastValidBlockHeight, status };
  if (nonceHex !== undefined) out.nonce = nonceHex;
  return out;
}

/** A function-shaped anchor for composition (measure/collapse take this). */
export type AnchorFn = (hashHex: string, kind: AnchorKind, nonceHex?: string) => Promise<AnchorResult>;

export function anchorWith(deps: AnchorDeps): AnchorFn {
  return (hash, kind, nonce) => anchorCommitment(hash, kind, deps, nonce);
}
