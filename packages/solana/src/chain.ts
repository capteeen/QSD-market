/**
 * Wire everything from a ChainConfig. The app calls `createChain(config)`
 * once and gets senders, readers, the vault, the identity reserve and the
 * snapshot sources, all behind env. Nothing here touches the network until
 * a method is called.
 */
import { Connection, Keypair } from '@solana/web3.js';
import { MINT_SIZE } from '@solana/spl-token';
import path from 'node:path';
import { anchorWith, type AnchorFn } from './anchor.js';
import { web3TransferSender, type TransferSender, FileAirdropJournal } from './airdrop.js';
import { Web3FeeLedger, type FeeLedger } from './burn.js';
import { heliusRpcUrl, type ChainConfig } from './config.js';
import { ChainConfigError } from './errors.js';
import { FileJournalStore, MemoryJournalStore, type JournalStore } from './journal.js';
import { FileKeyStore, KeyVault, MemoryKeyStore, loadCreatorKeypair } from './keys.js';
import { ChainObserver } from './observer.js';
import { FileReserveBackend, IdentityReserve, MemoryReserveBackend } from './reserve.js';
import { Web3ChainReader, Web3TransactionSender, createConnection, type ChainReader, type TransactionSender } from './sender.js';
import { HeliusDasSource, ProgramAccountsSource, type TokenAccountSource } from './snapshot.js';

export interface Chain {
  config: ChainConfig;
  connection: Connection;
  vault: KeyVault;
  reserve: IdentityReserve;
  observer: ChainObserver;
  snapshotSources: TokenAccountSource[];
  feeLedger: FeeLedger;
  /** Loads the protocol creator keypair (decrypted in memory only). */
  creator(): Promise<Keypair>;
  /** Sender + reader + transfer sender + anchor bound to the creator. */
  withCreator(): Promise<{ creator: Keypair; sender: TransactionSender; reader: ChainReader; transferSender: TransferSender; anchor: AnchorFn; getMintRentLamports: () => Promise<number> }>;
  journal<T>(name: string): JournalStore<T>;
  airdropJournal(daughterCa: string): FileAirdropJournal | MemoryJournalStore<never>;
}

export function createChain(config: ChainConfig): Chain {
  const connection = createConnection(config.rpcUrl);
  const keyStore = config.keystorePath ? new FileKeyStore(config.keystorePath) : new MemoryKeyStore();
  const vault = new KeyVault(config.keyEncryptionKey, keyStore);
  const backend = config.keystorePath ? new FileReserveBackend(`${config.keystorePath}.reserve.json`) : new MemoryReserveBackend();
  const reserve = new IdentityReserve(vault, backend);
  const observer = new ChainObserver();
  const das = heliusRpcUrl(config);
  const snapshotSources: TokenAccountSource[] = [];
  if (das) snapshotSources.push(new HeliusDasSource(das));
  snapshotSources.push(new ProgramAccountsSource(connection));
  const feeLedger = new Web3FeeLedger(connection);
  if (!config.keystorePath) {
    // Memory-only stores are fine for tests; a worker must persist.
    if (config.isMainnet) throw new ChainConfigError('QSD_KEYSTORE_PATH is required on mainnet (keys and identity state must persist)');
  }
  const journalDir = config.journalDir;

  let creatorPromise: Promise<Keypair> | undefined;
  const creator = () => (creatorPromise ??= loadCreatorKeypair(vault, config.protocolCreatorSecret));

  return {
    config,
    connection,
    vault,
    reserve,
    observer,
    snapshotSources,
    feeLedger,
    creator,
    async withCreator() {
      const kp = await creator();
      const sender = new Web3TransactionSender(connection, kp, config.cluster);
      const reader = new Web3ChainReader(connection);
      const transferSender = web3TransferSender(sender, connection, kp);
      const anchor = anchorWith({ sender, observer });
      return { creator: kp, sender, reader, transferSender, anchor, getMintRentLamports: () => connection.getMinimumBalanceForRentExemption(MINT_SIZE) };
    },
    journal<T>(name: string): JournalStore<T> {
      if (!journalDir) return new MemoryJournalStore<T>();
      return new FileJournalStore<T>(path.join(journalDir, `${name}.json`));
    },
    airdropJournal(daughterCa: string) {
      if (!journalDir) return new MemoryJournalStore<never>();
      return new FileAirdropJournal(path.join(journalDir, `airdrop-${daughterCa}.json`));
    },
  };
}
