import 'server-only';
import path from 'node:path';
import { createPublicClient, createWalletClient, getAddress, http, isAddress, type Address, type Hash, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import {
  ELYSIUM_MAINNET_ALCHEMY_RPC,
  ELYSIUM_MAINNET_PUBLIC_RPC,
  ELYSIUM_TESTNET_ALCHEMY_RPC,
  ELYSIUM_TESTNET_RPC,
  UNISWAP_V3_POSITION_MANAGER_MAINNET,
  UNISWAP_V3_ROUTER_MAINNET,
  WHYPE_MAINNET,
  WHYPE_TESTNET,
  deployInfinitwapToken,
  deployLauncherV3,
  elysiumMainnet,
  elysiumTestnet,
  launchWithV3,
  predictedTokenAddress,
  sendAnchor,
  type PooledLaunch,
} from '@qsd/elysium';
import {
  ChainObserver,
  FileJournalStore,
  FileKeyStore,
  FileReserveBackend,
  IdentityReserve,
  KeyVault,
  MemoryJournalStore,
  MemoryKeyStore,
  MemoryReserveBackend,
  type AnchorFn,
  type AnchorResult,
  type JournalStore,
} from '@qsd/solana';
import { chainStorageFromEnv } from './chainStorage';

/** Anchor transactions sent before the token CREATE on testnet. The predicted address is nonce + this. */
export const ANCHORS_BEFORE_DEPLOY = 2n;

export type ElysiumNetwork = 'testnet' | 'mainnet';

export interface PoolOpenArgs {
  name: string;
  symbol: string;
  supply: bigint;
  creator: Address;
  firstBuyWei: bigint;
  seedWei: bigint;
  salt: Hex;
}

export interface ElysiumChain {
  network: ElysiumNetwork;
  whype: Address;
  publicClient: PublicClient;
  vault: KeyVault;
  reserve: IdentityReserve;
  observer: ChainObserver;
  creatorAddress(): Address;
  creatorBalance(): Promise<bigint>;
  withCreator(): Promise<{
    address: Address;
    anchor: AnchorFn;
    /** Testnet CREATE address. Mainnet predicts with `predictedPoolTokenAddress` instead. */
    predictedCa: Address;
    deployNonce: bigint;
    /** Set on mainnet: the launcher that opens the one-sided Uniswap v3 pool. */
    launcher?: Address;
    deployToken: (args: { name: string; symbol: string; supply: bigint; recipient: Address }) => Promise<{ ca: Address; txHash: Hash; supply: bigint; path: 'elysium-erc20' }>;
    openPool?: (args: PoolOpenArgs) => Promise<PooledLaunch>;
    balanceWei: () => Promise<bigint>;
  }>;
  journal<T>(name: string): JournalStore<T>;
}

function readHex32(name: string, value: string | undefined): Uint8Array {
  if (!value || !/^[0-9a-fA-F]{64}$/.test(value.trim())) {
    throw new Error(`${name} is required (64 hex chars = 32 bytes)`);
  }
  const s = value.trim();
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function readPrivateKey(value: string | undefined): `0x${string}` {
  const hex = (value?.trim() ?? '').replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('ELYSIUM_DEPLOYER_PRIVATE_KEY is required (32-byte hex); the value is not shown');
  }
  return `0x${hex}`;
}

export function rpcUrlFromEnv(env: NodeJS.ProcessEnv): string {
  const explicit = env.ELYSIUM_RPC_URL?.trim();
  if (explicit) {
    if (!/^https?:\/\//.test(explicit)) throw new Error('ELYSIUM_RPC_URL must be an http(s) URL');
    return explicit;
  }
  const network = networkFromEnv(env);
  const alchemy = env.ELYSIUM_ALCHEMY_API_KEY?.trim();
  if (alchemy) return `${network === 'mainnet' ? ELYSIUM_MAINNET_ALCHEMY_RPC : ELYSIUM_TESTNET_ALCHEMY_RPC}${alchemy}`;
  return network === 'mainnet' ? ELYSIUM_MAINNET_PUBLIC_RPC : ELYSIUM_TESTNET_RPC;
}

export function networkFromEnv(env: NodeJS.ProcessEnv): ElysiumNetwork {
  const network = (env.ELYSIUM_NETWORK ?? 'mainnet').trim();
  if (network !== 'mainnet' && network !== 'testnet') throw new Error("ELYSIUM_NETWORK must be 'mainnet' or 'testnet'");
  return network;
}

const LAUNCHER_KEY = 'elysium/launcher/v3';
const launcherMemo = globalThis as unknown as { __qsdLauncherV3?: Promise<Address> };

async function ensureLauncher(
  clients: { publicClient: PublicClient; walletClient: WalletClient; account: Address },
): Promise<Address> {
  if (!launcherMemo.__qsdLauncherV3) {
    launcherMemo.__qsdLauncherV3 = loadOrDeployLauncher(clients).catch((e: unknown) => {
      delete launcherMemo.__qsdLauncherV3;
      throw e;
    });
  }
  return launcherMemo.__qsdLauncherV3;
}

async function loadOrDeployLauncher(
  clients: { publicClient: PublicClient; walletClient: WalletClient; account: Address },
): Promise<Address> {
  const fromEnv = process.env.INFINITWAP_LAUNCHER?.trim();
  const stored = fromEnv && isAddress(fromEnv) ? getAddress(fromEnv) : await readStoredLauncher();
  if (fromEnv && !isAddress(fromEnv)) throw new Error('INFINITWAP_LAUNCHER is not an address');
  if (stored) {
    const code = await clients.publicClient.getCode({ address: stored });
    if (code && code !== '0x') return stored;
    if (fromEnv) throw new Error('INFINITWAP_LAUNCHER has no contract code on this chain');
  }
  const deployed = await deployLauncherV3(clients, UNISWAP_V3_POSITION_MANAGER_MAINNET, UNISWAP_V3_ROUTER_MAINNET);
  await rememberLauncher(deployed);
  return deployed;
}

async function readStoredLauncher(): Promise<Address | null> {
  try {
    const { db } = await import('./db');
    const row = await db().chainKv.findUnique({ where: { key: LAUNCHER_KEY } });
    return row && isAddress(row.value) ? getAddress(row.value) : null;
  } catch {
    return null;
  }
}

async function rememberLauncher(address: Address): Promise<void> {
  try {
    const { db } = await import('./db');
    await db().chainKv.upsert({
      where: { key: LAUNCHER_KEY },
      create: { key: LAUNCHER_KEY, value: address, version: 1 },
      update: { value: address },
    });
  } catch {
    // the in-memory promise still returns this address for the rest of the process
  }
}

const g = globalThis as unknown as { __qsdChain?: { chain?: ElysiumChain; error?: string } };

function build(env: NodeJS.ProcessEnv): ElysiumChain {
  const network = networkFromEnv(env);
  const kek = readHex32('the launch encryption key', env.QSD_KEY_ENCRYPTION_KEY);
  const account: PrivateKeyAccount = privateKeyToAccount(readPrivateKey(env.ELYSIUM_DEPLOYER_PRIVATE_KEY));
  const rpcUrl = rpcUrlFromEnv(env);
  const chainDef = network === 'mainnet' ? elysiumMainnet : elysiumTestnet;
  const storage = chainStorageFromEnv(env);
  const keyStore = storage?.keyStore ?? (env.QSD_KEYSTORE_PATH?.trim() ? new FileKeyStore(env.QSD_KEYSTORE_PATH.trim()) : new MemoryKeyStore());
  const vault = new KeyVault(kek, keyStore);
  const backend = storage?.reserveBackend ?? (env.QSD_KEYSTORE_PATH?.trim() ? new FileReserveBackend(`${env.QSD_KEYSTORE_PATH.trim()}.reserve.json`) : new MemoryReserveBackend());
  const reserve = new IdentityReserve(vault, backend);
  const observer = new ChainObserver();
  const publicClient = createPublicClient({ chain: chainDef, transport: http(rpcUrl) });
  const walletClient: WalletClient = createWalletClient({ account, chain: chainDef, transport: http(rpcUrl) });
  const journalDir = env.QSD_JOURNAL_DIR?.trim();
  const clients = { publicClient, walletClient, account: account.address };

  const chain: ElysiumChain = {
    network,
    whype: network === 'mainnet' ? WHYPE_MAINNET : WHYPE_TESTNET,
    publicClient,
    vault,
    reserve,
    observer,
    creatorAddress: () => account.address,
    creatorBalance: () => publicClient.getBalance({ address: account.address }),
    async withCreator() {
      const launcher = network === 'mainnet' ? await ensureLauncher(clients) : undefined;
      const startNonce = BigInt(await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' }));
      const deployNonce = startNonce + ANCHORS_BEFORE_DEPLOY;
      const anchor: AnchorFn = async (hashHex, kind, nonceHex) => {
        observer.emit({ type: 'anchorRequested', kind, hash: hashHex });
        const sent = await sendAnchor(clients, kind, hashHex, nonceHex);
        observer.emit({ type: 'anchored', kind, hash: hashHex, txSignature: sent.txHash, cluster: network });
        const result: AnchorResult = { kind, hash: hashHex, txSignature: sent.txHash, lastValidBlockHeight: sent.blockNumber, status: 'confirmed' };
        if (nonceHex !== undefined) result.nonce = nonceHex;
        return result;
      };
      return {
        address: account.address,
        anchor,
        predictedCa: predictedTokenAddress(account.address, deployNonce),
        deployNonce,
        ...(launcher ? { launcher } : {}),
        deployToken: (args) => deployInfinitwapToken(clients, { ...args, nonce: deployNonce }),
        ...(launcher
          ? {
              openPool: (args: PoolOpenArgs) =>
                launchWithV3(clients, {
                  launcher,
                  name: args.name,
                  symbol: args.symbol,
                  supply: args.supply,
                  creator: args.creator,
                  firstBuyWei: args.firstBuyWei,
                  salt: args.salt,
                }),
            }
          : {}),
        balanceWei: () => publicClient.getBalance({ address: account.address }),
      };
    },
    journal<T>(name: string): JournalStore<T> {
      if (storage) return storage.journal<T>(name);
      if (!journalDir) return new MemoryJournalStore<T>();
      return new FileJournalStore<T>(path.join(journalDir, `${name}.json`));
    },
  };
  return chain;
}

function init(): { chain?: ElysiumChain; error?: string } {
  if (!g.__qsdChain) {
    try {
      g.__qsdChain = { chain: build(process.env) };
    } catch (e) {
      g.__qsdChain = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return g.__qsdChain;
}

export function getChain(): ElysiumChain {
  const s = init();
  if (!s.chain) throw new Error(`the chain is not configured: ${s.error ?? 'unknown'}`);
  return s.chain;
}

export function chainStatus(): { configured: boolean; cluster: ElysiumNetwork | null; reason: string | null } {
  const s = init();
  if (s.chain) return { configured: true, cluster: s.chain.network, reason: null };
  return { configured: false, cluster: null, reason: s.error ?? null };
}

/** Elysium mainnet (chain 99901) unless ELYSIUM_NETWORK=testnet. */
export function serverCluster(): ElysiumNetwork {
  return (process.env.ELYSIUM_NETWORK ?? 'mainnet').trim() === 'testnet' ? 'testnet' : 'mainnet';
}
