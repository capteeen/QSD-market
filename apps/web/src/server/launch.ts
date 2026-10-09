import 'server-only';
import type { Prisma } from '@prisma/client';
import { Keypair, PublicKey } from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha256';
import { CryptoObserver, redactEvent, toHex, type CryptoEvent } from '@qsd/crypto';
import { HALF_LIFE_PRESETS, initialImageLineage, maxWindowSec, type Coin } from '@qsd/protocol';
import { QuantumEventBus, bundleHash, canonicalJson, type JsonValue, type OutcomeResolver, type ProofBundle, type QuantumEvent } from '@qsd/quantum';
import { launchDevnetSplToken, launchOnPumpFun, redactSecrets, type ChainEvent as SolanaChainEvent } from '@qsd/solana';
import { encodeCryptoEvents } from '@qsd/scene/model';
import type { ChainEvent as SceneChainEvent, LineageInput, SuperpositionInput } from '@qsd/scene/model';
import { getChain } from './chain';
import { db } from './db';
import { insertCoinWith } from './coins';
import { logEvent } from './events';
import { genesisConfig } from './genesis';
import { syncIdentityMirror } from './identityMirror';
import { qrngClient } from './qrng';
import { publish } from './redis';
import { nowSeconds } from '@/lib/format';

/**
 * /api/launch streams Server-Sent Events while the real launch runs:
 *
 *   event: status        { step, message }
 *   event: crypto        base64 of encodeCryptoEvents(batch)   (@qsd/scene codec; keygen + signing)
 *   event: superposition SuperpositionInput with bigints as strings
 *   event: quantum       QuantumEvent with `bytes` as hex
 *   event: chain         scene ChainEvent { anchorSubmitted | anchored }
 *   event: launch        { ca, txSignature, path }
 *   event: lineage       LineageInput
 *   event: done          { ca }
 *   event: error         { message }
 *
 * Identity generation runs on the SERVER, inside the protocol's identity
 * reserve (@qsd/solana): the seed never leaves the vault. The key-generation
 * stream is therefore redacted with @qsd/crypto `redactEvent` before it is
 * sent: chain values at depth 0–14 (one-time secret key material) are
 * replaced by their SHA-256, which the README calls "still a real, verifiable
 * commitment"; everything else (tips, leaves, fused nodes, root, the whole
 * signing stream) is the real value. The scene renders exactly what arrives.
 *
 * The quantum draw at launch seeds the lineage id (resolver
 * `qsd/launch-lineage/v1`, bytes 0–15 → hex); its proof bundle is anchored and
 * stored on the coin. The genesis superposition band is the configured
 * genesis pool range in full (the widest band, as for a coin with no history).
 */

export interface LaunchForm {
  name: string;
  ticker: string;
  description: string;
  halfLifePreset: string;
  devBuySol: number;
  image: { bytes: Uint8Array; mime: string };
  wallet: string;
  paymentSignature: string;
}

export type LaunchFrame = { event: string; data: string };

export const LAUNCH_LINEAGE_RESOLVER_ID = 'qsd/launch-lineage/v1';

interface LaunchInputs {
  [key: string]: JsonValue;
  ca: string;
  identityRoot: string;
  halfLifeSec: number;
  imageHash: string;
}

/** bytes 0–15 → lineage id (hex). Deterministic and public. */
export const launchLineageResolver: OutcomeResolver<LaunchInputs> = {
  id: LAUNCH_LINEAGE_RESOLVER_ID,
  resolve(bytes) {
    if (bytes.length < 16) throw new Error('launch draw needs at least 16 bytes');
    const lineageId = toHex(bytes.slice(0, 16));
    return { value: { lineageId }, label: `lineage:${lineageId}` };
  },
};

export interface LaunchPreset {
  id: string;
  label: string;
  halfLifeSec: number;
  maxWindowSec: number;
}

/** Launch-phase preset: a 30-second half-life, auto-measured after 60 quiet seconds, so a coin with no trading collapses within minutes. */
export const FAST_LAUNCH_PRESET: LaunchPreset = { id: '30s', label: '30 seconds (launch phase)', halfLifeSec: 30, maxWindowSec: maxWindowSec(30) };

/**
 * The half-life presets /launch offers. With QSD_FAST_LAUNCH_PHASE=true every
 * generation-1 coin gets the 30-second preset; daughters still take their
 * half-life from the genesis channel table (1 hour or more), so only the
 * first generation is fast.
 */
export function launchPresets(): readonly LaunchPreset[] {
  return process.env.QSD_FAST_LAUNCH_PHASE?.trim() === 'true' ? [FAST_LAUNCH_PRESET] : HALF_LIFE_PRESETS;
}

export class LaunchValidationError extends Error {
  override readonly name = 'LaunchValidationError';
}

export function validateLaunchForm(f: Partial<LaunchForm>): asserts f is LaunchForm {
  if (!f.name || f.name.trim().length < 1 || f.name.length > 32) throw new LaunchValidationError('name must be 1–32 characters');
  if (!f.ticker || !/^[A-Z0-9]{1,10}$/.test(f.ticker)) throw new LaunchValidationError('ticker must be 1–10 uppercase letters or digits');
  if (typeof f.description !== 'string' || f.description.length > 500) throw new LaunchValidationError('description must be at most 500 characters');
  if (!f.halfLifePreset || !launchPresets().some((p) => p.id === f.halfLifePreset)) throw new LaunchValidationError('half-life preset is not one of the presets offered');
  if (typeof f.devBuySol !== 'number' || !Number.isFinite(f.devBuySol) || f.devBuySol < 0 || f.devBuySol > 100) throw new LaunchValidationError('dev buy must be a number of SOL between 0 and 100');
  if (!f.image || !(f.image.bytes instanceof Uint8Array) || f.image.bytes.length === 0 || f.image.bytes.length > 2_000_000) throw new LaunchValidationError('image must be 1 byte to 2 MB');
  if (!/^image\/(png|jpeg|gif|webp)$/.test(f.image.mime)) throw new LaunchValidationError('image must be png, jpeg, gif or webp');
  if (!f.wallet) throw new LaunchValidationError('wallet is required');
  try {
    new PublicKey(f.wallet);
  } catch {
    throw new LaunchValidationError('wallet is not a valid public key');
  }
  if (!f.paymentSignature || !/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(f.paymentSignature)) throw new LaunchValidationError('payment signature is required');
}

export interface LaunchCosts {
  launchCostLamports: bigint | null;
  identityReserveLamports: bigint | null;
  /** The fixed dev buy every launch pays for (QSD_LAUNCH_DEV_BUY_LAMPORTS); it funds the coin's collapse reward. */
  devBuyLamports: bigint | null;
}

export function launchCosts(): LaunchCosts {
  const read = (name: string): bigint | null => {
    const v = process.env[name];
    if (!v || !/^\d+$/.test(v.trim())) return null;
    return BigInt(v.trim());
  };
  return { launchCostLamports: read('QSD_LAUNCH_COST_LAMPORTS'), identityReserveLamports: read('QSD_IDENTITY_RESERVE_LAMPORTS'), devBuyLamports: read('QSD_LAUNCH_DEV_BUY_LAMPORTS') };
}

/** The wallet must have paid launch cost + identity reserve + dev buy to the protocol creator in `paymentSignature`. */
async function verifyPayment(form: LaunchForm, payTo: PublicKey): Promise<bigint> {
  const costs = launchCosts();
  if (costs.launchCostLamports === null || costs.identityReserveLamports === null || costs.devBuyLamports === null) {
    throw new LaunchValidationError('launch cost, identity reserve or dev buy is not configured (QSD_LAUNCH_COST_LAMPORTS / QSD_IDENTITY_RESERVE_LAMPORTS / QSD_LAUNCH_DEV_BUY_LAMPORTS)');
  }
  const chain = getChain();
  // The dev buy is fixed: on mainnet the treasury's dev-buy tokens are what a collapse burns and pays the measurer with.
  if (chain.config.cluster === 'mainnet-beta' && costs.devBuyLamports <= 0n) throw new LaunchValidationError('QSD_LAUNCH_DEV_BUY_LAMPORTS must be positive on mainnet, or the coin could never collapse');
  const devBuyLamports = BigInt(Math.round(form.devBuySol * 1e9));
  if (devBuyLamports !== costs.devBuyLamports) throw new LaunchValidationError(`dev buy must be exactly ${costs.devBuyLamports} lamports`);
  const total = costs.launchCostLamports + costs.identityReserveLamports + devBuyLamports;
  const tx = await chain.connection.getTransaction(form.paymentSignature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  if (!tx || !tx.meta) throw new LaunchValidationError('payment transaction not found or not confirmed');
  if (tx.meta.err) throw new LaunchValidationError('payment transaction failed on-chain');
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses ?? null }).staticAccountKeys;
  const payerIdx = keys.findIndex((k) => k.toBase58() === form.wallet);
  const payeeIdx = keys.findIndex((k) => k.equals(payTo));
  if (payerIdx < 0 || payeeIdx < 0) throw new LaunchValidationError('payment transaction does not involve the wallet and the protocol address');
  if (!tx.transaction.message.isAccountSigner(payerIdx)) throw new LaunchValidationError('the wallet did not sign the payment transaction');
  const received = BigInt(tx.meta.postBalances[payeeIdx] ?? 0) - BigInt(tx.meta.preBalances[payeeIdx] ?? 0);
  if (received < total) throw new LaunchValidationError(`payment of ${received} lamports is below the required ${total}`);
  await assertPaymentUnused(db(), form.paymentSignature);
  return total;
}

const PAYMENT_USED = 'this payment was already used for a launch';

/**
 * One payment buys one launch. `Coin.paymentTx` records the payment a coin
 * consumed and is unique; it is checked here before any chain work, and again
 * inside the transaction that inserts the coin (with the unique index as the
 * last word), so two concurrent launches on the same payment cannot both land.
 */
async function assertPaymentUnused(client: Prisma.TransactionClient, paymentTx: string): Promise<void> {
  const used = await client.coin.findFirst({ where: { paymentTx } });
  if (used) throw new LaunchValidationError(PAYMENT_USED);
}

function isPaymentUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } };
  if (err?.code !== 'P2002') return false;
  const target = err.meta?.target;
  return Array.isArray(target) ? target.includes('paymentTx') : typeof target === 'string' ? target.includes('paymentTx') : true;
}

function hexBytes(e: QuantumEvent): JsonValue {
  if (e.type === 'entropyArrived') return { ...e, bytes: toHex(e.bytes) } as unknown as JsonValue;
  return e as unknown as JsonValue;
}

const CRYPTO_BATCH = 4096;

/** Run the real launch, yielding SSE frames. Throws only before the first frame; later errors arrive as `error` frames. */
export async function* runLaunch(form: LaunchForm): AsyncGenerator<LaunchFrame> {
  const frames: LaunchFrame[] = [];
  const push = (event: string, data: unknown): void => {
    frames.push({ event, data: typeof data === 'string' ? data : JSON.stringify(data, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)) });
  };
  const drain = function* (): Generator<LaunchFrame> {
    while (frames.length) yield frames.shift()!;
  };

  try {
    validateLaunchForm(form);
    const chain = getChain();
    const genesis = genesisConfig();
    const preset = launchPresets().find((p) => p.id === form.halfLifePreset)!;
    const { creator, sender, reader, anchor, getMintRentLamports } = await chain.withCreator();

    push('status', { step: 'payment', message: 'verifying payment' });
    yield* drain();
    await verifyPayment(form, creator.publicKey);

    // 1. mint keypair → the contract address, stored encrypted in the vault.
    const mint = Keypair.generate();
    const ca = mint.publicKey.toBase58();
    await chain.vault.storeKeypair(`qsd/mint/${ca}`, mint);
    push('status', { step: 'mint', message: 'mint keypair generated and vaulted', ca });
    yield* drain();

    // 2. identity (server-side, in the reserve). Keygen is synchronous: events are
    //    batched, redacted, encoded and flushed as fast as the connection accepts.
    const observer = new CryptoObserver();
    let batch: CryptoEvent[] = [];
    const flush = (): void => {
      if (batch.length === 0) return;
      const encoded = encodeCryptoEvents(batch);
      push('crypto', Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength).toString('base64'));
      batch = [];
    };
    observer.subscribe((e) => {
      batch.push(redactEvent(e));
      if (batch.length >= CRYPTO_BATCH) flush();
    });
    push('status', { step: 'identity', message: 'generating the launch identity (WOTS+ chains, Merkle tree)' });
    yield* drain();
    const { entry, identity } = await chain.reserve.createForCoin(ca, { observer: { observer } });
    flush();
    yield* drain();
    const identityRoot = identity.rootHex;

    // 3. superposition input (genesis band + channels) for the scene.
    const superposition: SuperpositionInput = {
      supplyMin: genesis.poolUnits.min,
      supplyMax: genesis.poolUnits.max,
      halfLifeSec: preset.halfLifeSec,
      decayChannels: genesis.channels.map((c) => ({ id: c.id, probability: c.probabilityPpm, label: c.label })),
    };
    push('superposition', superposition);
    yield* drain();

    // 4. quantum draw → lineage id. Pre-commit anchored before the draw (same discipline as a measurement).
    const bus = new QuantumEventBus();
    bus.subscribe((e) => push('quantum', hexBytes(e)));
    const client = qrngClient(bus);
    const imageHash = toHex(sha256(form.image.bytes));
    const inputs: LaunchInputs = { ca, identityRoot, halfLifeSec: preset.halfLifeSec, imageHash };
    let chainSeq = 0;
    const chainFrame = (e: SolanaChainEvent): void => {
      if (e.type === 'anchorRequested') push('chain', { type: 'anchorSubmitted', seq: chainSeq++ } satisfies SceneChainEvent);
      if (e.type === 'anchored') push('chain', { type: 'anchored', seq: chainSeq++, txSignature: e.txSignature } satisfies SceneChainEvent);
    };
    const { bundle } = await client.measure(inputs, launchLineageResolver, {
      beforeDraw: async (b) => {
        await anchor(b.inputsHash, 'precommit', b.nonce);
      },
    });
    yield* drain();
    const lineageId = (bundle.outcome.value as { lineageId: string }).lineageId;
    const launchBundleHash = bundleHash(bundle);

    // 5. sign the launch statement with the identity's first one-time key (through the reserve's Signer).
    const statement = canonicalJson({ ca, identityRoot, lineageId, launchBundleHash, imageHash, halfLifeSec: preset.halfLifeSec });
    const signer = await chain.reserve.signerFor(ca);
    const signObserver = new CryptoObserver();
    signObserver.subscribe((e) => {
      batch.push(e);
    });
    const signed = await signer.sign(sha256(new TextEncoder().encode(statement)), { observer: signObserver });
    flush();
    yield* drain();

    // 6. anchor the launch bundle on-chain (stage 7).
    const unsubChain = chain.observer.subscribe(chainFrame);
    const proofAnchor = await anchor(launchBundleHash, 'proof');
    unsubChain();
    yield* drain();

    // 7. launch: devnet SPL mint or pump.fun on mainnet.
    push('status', { step: 'launch', message: chain.config.cluster === 'devnet' ? 'minting the devnet SPL token' : 'creating the coin on pump.fun' });
    yield* drain();
    const launch =
      chain.config.cluster === 'devnet'
        ? await launchDevnetSplToken({ supplyUnits: genesis.supplyUnits, decimals: genesis.decimals, mint }, { cluster: 'devnet', sender, reader, getMintRentLamports })
        : await launchOnPumpFun(
            { metadata: { name: form.name, symbol: form.ticker, description: form.description }, imageBytes: form.image.bytes, devBuySol: form.devBuySol, creator, mint },
            { cluster: 'mainnet-beta', sender, reader, pumpPortalApiUrl: chain.config.pumpPortalApiUrl, ...(chain.config.pinataJwt ? { pinataJwt: chain.config.pinataJwt } : {}) },
          );
    push('launch', { ca: launch.ca, txSignature: launch.txSignature, path: launch.path });
    yield* drain();

    // 8. persist.
    const bornAt = nowSeconds();
    const imageUri = launch.imageUri ?? `/api/coin/${ca}/image`;
    const coin: Coin = {
      ca,
      name: form.name.trim(),
      ticker: form.ticker,
      image: { uri: imageUri, hash: imageHash, lineage: initialImageLineage(imageHash) },
      lineageId,
      generation: 1,
      identityRoot,
      halfLifeSec: preset.halfLifeSec,
      decayProgress: 0,
      decayChannels: genesis.channels,
      superposition: { supplyMin: genesis.poolUnits.min, supplyMax: genesis.poolUnits.max },
      supply: { totalUnits: launch.supply.totalUnits, remainingUnits: launch.supply.totalUnits, decimals: launch.supply.decimals },
      state: 'superposed',
      lastActivityAt: bornAt,
      measurements: [],
      bornAt,
    };
    try {
      await db().$transaction(async (tx) => {
        await assertPaymentUnused(tx, form.paymentSignature);
        await insertCoinWith(tx, coin, { launchPath: launch.path, launchTx: launch.txSignature, launchBundle: bundle as unknown as ProofBundle, createdBy: form.wallet, paymentTx: form.paymentSignature });
      });
    } catch (e) {
      if (isPaymentUniqueViolation(e)) throw new LaunchValidationError(PAYMENT_USED);
      throw e;
    }
    if (!launch.imageUri) await db().coinImage.create({ data: { coinCa: ca, mime: form.image.mime, bytes: Buffer.from(form.image.bytes) } });
    await syncIdentityMirror(ca);
    await logEvent({
      type: 'launch',
      coinCa: ca,
      tx: launch.txSignature,
      summary: `${coin.ticker} launched (generation 1, half-life ${preset.label}, ${launch.path}); identity ${entry.identityRoot.slice(0, 16)}…`,
      data: { signatureIndex: signed.index, signatureBytes: signed.signature.length, launchBundleHash, proofTx: proofAnchor.txSignature, paymentTx: form.paymentSignature },
    });
    await publish({ type: 'coin', ca });

    const lineage: LineageInput = { ca, generation: 1 };
    push('lineage', lineage);
    push('done', { ca });
    yield* drain();
  } catch (e) {
    // Never forward a raw chain/RPC error: web3.js fetch errors can carry the RPC URL and its api-key.
    push('error', { message: redactSecrets(e instanceof Error ? e.message : String(e)) });
    yield* drain();
  }
}
