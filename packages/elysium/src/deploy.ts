import { getAddress, stringToHex, type Address, type Hash, type Hex, type PublicClient, type WalletClient } from 'viem';
import { predictedTokenAddress, tokenInitCode, type DeployArgs } from './token.js';

export interface DeployedToken {
  ca: Address;
  txHash: Hash;
  supply: bigint;
  /** Where the coin was created. There is no pump.fun path on Elysium. */
  path: 'elysium-erc20';
}

export interface DeployClients {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address;
}

/**
 * Deploy InfinitwapToken with CREATE at `nonce` (the nonce reserved at prediction time).
 * Two anchor transactions are sent before this one, so the launch reserves nonce+2.
 * Refuses to return a CA that is not the address predicted from that nonce.
 */
export async function deployInfinitwapToken(clients: DeployClients, args: DeployArgs & { nonce: bigint }): Promise<DeployedToken> {
  const expected = predictedTokenAddress(clients.account, args.nonce);
  const hash = await clients.walletClient.sendTransaction({
    account: clients.walletClient.account ?? clients.account,
    chain: clients.walletClient.chain,
    to: undefined,
    data: tokenInitCode(args),
    nonce: Number(args.nonce),
  } as Parameters<WalletClient['sendTransaction']>[0]);
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`token deploy reverted: ${hash}`);
  const ca = receipt.contractAddress ? getAddress(receipt.contractAddress) : null;
  if (!ca || ca.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`deployed address ${ca ?? 'missing'} is not the predicted ${expected}`);
  }
  return { ca, txHash: hash, supply: args.supply, path: 'elysium-erc20' };
}

/** Calldata for an anchor: the same `qsd:v1:<kind>:<hash>` memo the protocol already publishes, carried as tx input. */
export function anchorCalldata(kind: string, hashHex: string, nonceHex?: string): Hex {
  const body = nonceHex ? `qsd:v1:${kind}:${hashHex}:${nonceHex}` : `qsd:v1:${kind}:${hashHex}`;
  return stringToHex(body);
}

export interface AnchorSend {
  kind: string;
  hash: string;
  nonce?: string;
  txHash: Hash;
  blockNumber: number;
}

/** A 0-value self-call whose input is the anchor memo. Costs native HYPE gas only. */
export async function sendAnchor(
  clients: DeployClients,
  kind: string,
  hashHex: string,
  nonceHex?: string,
): Promise<AnchorSend> {
  const hash = await clients.walletClient.sendTransaction({
    account: clients.walletClient.account ?? clients.account,
    chain: clients.walletClient.chain,
    to: clients.account,
    value: 0n,
    data: anchorCalldata(kind, hashHex, nonceHex),
  } as Parameters<WalletClient['sendTransaction']>[0]);
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`anchor ${kind} reverted: ${hash}`);
  return { kind, hash: hashHex, ...(nonceHex !== undefined ? { nonce: nonceHex } : {}), txHash: hash, blockNumber: Number(receipt.blockNumber) };
}
