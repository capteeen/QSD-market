import type { Address, Hash, PublicClient } from 'viem';

export interface NativeTransfer {
  hash: Hash;
  from: Address;
  to: Address | null;
  value: bigint;
  status: 'success' | 'reverted';
}

export class PaymentReadError extends Error {
  override readonly name = 'PaymentReadError';
}

/**
 * A confirmed native HYPE transfer. `null` when the node has no such transaction.
 * Reverted receipts are returned (status `reverted`) so the caller can refuse them.
 */
export async function readNativeTransfer(client: PublicClient, hash: Hash): Promise<NativeTransfer | null> {
  const tx = await client.getTransaction({ hash });
  if (!tx) return null;
  const receipt = await client.getTransactionReceipt({ hash });
  if (!receipt) return null;
  return {
    hash,
    from: tx.from,
    to: tx.to,
    value: tx.value,
    status: receipt.status === 'success' ? 'success' : 'reverted',
  };
}
