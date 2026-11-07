import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeEventLog,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import type { DeployClients } from './deploy.js';
import { tokenInitCode, type DeployArgs, type TokenArtifact } from './token.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function launcherArtifact(): TokenArtifact {
  const file = path.resolve(here, '../artifacts/InfinitwapLauncher.json');
  const json = JSON.parse(readFileSync(file, 'utf8')) as { abi: Abi; bytecode: { object: Hex } };
  if (!json.bytecode?.object || json.bytecode.object === '0x') throw new Error('InfinitwapLauncher bytecode is missing; run forge build in packages/elysium/contracts');
  return { abi: json.abi, bytecode: json.bytecode.object };
}

/** CREATE2 address of the token `launch` deploys. The init-code recipient is the creator when the seed is zero, and the launcher when the seed is added as liquidity. */
export function predictedPoolTokenAddress(launcher: Address, salt: Hex, args: DeployArgs): Address {
  return getContractAddress({
    bytecode: tokenInitCode(args),
    from: launcher,
    opcode: 'CREATE2',
    salt,
  });
}

export async function deployLauncher(clients: DeployClients, router: Address): Promise<Address> {
  const art = launcherArtifact();
  const hash = await clients.walletClient.sendTransaction({
    account: clients.walletClient.account ?? clients.account,
    chain: clients.walletClient.chain,
    data: encodeDeployData({ abi: art.abi, bytecode: art.bytecode, args: [router] }),
  } as Parameters<DeployClients['walletClient']['sendTransaction']>[0]);
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`launcher deploy reverted: ${hash}`);
  return getAddress(receipt.contractAddress);
}

export interface PooledLaunch {
  ca: Address;
  txHash: Hash;
  supply: bigint;
  pair: Address;
  tokensOut: bigint;
  path: 'elysium-v2';
}

export interface PoolLaunchArgs {
  launcher: Address;
  name: string;
  symbol: string;
  supply: bigint;
  creator: Address;
  firstBuyWei: bigint;
  seedWei: bigint;
  salt: Hex;
}

/** One transaction: deploy the token, seed the Uniswap v2 pool, burn the LP, fill the first buy. */
export async function launchWithPool(clients: DeployClients, args: PoolLaunchArgs): Promise<PooledLaunch> {
  const art = launcherArtifact();
  const expected = predictedPoolTokenAddress(args.launcher, args.salt, {
    name: args.name,
    symbol: args.symbol,
    supply: args.supply,
    recipient: args.seedWei === 0n ? args.creator : args.launcher,
  });
  const data = encodeFunctionData({
    abi: art.abi,
    functionName: 'launch',
    args: [args.name, args.symbol, args.supply, args.creator, args.firstBuyWei, args.seedWei, args.salt],
  });
  const hash = await clients.walletClient.sendTransaction({
    account: clients.walletClient.account ?? clients.account,
    chain: clients.walletClient.chain,
    to: args.launcher,
    data,
    value: args.seedWei + args.firstBuyWei,
  } as Parameters<DeployClients['walletClient']['sendTransaction']>[0]);
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`pool launch reverted: ${hash}`);

  let token: Address | null = null;
  let pair: Address | null = null;
  let tokensOut = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== args.launcher.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: art.abi, data: log.data, topics: log.topics });
      if (decoded.eventName !== 'Launched') continue;
      const launched = decoded.args as unknown as { token: Address; pair: Address; tokensOut: bigint };
      token = getAddress(launched.token);
      pair = getAddress(launched.pair);
      tokensOut = launched.tokensOut;
    } catch {
      // not this event
    }
  }
  if (!token || token.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`deployed ${token ?? 'missing'} is not the predicted ${expected}`);
  }
  if (!pair) throw new Error('pool launch did not report a pair');
  if (args.seedWei > 0n && pair === '0x0000000000000000000000000000000000000000') throw new Error('pool launch did not open a pair');
  return { ca: token, txHash: hash, supply: args.supply, pair, tokensOut, path: 'elysium-v2' };
}
