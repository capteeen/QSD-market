/**
 * Token launches.
 *
 * MAINNET — pump.fun via PumpPortal's Local Transaction API.
 *   Confirmed 2026-10-09 at https://pumpportal.fun/creation (section "Local Transaction API"):
 *   1. upload image + metadata JSON to IPFS through Pinata:
 *        POST https://uploads.pinata.cloud/v3/files   Authorization: Bearer <PINATA_JWT>
 *        multipart: network=public, file=<bytes>      → { data: { cid } }  → https://ipfs.io/ipfs/<cid>
 *      (the page states: "The old pump.fun/api/ipfs endpoint is no longer supported.")
 *   2. POST https://pumpportal.fun/api/trade-local   content-type: application/json
 *        { publicKey, action: "create", tokenMetadata: { name, symbol, uri }, mint,
 *          denominatedInSol: "true", amount, slippage, priorityFee, pool: "pump" }
 *      → HTTP 200 with the serialized VersionedTransaction as the raw body (arrayBuffer).
 *   3. tx.sign([mintKeypair, creatorKeypair]) and send through our own RPC.
 *   PumpPortal/pump.fun document no devnet deployment; the launch is MAINNET-ONLY and
 *   `launchOnPumpFun` throws ChainUnavailableError on devnet.
 *
 * DEVNET — `launchDevnetSplToken`: a plain SPL mint (Token program) with the
 * whole supply minted to the payer's ATA. No Metaplex token-metadata (kept
 * off to avoid the dependency); the devnet coin therefore has no on-chain
 * name/symbol — enough to exercise snapshot → allocation → airdrop → anchor.
 */
import {
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import type { Cluster } from './config.js';
import { ChainConfigError, ChainUnavailableError, TransientChainError, errorMessage, isTransient } from './errors.js';
import { sendTracked, type ChainReader, type SentTransaction, type TransactionSender } from './sender.js';

export const PINATA_UPLOAD_URL = 'https://uploads.pinata.cloud/v3/files';
export const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
export const PUMPPORTAL_DOCS_URL = 'https://pumpportal.fun/creation';
export const PUMPPORTAL_CONFIRMED_ON = '2026-10-09';
/** Rent-exempt size of a Token-program mint, bytes (for createAccount). */
export const MINT_ACCOUNT_BYTES = MINT_SIZE;

type FetchLike = typeof fetch;

export interface TokenMetadataInput {
  name: string;
  symbol: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  /** Set to true to opt in to pump.fun's "showName" flag (not required). */
  showName?: boolean;
}

export interface PumpPortalCreateRequest {
  publicKey: string;
  action: 'create';
  tokenMetadata: { name: string; symbol: string; uri: string };
  mint: string;
  denominatedInSol: 'true';
  /** Dev buy in SOL. */
  amount: number;
  /** Percent. */
  slippage: number;
  /** SOL. */
  priorityFee: number;
  pool: 'pump';
}

export interface PumpPortalCreateParams {
  creator: PublicKey;
  mint: PublicKey;
  metadataUri: string;
  name: string;
  symbol: string;
  devBuySol: number;
  slippagePercent?: number;
  priorityFeeSol?: number;
}

/** Pure: the exact JSON body PumpPortal documents for `trade-local` creates. */
export function buildPumpPortalCreateRequest(p: PumpPortalCreateParams): PumpPortalCreateRequest {
  if (!(p.devBuySol >= 0) || !Number.isFinite(p.devBuySol)) throw new ChainConfigError('devBuySol must be a finite non-negative number');
  if (!p.name || !p.symbol) throw new ChainConfigError('token name and symbol are required');
  if (!/^https?:\/\//.test(p.metadataUri)) throw new ChainConfigError('metadataUri must be an http(s) URL');
  return {
    publicKey: p.creator.toBase58(),
    action: 'create',
    tokenMetadata: { name: p.name, symbol: p.symbol, uri: p.metadataUri },
    mint: p.mint.toBase58(),
    denominatedInSol: 'true',
    amount: p.devBuySol,
    slippage: p.slippagePercent ?? 10,
    priorityFee: p.priorityFeeSol ?? 0.0005,
    pool: 'pump',
  };
}

export function pumpPortalTradeLocalUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/trade-local`;
}

async function pinataUpload(file: Blob, filename: string, jwt: string, fetchImpl: FetchLike): Promise<string> {
  const form = new FormData();
  form.append('network', 'public');
  form.append('file', file, filename);
  let res: Response;
  try {
    res = await fetchImpl(PINATA_UPLOAD_URL, { method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: form });
  } catch (e) {
    throw new ChainUnavailableError(`Pinata upload failed: ${errorMessage(e)}`, { cause: e });
  }
  if (!res.ok) throw new ChainUnavailableError(`Pinata upload returned HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { cid?: string } };
  const cid = json.data?.cid;
  if (!cid) throw new ChainUnavailableError('Pinata upload response has no data.cid');
  return `${IPFS_GATEWAY}${cid}`;
}

export interface UploadedMetadata {
  imageUri: string;
  metadataUri: string;
}

/** Image bytes → IPFS, then the pump.fun metadata JSON → IPFS. */
export async function uploadTokenMetadata(
  args: { metadata: TokenMetadataInput; imageBytes: Uint8Array; imageMime?: string; pinataJwt: string | undefined },
  fetchImpl: FetchLike = fetch,
): Promise<UploadedMetadata> {
  if (!args.pinataJwt) throw new ChainConfigError('PINATA_JWT is required to upload pump.fun token metadata (see README)');
  const imageUri = await pinataUpload(new Blob([new Uint8Array(args.imageBytes).buffer as ArrayBuffer], { type: args.imageMime ?? 'image/png' }), 'image.png', args.pinataJwt, fetchImpl);
  const m = args.metadata;
  const metadataJson: Record<string, unknown> = { name: m.name, symbol: m.symbol, image: imageUri };
  if (m.description !== undefined) metadataJson['description'] = m.description;
  if (m.twitter !== undefined) metadataJson['twitter'] = m.twitter;
  if (m.telegram !== undefined) metadataJson['telegram'] = m.telegram;
  if (m.website !== undefined) metadataJson['website'] = m.website;
  if (m.showName !== undefined) metadataJson['showName'] = m.showName;
  const metadataUri = await pinataUpload(new Blob([JSON.stringify(metadataJson)], { type: 'application/json' }), 'metadata.json', args.pinataJwt, fetchImpl);
  return { imageUri, metadataUri };
}

export interface LaunchResult {
  ca: string;
  txSignature: string;
  metadataUri?: string;
  imageUri?: string;
  /** Supply as read back from the chain after the launch. */
  supply: { totalUnits: bigint; decimals: number };
  path: 'pump.fun' | 'devnet-spl';
}

export interface PumpFunLaunchArgs {
  metadata: TokenMetadataInput;
  imageBytes: Uint8Array;
  devBuySol: number;
  /** The protocol creator keypair; must equal sender.payer. */
  creator: Keypair;
  /** Fresh mint keypair; generated when omitted (store it through the KeyVault). */
  mint?: Keypair;
  slippagePercent?: number;
  priorityFeeSol?: number;
}

export interface LaunchDeps {
  cluster: Cluster;
  sender: TransactionSender;
  reader: ChainReader;
  pumpPortalApiUrl: string;
  pinataJwt?: string;
  fetchImpl?: FetchLike;
  /** Called with the signature as soon as it is known (before confirmation) so the caller can journal it. */
  onSent?: (sent: SentTransaction, mint: string) => Promise<void> | void;
}

export async function launchOnPumpFun(args: PumpFunLaunchArgs, deps: LaunchDeps): Promise<LaunchResult> {
  if (deps.cluster !== 'mainnet-beta') {
    throw new ChainUnavailableError('pump.fun launches are mainnet-only (PumpPortal documents no devnet deployment); use launchDevnetSplToken on devnet');
  }
  if (!args.creator.publicKey.equals(deps.sender.payer)) throw new ChainConfigError('creator keypair must be the sender payer');
  const fetchImpl = deps.fetchImpl ?? fetch;
  const mint = args.mint ?? Keypair.generate();
  const { imageUri, metadataUri } = await uploadTokenMetadata(
    { metadata: args.metadata, imageBytes: args.imageBytes, pinataJwt: deps.pinataJwt },
    fetchImpl,
  );
  const body = buildPumpPortalCreateRequest({
    creator: args.creator.publicKey,
    mint: mint.publicKey,
    metadataUri,
    name: args.metadata.name,
    symbol: args.metadata.symbol,
    devBuySol: args.devBuySol,
    ...(args.slippagePercent !== undefined ? { slippagePercent: args.slippagePercent } : {}),
    ...(args.priorityFeeSol !== undefined ? { priorityFeeSol: args.priorityFeeSol } : {}),
  });
  let res: Response;
  try {
    res = await fetchImpl(pumpPortalTradeLocalUrl(deps.pumpPortalApiUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ChainUnavailableError(`PumpPortal trade-local: ${errorMessage(e)}`, { cause: e });
  }
  if (res.status !== 200) {
    const text = await res.text().catch(() => '');
    const err = `PumpPortal trade-local returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`;
    if (res.status === 429 || res.status >= 500) throw new TransientChainError(err);
    throw new ChainUnavailableError(err);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(bytes);
  } catch (e) {
    throw new ChainUnavailableError(`PumpPortal returned a body that is not a VersionedTransaction: ${errorMessage(e)}`, { cause: e });
  }
  const sent = await deps.sender.sendVersioned(tx, [mint]);
  await deps.onSent?.(sent, mint.publicKey.toBase58());
  const status = await deps.sender.confirm(sent.signature, sent.lastValidBlockHeight);
  if (status === 'failed' || status === 'expired') {
    throw new ChainUnavailableError(`pump.fun create transaction ${sent.signature} ${status}`);
  }
  const supply = await deps.reader.getTokenSupply(mint.publicKey);
  return {
    ca: mint.publicKey.toBase58(),
    txSignature: sent.signature,
    metadataUri,
    imageUri,
    supply: { totalUnits: supply.amount, decimals: supply.decimals },
    path: 'pump.fun',
  };
}

export interface DevnetSplLaunchArgs {
  /** Total supply in base units, minted to the payer's ATA. */
  supplyUnits: bigint;
  decimals: number;
  mint?: Keypair;
  /** Lamports needed for the mint account's rent exemption (reader supplies when omitted). */
  rentLamports?: number;
}

export function buildDevnetSplMintInstructions(
  payer: PublicKey,
  mint: PublicKey,
  decimals: number,
  supplyUnits: bigint,
  rentLamports: number,
): TransactionInstruction[] {
  const ata = getAssociatedTokenAddressSync(mint, payer);
  return [
    SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: mint, lamports: rentLamports, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(mint, decimals, payer, null),
    createAssociatedTokenAccountIdempotentInstruction(payer, ata, payer, mint),
    createMintToInstruction(mint, ata, payer, supplyUnits),
  ];
}

export interface DevnetLaunchDeps {
  cluster: Cluster;
  sender: TransactionSender;
  reader: ChainReader;
  /** Rent exemption for MINT_SIZE bytes; from connection.getMinimumBalanceForRentExemption(MINT_SIZE). */
  getMintRentLamports: () => Promise<number>;
  /** Called with the signature as soon as it is known (before submission when the sender can prepare). */
  onSent?: (sent: SentTransaction, mint: string) => Promise<void> | void;
}

export async function launchDevnetSplToken(args: DevnetSplLaunchArgs, deps: DevnetLaunchDeps): Promise<LaunchResult> {
  if (deps.cluster !== 'devnet') {
    throw new ChainUnavailableError('launchDevnetSplToken is for devnet only; mainnet launches go through pump.fun');
  }
  if (args.supplyUnits <= 0n) throw new ChainConfigError('supplyUnits must be positive');
  if (!Number.isInteger(args.decimals) || args.decimals < 0 || args.decimals > 9) throw new ChainConfigError('decimals must be 0..9');
  const mint = args.mint ?? Keypair.generate();
  const rent = args.rentLamports ?? (await deps.getMintRentLamports());
  const ixs = buildDevnetSplMintInstructions(deps.sender.payer, mint.publicKey, args.decimals, args.supplyUnits, rent);
  let sent: SentTransaction;
  try {
    sent = await sendTracked(deps.sender, ixs, { signers: [mint] }, (st) => deps.onSent?.(st, mint.publicKey.toBase58()));
  } catch (e) {
    if (isTransient(e)) throw new TransientChainError(`devnet mint: ${errorMessage(e)}`, { cause: e });
    throw e;
  }
  const status = await deps.sender.confirm(sent.signature, sent.lastValidBlockHeight);
  if (status === 'failed' || status === 'expired') throw new ChainUnavailableError(`devnet mint transaction ${sent.signature} ${status}`);
  const supply = await deps.reader.getTokenSupply(mint.publicKey);
  return { ca: mint.publicKey.toBase58(), txSignature: sent.signature, supply: { totalUnits: supply.amount, decimals: supply.decimals }, path: 'devnet-spl' };
}

export interface DaughterLaunchPlan {
  name: string;
  symbol: string;
  description: string;
  imageBytes: Uint8Array;
  devBuySol: number;
  /** Devnet only: what to mint (pump.fun fixes supply itself). */
  devnetSupplyUnits?: bigint;
  devnetDecimals?: number;
  mint?: Keypair;
}

export type DaughterLaunchDeps = LaunchDeps & { creator: Keypair; getMintRentLamports: () => Promise<number> };

/** Fully automatic daughter launch: pump.fun on mainnet, plain SPL on devnet. No human in the loop. */
export async function launchDaughter(plan: DaughterLaunchPlan, deps: DaughterLaunchDeps): Promise<LaunchResult> {
  if (deps.cluster === 'mainnet-beta') {
    return launchOnPumpFun(
      {
        metadata: { name: plan.name, symbol: plan.symbol, description: plan.description },
        imageBytes: plan.imageBytes,
        devBuySol: plan.devBuySol,
        creator: deps.creator,
        ...(plan.mint ? { mint: plan.mint } : {}),
      },
      deps,
    );
  }
  if (plan.devnetSupplyUnits === undefined || plan.devnetDecimals === undefined) {
    throw new ChainConfigError('devnet daughter launch needs devnetSupplyUnits and devnetDecimals');
  }
  return launchDevnetSplToken(
    { supplyUnits: plan.devnetSupplyUnits, decimals: plan.devnetDecimals, ...(plan.mint ? { mint: plan.mint } : {}) },
    deps,
  );
}
