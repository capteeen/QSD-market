import {
  decodeEventLog,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import launcherArtifactJson from '../artifacts/InfinitwapLauncher.json';
import launcherV3ArtifactJson from '../artifacts/InfinitwapLauncherV3.json';
import type { DeployClients } from './deploy.js';
import { compiledArtifact, infinitwapTokenArtifact, type DeployArgs, type TokenArtifact } from './token.js';

export function launcherArtifact(): TokenArtifact {
  return compiledArtifact(launcherArtifactJson, 'InfinitwapLauncher');
}

/** solc 0.8 CBOR: `{"ipfs": <32 bytes>, "solc": <3 bytes>}`. */
const TOKEN_META_PREFIX = 'a2646970667358221220';

/**
 * Creation code of InfinitwapToken as the launcher bytecode actually embeds it.
 * A standalone token artifact has different compiler metadata, so CREATE2 from
 * that artifact is a different address than `new InfinitwapToken{salt}(...)`.
 */
export function tokenCreationCodeInLauncher(launcherCreation: Hex, tokenCreation: Hex): Hex {
  const token = tokenCreation.slice(2).toLowerCase();
  const meta = token.lastIndexOf(TOKEN_META_PREFIX);
  if (meta < 0) throw new Error('InfinitwapToken bytecode has no compiler metadata');
  const body = token.slice(0, meta);
  const launcher = launcherCreation.slice(2).toLowerCase();
  const at = launcher.indexOf(body);
  if (at < 0) throw new Error('launcher bytecode does not contain InfinitwapToken');
  const hashEnd = at + body.length + TOKEN_META_PREFIX.length + 64;
  const tail = launcher.slice(hashEnd, hashEnd + 22);
  if (!tail.startsWith('64736f6c6343') || !tail.endsWith('0033')) throw new Error('launcher bytecode metadata for InfinitwapToken is not the solc suffix');
  return `0x${launcher.slice(at, hashEnd + 22)}`;
}

/** Init code the v3 launcher uses for CREATE2. Constructor args are name, symbol, supply, and the launcher. */
export function poolTokenInitCode(args: DeployArgs): Hex {
  const token = infinitwapTokenArtifact();
  const creation = tokenCreationCodeInLauncher(launcherV3Artifact().bytecode, token.bytecode);
  return encodeDeployData({ abi: token.abi, bytecode: creation, args: [args.name, args.symbol, args.supply, args.recipient] });
}

/** CREATE2 address of the token a launcher deploys. The v3 open mints to the launcher so it can deposit the supply. */
export function predictedPoolTokenAddress(launcher: Address, salt: Hex, args: DeployArgs): Address {
  return getContractAddress({
    bytecode: poolTokenInitCode(args),
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
  path: 'elysium-v2' | 'elysium-v3';
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

export function launcherV3Artifact(): TokenArtifact {
  return compiledArtifact(launcherV3ArtifactJson, 'InfinitwapLauncherV3');
}

export async function deployLauncherV3(clients: DeployClients, positionManager: Address, swapRouter: Address): Promise<Address> {
  const art = launcherV3Artifact();
  const hash = await clients.walletClient.sendTransaction({
    account: clients.walletClient.account ?? clients.account,
    chain: clients.walletClient.chain,
    data: encodeDeployData({ abi: art.abi, bytecode: art.bytecode, args: [positionManager, swapRouter] }),
  } as Parameters<DeployClients['walletClient']['sendTransaction']>[0]);
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`launcher deploy reverted: ${hash}`);
  return getAddress(receipt.contractAddress);
}

export interface V3LaunchArgs {
  launcher: Address;
  name: string;
  symbol: string;
  supply: bigint;
  creator: Address;
  firstBuyWei: bigint;
  salt: Hex;
}

/** One transaction: deploy the token, open a one-sided Uniswap v3 range with 0 WHYPE, lock the position, fill the optional first buy. */
export async function launchWithV3(clients: DeployClients, args: V3LaunchArgs): Promise<PooledLaunch> {
  const art = launcherV3Artifact();
  const expected = predictedPoolTokenAddress(args.launcher, args.salt, {
    name: args.name,
    symbol: args.symbol,
    supply: args.supply,
    recipient: args.launcher,
  });
  const data = encodeFunctionData({
    abi: art.abi,
    functionName: 'launch',
    args: [args.name, args.symbol, args.supply, args.creator, args.firstBuyWei, args.salt],
  });
  const hash = await clients.walletClient.sendTransaction({
    account: clients.walletClient.account ?? clients.account,
    chain: clients.walletClient.chain,
    to: args.launcher,
    data,
    value: args.firstBuyWei,
  } as Parameters<DeployClients['walletClient']['sendTransaction']>[0]);
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`pool launch reverted: ${hash}`);

  let token: Address | null = null;
  let pool: Address | null = null;
  let tokensOut = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== args.launcher.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: art.abi, data: log.data, topics: log.topics });
      if (decoded.eventName !== 'Launched') continue;
      const launched = decoded.args as unknown as { token: Address; pool: Address; tokensOut: bigint };
      token = getAddress(launched.token);
      pool = getAddress(launched.pool);
      tokensOut = launched.tokensOut;
    } catch {
      // not this event
    }
  }
  if (!token || token.toLowerCase() !== expected.toLowerCase()) throw new Error(`deployed ${token ?? 'missing'} is not the predicted ${expected}`);
  if (!pool || pool === '0x0000000000000000000000000000000000000000') throw new Error('pool launch did not open a pool');
  return { ca: token, txHash: hash, supply: args.supply, pair: pool, tokensOut, path: 'elysium-v3' };
}
