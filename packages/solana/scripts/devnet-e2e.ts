/**
 * Devnet end-to-end: mint a token, distribute to 3 generated wallets, anchor a
 * memo, compute an allocation, run the airdrop (with its journal), burn the
 * dust, and print every signature. Refuses to run on mainnet.
 *
 *   SOLANA_CLUSTER=devnet SOLANA_RPC_URL=https://api.devnet.solana.com \
 *   QSD_KEY_ENCRYPTION_KEY=<64 hex> QSD_DEVNET_PAYER=<base58 or JSON secret key> \
 *   pnpm --filter @qsd/solana devnet-e2e
 *
 * The payer needs ≈ 0.05 SOL (airdrop with `solana airdrop 1 <pubkey> -u devnet`).
 */
import { Keypair } from '@solana/web3.js';
import { MINT_SIZE, createBurnInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import bs58 from 'bs58';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { computeAllocation, type HolderSnapshot } from '@qsd/protocol';
import {
  ChainObserver,
  FileAirdropJournal,
  Web3ChainReader,
  Web3TransactionSender,
  anchorWith,
  createConnection,
  holderSnapshotAtSlot,
  launchDevnetSplToken,
  loadChainConfig,
  runAirdrop,
  web3TransferSender,
  ProgramAccountsSource,
  type HoldingHistory,
} from '../src/index.js';

function payerFromEnv(): Keypair {
  const v = process.env['QSD_DEVNET_PAYER'];
  if (!v) throw new Error('QSD_DEVNET_PAYER is required (base58 secret key or JSON array)');
  const bytes = v.trim().startsWith('[') ? Uint8Array.from(JSON.parse(v) as number[]) : bs58.decode(v.trim());
  return Keypair.fromSecretKey(bytes);
}

async function main() {
  const cfg = loadChainConfig(process.env);
  if (cfg.isMainnet) throw new Error('devnet-e2e refuses to run on mainnet');
  const payer = payerFromEnv();
  const connection = createConnection(cfg.rpcUrl);
  const sender = new Web3TransactionSender(connection, payer, cfg.cluster);
  const reader = new Web3ChainReader(connection);
  const observer = new ChainObserver();
  observer.subscribe((e) => console.log(`[event ${e.seq}] ${e.type}`, 'txSignature' in e ? e.txSignature : ''));
  const anchor = anchorWith({ sender, observer });
  const sol = await reader.getBalanceLamports(payer.publicKey);
  console.log(`payer ${payer.publicKey.toBase58()} balance ${Number(sol) / 1e9} SOL on ${cfg.cluster} (${cfg.rpcUrl})`);
  if (sol < 30_000_000n) throw new Error('payer needs at least 0.03 SOL');

  // 1. mint
  const launch = await launchDevnetSplToken({ supplyUnits: 1_000_000_000n, decimals: 6 }, { cluster: 'devnet', sender, reader, getMintRentLamports: () => connection.getMinimumBalanceForRentExemption(MINT_SIZE) });
  console.log(`mint ${launch.ca} tx ${launch.txSignature} supply ${launch.supply.totalUnits}`);

  // 2. distribute the "mother" to 3 generated wallets (treasury keeps the rest)
  const wallets = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const transferSender = web3TransferSender(sender, connection, payer);
  const dist = await transferSender.prepareTransfers(launch.ca, [
    { wallet: wallets[0]!.publicKey.toBase58(), units: 500_000_000n },
    { wallet: wallets[1]!.publicKey.toBase58(), units: 300_000_000n },
    { wallet: wallets[2]!.publicKey.toBase58(), units: 100_000_000n },
  ]);
  await dist.submit();
  console.log(`distribution tx ${dist.signature}: ${await sender.confirm(dist.signature, dist.lastValidBlockHeight)}`);

  // 3. anchor a proof-style memo
  const a = await anchor('ab'.repeat(32), 'proof');
  console.log(`anchor tx ${a.txSignature} (${a.status})`);

  // 4. snapshot via getProgramAccounts (DAS when HELIUS_API_KEY is set is identical in shape)
  const now = Math.floor(Date.now() / 1000);
  const history: HoldingHistory = {
    async factsFor(wallet) {
      const i = wallets.findIndex((w) => w.publicKey.toBase58() === wallet);
      return { firstAcquiredAt: now - 3600 * (i + 1), heldThroughMeasurementIds: [], heldThroughQuietPeriod: i === 0 };
    },
  };
  const slot = await reader.getSlot();
  const snap = await holderSnapshotAtSlot(
    { mint: launch.ca, bornAt: now - 86_400, collapseAt: now, collapseSlot: slot, quietPeriodStart: now - 1800, measurements: [], excludeOwners: [payer.publicKey.toBase58()] },
    { sources: [new ProgramAccountsSource(connection)], history },
  );
  console.log(`snapshot at slot ${snap.observedSlot} via ${snap.source}: ${snap.holders.length} holders`);

  // 5. allocation of a "daughter" pool (here: 100M units of the same devnet mint from the treasury)
  const table = computeAllocation({ snapshot: snap.holders as HolderSnapshot[], measurements: [], bornAt: now - 86_400, collapseAt: now, quietPeriodStart: now - 1800, totalDaughterUnits: 100_000_000n });
  console.log(`allocation root ${table.merkleRoot}; ${table.entries.length} entries; dust ${table.dustUnits}`);

  // 6. airdrop with a file journal (re-run the script with QSD_E2E_JOURNAL=<path> to see resume)
  const journalPath = process.env['QSD_E2E_JOURNAL'] ?? path.join(mkdtempSync(path.join(tmpdir(), 'qsd-e2e-')), 'airdrop.json');
  const report = await runAirdrop({ table, mint: launch.ca, sender: transferSender, journal: new FileAirdropJournal(journalPath), anchor, observer, log: console.log });
  console.log(`airdrop: ${report.confirmedWallets} wallets, ${report.confirmedUnits} units, root anchor ${report.rootAnchorSignature}, txs ${report.signatures.join(', ')}; journal ${journalPath}`);

  // 7. burn the dust
  if (table.dustUnits > 0n) {
    const burn = await sender.send([createBurnInstruction(getAssociatedTokenAddressSync(new (await import('@solana/web3.js')).PublicKey(launch.ca), payer.publicKey), new (await import('@solana/web3.js')).PublicKey(launch.ca), payer.publicKey, table.dustUnits)]);
    console.log(`dust burn tx ${burn.signature}: ${await sender.confirm(burn.signature, burn.lastValidBlockHeight)}`);
  }
  for (const e of table.entries) console.log(`  ${e.wallet} → ${e.units} units (weight ${e.weightBps} bps)`);
  console.log('devnet e2e complete');
}

main().catch((e) => {
  console.error(`devnet-e2e failed: ${(e as Error).message}`);
  process.exit(1);
});
