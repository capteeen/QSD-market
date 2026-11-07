import 'server-only';
import path from 'node:path';
import { createPublicClient, createWalletClient, http, type Address, type Hash, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import {
  ELYSIUM_TESTNET_ALCHEMY_RPC,
  ELYSIUM_TESTNET_RPC,
  WHYPE_TESTNET,
  deployInfinitwapToken,
  elysiumTestnet,
  predictedTokenAddress,
  sendAnchor,
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

/** Anchor transactions sent before the token CREATE. The predicted address is nonce + this. */
export const ANCHORS_BEFORE_DEPLOY = 2n;

export interface ElysiumChain {
  network: 'testnet';
  whype: Address;
  publicClient: PublicClient;
  vault: KeyVault;
  reserve: IdentityReserve;
  observer: ChainObserver;
  creatorAddress(): Address;
  withCreator(): Promise<{
    address: Address;
    anchor: AnchorFn;
    predictedCa: Address;
    deployNonce: bigint;
    deployToken: (args: { name: string; symbol: string; supply: bigint; recipient: Address }) => Promise<{ ca: Address; txHash: Hash; supply: bigint; path: 'elysium-erc20' }>;
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
  const alchemy = env.ELYSIUM_ALCHEMY_API_KEY?.trim();
  if (alchemy) return `${ELYSIUM_TESTNET_ALCHEMY_RPC}${alchemy}`;
  return ELYSIUM_TESTNET_RPC;
}

const g = globalThis as unknown as { __qsdChain?: { chain?: ElysiumChain; error?: string } };

function build(env: NodeJS.ProcessEnv): ElysiumChain {
  const network = (env.ELYSIUM_NETWORK ?? 'testnet').trim();
  if (network === 'mainnet') {
    throw new Error('ELYSIUM_NETWORK=mainnet is refused: Elysium mainnet chain ID, RPC and explorer are not published yet');
  }
  if (network !== 'testnet') throw new Error("ELYSIUM_NETWORK must be 'testnet'");
  const kek = readHex32('QSD_KEY_ENCRYPTION_KEY', env.QSD_KEY_ENCRYPTION_KEY);
  const account: PrivateKeyAccount = privateKeyToAccount(readPrivateKey(env.ELYSIUM_DEPLOYER_PRIVATE_KEY));
  const rpcUrl = rpcUrlFromEnv(env);
  const storage = chainStorageFromEnv(env);
  const keyStore = storage?.keyStore ?? (env.QSD_KEYSTORE_PATH?.trim() ? new FileKeyStore(env.QSD_KEYSTORE_PATH.trim()) : new MemoryKeyStore());
  const vault = new KeyVault(kek, keyStore);
  const backend = storage?.reserveBackend ?? (env.QSD_KEYSTORE_PATH?.trim() ? new FileReserveBackend(`${env.QSD_KEYSTORE_PATH.trim()}.reserve.json`) : new MemoryReserveBackend());
  const reserve = new IdentityReserve(vault, backend);
  const observer = new ChainObserver();
  const publicClient = createPublicClient({ chain: elysiumTestnet, transport: http(rpcUrl) });
  const walletClient: WalletClient = createWalletClient({ account, chain: elysiumTestnet, transport: http(rpcUrl) });
  const journalDir = env.QSD_JOURNAL_DIR?.trim();
  const clients = { publicClient, walletClient, account: account.address };

  const chain: ElysiumChain = {
    network: 'testnet',
    whype: WHYPE_TESTNET,
    publicClient,
    vault,
    reserve,
    observer,
    creatorAddress: () => account.address,
    async withCreator() {
      const startNonce = BigInt(await publicClient.getTransactionCount({ address: account.address, blockTag: 'pending' }));
      const deployNonce = startNonce + ANCHORS_BEFORE_DEPLOY;
      const anchor: AnchorFn = async (hashHex, kind, nonceHex) => {
        observer.emit({ type: 'anchorRequested', kind, hash: hashHex });
        const sent = await sendAnchor(clients, kind, hashHex, nonceHex);
        observer.emit({ type: 'anchored', kind, hash: hashHex, txSignature: sent.txHash, cluster: 'testnet' });
        const result: AnchorResult = { kind, hash: hashHex, txSignature: sent.txHash, lastValidBlockHeight: sent.blockNumber, status: 'confirmed' };
        if (nonceHex !== undefined) result.nonce = nonceHex;
        return result;
      };
      return {
        address: account.address,
        anchor,
        predictedCa: predictedTokenAddress(account.address, deployNonce),
        deployNonce,
        deployToken: (args) => deployInfinitwapToken(clients, { ...args, nonce: deployNonce }),
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

export function chainStatus(): { configured: boolean; cluster: 'testnet' | 'mainnet' | null; reason: string | null } {
  const s = init();
  if (s.chain) return { configured: true, cluster: 'testnet', reason: null };
  return { configured: false, cluster: null, reason: s.error ?? null };
}

/** Testnet until Kinetiq publishes mainnet. A refused mainnet flag still reports testnet, which is the only network this build can talk to. */
export function serverCluster(): 'testnet' | 'mainnet' {
  return 'testnet';
}
