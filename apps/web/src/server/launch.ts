import 'server-only';
import type { Prisma } from '@prisma/client';
import { isAddress, keccak256, toHex as toHex0x, type Address, type Hash, type Hex } from 'viem';
import { predictedPoolTokenAddress } from '@qsd/elysium';
import { sha256 } from '@noble/hashes/sha256';
import { readNativeTransfer } from '@qsd/elysium';
import { CryptoObserver, redactEvent, toHex, type CryptoEvent } from '@qsd/crypto';
import { HALF_LIFE_PRESETS, initialImageLineage, maxWindowSec, type Coin } from '@qsd/protocol';
import { QuantumEventBus, bundleHash, canonicalJson, type JsonValue, type OutcomeResolver, type ProofBundle, type QuantumEvent } from '@qsd/quantum';
import { redactSecrets, type ChainEvent as ReserveChainEvent } from '@qsd/solana';
import { encodeCryptoEvents } from '@qsd/scene/model';
import type { ChainEvent as SceneChainEvent, LineageInput, SuperpositionInput } from '@qsd/scene/model';
import { normalizeSocial } from '@/lib/socials';
import { AuthError, verifyChallenge } from './auth';
import { DAY_MS, LAUNCH_GLOBAL_LIMIT_MESSAGE, LAUNCH_WALLET_LIMIT_MESSAGE, launchGlobalLimit, launchWalletLimit, spendBudget } from './budget';
import { getChain } from './chain';
import { db } from './db';
import { insertCoinWith } from './coins';
import { logEvent } from './events';
import { genesisConfig } from './genesis';
import { syncIdentityMirror } from './identityMirror';
import { qrngClient, qrngProbe } from './qrng';
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
 * reserve: the seed never leaves the vault. Settlement is Elysium: the
 * payment is native HYPE and the coin is an ERC-20 whose address is 0x.
 * The key-generation
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
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  halfLifePreset: string;
  /** Dev buy in wei of HYPE, as a base-10 integer string. */
  devBuyWei: string;
  image: { bytes: Uint8Array; mime: string };
  wallet: string;
  paymentSignature: string;
  /** Nonce from POST /api/launch/challenge, bound to this ticker. */
  walletNonce: string;
  /** Personal signature by `wallet` over that challenge. */
  walletSignature: string;
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

/** The half-life applied when the launch form does not ask the creator to choose one. */
export function directLaunchPreset(): LaunchPreset {
  const presets = launchPresets();
  return presets.find((p) => p.id === '24h') ?? presets[0]!;
}

export class LaunchValidationError extends Error {
  override readonly name = 'LaunchValidationError';
}

/** True when a coin with this ticker is already stored. Comparison is on the stored uppercase ticker. */
export async function tickerTaken(ticker: string): Promise<boolean> {
  if (!/^[A-Z0-9]{1,10}$/.test(ticker)) return false;
  const row = await db().coin.findFirst({ where: { ticker }, select: { ca: true } });
  return row !== null;
}

export function tickerTakenMessage(ticker: string): string {
  return `ticker ${ticker} is already launched`;
}

export function validateLaunchForm(f: Partial<LaunchForm>): asserts f is LaunchForm {
  if (!f.name || f.name.trim().length < 1 || f.name.length > 32) throw new LaunchValidationError('name must be 1–32 characters');
  if (!f.ticker || !/^[A-Z0-9]{1,10}$/.test(f.ticker)) throw new LaunchValidationError('ticker must be 1–10 uppercase letters or digits');
  if (typeof f.description !== 'string' || f.description.length > 500) throw new LaunchValidationError('description must be at most 500 characters');
  try {
    f.website = normalizeSocial('website', typeof f.website === 'string' ? f.website : '');
    f.twitter = normalizeSocial('x', typeof f.twitter === 'string' ? f.twitter : '');
    f.telegram = normalizeSocial('telegram', typeof f.telegram === 'string' ? f.telegram : '');
  } catch (e) {
    throw new LaunchValidationError(e instanceof Error ? e.message : String(e));
  }
  if (!f.halfLifePreset) f.halfLifePreset = directLaunchPreset().id;
  if (!launchPresets().some((p) => p.id === f.halfLifePreset)) throw new LaunchValidationError('half-life preset is not one of the presets offered');
  if (typeof f.devBuyWei !== 'string' || !/^\d+$/.test(f.devBuyWei)) throw new LaunchValidationError('first buy must be an integer number of wei');
  if (BigInt(f.devBuyWei) > 100n * 10n ** 18n) throw new LaunchValidationError('first buy must be a number of HYPE between 0 and 100');
  if (!f.image || !(f.image.bytes instanceof Uint8Array) || f.image.bytes.length === 0 || f.image.bytes.length > 2_000_000) throw new LaunchValidationError('image must be 1 byte to 2 MB');
  if (!/^image\/(png|jpeg|gif|webp)$/.test(f.image.mime)) throw new LaunchValidationError('image must be png, jpeg, gif or webp');
  if (!f.wallet || !isAddress(f.wallet)) throw new LaunchValidationError('wallet is not a valid address');
  const paid = BigInt(f.devBuyWei) > 0n;
  if (paid && (!f.paymentSignature || !/^0x[0-9a-fA-F]{64}$/.test(f.paymentSignature))) throw new LaunchValidationError('payment signature is required');
  if (!paid) f.paymentSignature = '';
  if (!f.walletNonce || !/^[0-9a-f]{32}$/.test(f.walletNonce)) throw new LaunchValidationError('wallet signature is required');
  if (!f.walletSignature || !/^0x[0-9a-fA-F]{130}$/.test(f.walletSignature)) throw new LaunchValidationError('wallet signature is required');
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

/** HYPE deposited into the opening pool. The Uniswap v3 open deposits none. */
export const DEFAULT_POOL_SEED_WEI = 0n;

/** HYPE deposited when a coin opens. The Uniswap v3 open deposits none: the supply sits on the token side of the range. */
export function poolSeedWei(): bigint {
  return DEFAULT_POOL_SEED_WEI;
}

/** The wallet pays only the first buy it chose. A launch with no first buy sends no HYPE. */
async function verifyPayment(form: LaunchForm, payTo: Address): Promise<bigint> {
  const firstBuy = BigInt(form.devBuyWei);
  if (firstBuy === 0n) return 0n;
  const total = firstBuy;
  const chain = getChain();
  let payment;
  try {
    payment = await readNativeTransfer(chain.publicClient, form.paymentSignature as Hash);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not found|could not be found/i.test(msg)) payment = null;
    else throw e;
  }
  if (!payment) throw new LaunchValidationError('payment transaction not found or not confirmed');
  if (payment.status !== 'success') throw new LaunchValidationError('payment transaction failed on-chain');
  if (payment.from.toLowerCase() !== form.wallet.toLowerCase() || (payment.to?.toLowerCase() ?? '') !== payTo.toLowerCase()) {
    throw new LaunchValidationError('payment transaction does not involve the wallet and the protocol address');
  }
  if (payment.value < total) throw new LaunchValidationError(`payment of ${payment.value} wei of HYPE is below the required ${total}`);
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

function isTickerUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } };
  if (err?.code !== 'P2002') return false;
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : typeof target === 'string' ? [target] : [];
  return fields.some((field) => field.toLowerCase().includes('ticker'));
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

/**
 * Key generation emits ~292,000 events, 94% of them `chainStep` (one per hash
 * in every WOTS+ chain): ~15 MB of SSE that the browser must download and
 * replay before the launch can go on. The stream carries every other event
 * and the chain steps of every KEYGEN_STEP_LEAF_STRIDE-th leaf only; each one
 * sent is still a real, unaltered (redacted) event, and the scene draws the
 * leaves it is shown.
 */
export const KEYGEN_STEP_LEAF_STRIDE = 64;
export function streamedCryptoEvent(e: CryptoEvent): boolean {
  return e.type !== 'chainStep' || e.leaf % KEYGEN_STEP_LEAF_STRIDE === 0;
}

/** Wall-clock milliseconds per launch step, reported at the end of every launch (and on failure). */
function stepTimer(): { mark: (step: string) => void; summary: () => string; all: () => Record<string, number> } {
  const t0 = Date.now();
  let last = t0;
  const steps: Record<string, number> = {};
  return {
    mark(step) {
      const now = Date.now();
      steps[step] = now - last;
      last = now;
    },
    all: () => ({ ...steps, total: Date.now() - t0 }),
    summary: () =>
      Object.entries({ ...steps, total: Date.now() - t0 })
        .map(([k, ms]) => `${k} ${(ms / 1000).toFixed(1)}s`)
        .join(' · '),
  };
}

/** What a launch needs, checked BEFORE the wallet is asked to pay. */
export interface LaunchPreflight {
  ok: boolean;
  /** Why a launch would fail now; empty when ok. */
  problems: string[];
}

/** The protocol wallet must hold at least this much HYPE (wei) to pay the launch's own network fees. 0.001 HYPE. */
export const PREFLIGHT_MIN_CREATOR_WEI = 1_000_000_000_000_000n;
const PREFLIGHT_TTL_MS = 30_000;
const pf = globalThis as unknown as { __qsdPreflight?: { at: number; result: LaunchPreflight } };

/**
 * Cheap checks that every service a launch touches answers: genesis config,
 * cost config, the protocol key, the RPC, the protocol wallet's balance, the
 * the Elysium RPC and one byte from the quantum provider.
 * A good result is cached for 30 s (a failure for 10 s) so callers do not spend QRNG quota.
 */
export async function launchPreflight(): Promise<LaunchPreflight> {
  const cached = pf.__qsdPreflight;
  // failures are cached briefly too, so a public endpoint cannot be used to hammer the quantum provider
  if (cached && Date.now() - cached.at < (cached.result.ok ? PREFLIGHT_TTL_MS : 10_000)) return cached.result;
  const problems: string[] = [];
  const check = async (what: string, fn: () => unknown): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      problems.push(`${what}: ${redactSecrets(e instanceof Error ? e.message : String(e))}`);
    }
  };
  await check('genesis config', () => genesisConfig());
  await Promise.all([
    check('protocol wallet', async () => {
      const chain = getChain();
      const wei = await chain.creatorBalance();
      if (wei < PREFLIGHT_MIN_CREATOR_WEI) throw new Error(`holds ${wei} wei of HYPE, needs at least ${PREFLIGHT_MIN_CREATOR_WEI} wei to pay network fees`);
      await chain.publicClient.getBlockNumber();
    }),
    check('quantum provider', () => qrngProbe()),
  ]);
  const result: LaunchPreflight = { ok: problems.length === 0, problems };
  pf.__qsdPreflight = { at: Date.now(), result };
  return result;
}

/** Run the real launch, yielding SSE frames. Throws only before the first frame; later errors arrive as `error` frames. */
export async function* runLaunch(form: LaunchForm): AsyncGenerator<LaunchFrame> {
  const frames: LaunchFrame[] = [];
  const push = (event: string, data: unknown): void => {
    frames.push({ event, data: typeof data === 'string' ? data : JSON.stringify(data, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)) });
  };
  const drain = function* (): Generator<LaunchFrame> {
    while (frames.length) yield frames.shift()!;
  };

  const timer = stepTimer();
  try {
    validateLaunchForm(form);
    if (await tickerTaken(form.ticker)) throw new LaunchValidationError(tickerTakenMessage(form.ticker));
    const chain = getChain();
    const genesis = genesisConfig();
    const preset = launchPresets().find((p) => p.id === form.halfLifePreset)!;
    try {
      await verifyChallenge({ purpose: 'launch', wallet: form.wallet, subject: form.ticker, nonce: form.walletNonce, signature: form.walletSignature });
    } catch (e) {
      throw new LaunchValidationError(e instanceof AuthError ? e.message : e instanceof Error ? e.message : String(e));
    }

    push('status', { step: 'payment', message: 'verifying payment' });
    yield* drain();
    await verifyPayment(form, chain.creatorAddress());
    timer.mark('payment check');

    // The signature is already consumed. Count the launch before any keygen,
    // randomness draw, or pool deposit the deployer wallet pays for.
    if (!(await spendBudget(`launch:wallet:${form.wallet.toLowerCase()}`, launchWalletLimit(), DAY_MS))) throw new LaunchValidationError(LAUNCH_WALLET_LIMIT_MESSAGE);
    if (!(await spendBudget('launch:global', launchGlobalLimit(), DAY_MS))) throw new LaunchValidationError(LAUNCH_GLOBAL_LIMIT_MESSAGE);

    const session = await chain.withCreator();
    const { address, anchor } = session;
    const tokenDecimals = 18;
    const scale = 10n ** BigInt(tokenDecimals - genesis.decimals);
    const minted = genesis.supplyUnits * scale;
    let ca: Address;
    let salt: Hex | null = null;
    if (chain.network === 'mainnet') {
      if (!session.launcher || !session.openPool) throw new Error('the pool launcher is not configured');
      salt = keccak256(toHex0x(crypto.getRandomValues(new Uint8Array(32))));
      ca = predictedPoolTokenAddress(session.launcher, salt, { name: form.name.trim(), symbol: form.ticker, supply: minted, recipient: session.launcher });
    } else {
      ca = session.predictedCa;
    }

    // 1. The contract address is reserved before any send and vaulted.
    //    Testnet: CREATE at the deployer's nonce after the two anchors.
    //    Mainnet: CREATE2 from the launcher, so the anchors do not move it.
    await chain.vault.storeSecret(`qsd/mint/${ca}`, new TextEncoder().encode(ca));
    push('status', { step: 'mint', message: 'contract address reserved and vaulted', ca });
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
      if (!streamedCryptoEvent(e)) return;
      batch.push(redactEvent(e));
      if (batch.length >= CRYPTO_BATCH) flush();
    });
    push('status', { step: 'identity', message: 'generating the launch identity (WOTS+ chains, Merkle tree)' });
    yield* drain();
    const { entry, identity } = await chain.reserve.createForCoin(ca, { observer: { observer } });
    flush();
    yield* drain();
    const identityRoot = identity.rootHex;
    timer.mark('identity');

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
    const chainFrame = (e: ReserveChainEvent): void => {
      if (e.type === 'anchorRequested') push('chain', { type: 'anchorSubmitted', seq: chainSeq++ } satisfies SceneChainEvent);
      if (e.type === 'anchored') push('chain', { type: 'anchored', seq: chainSeq++, txSignature: e.txSignature } satisfies SceneChainEvent);
    };
    const { bundle } = await client.measure(inputs, launchLineageResolver, {
      beforeDraw: async (b) => {
        await anchor(b.inputsHash, 'precommit', b.nonce);
      },
    });
    yield* drain();
    timer.mark('precommit anchor + quantum draw');
    const lineageId = (bundle.outcome.value as { lineageId: string }).lineageId;
    const launchBundleHash = bundleHash(bundle);

    // 5. sign the launch statement with the identity's first one-time key (through the reserve's Signer).
    const statement = canonicalJson({ ca, identityRoot, lineageId, launchBundleHash, imageHash, halfLifeSec: preset.halfLifeSec });
    // the identity just generated: rebuilding it from the vault would run key generation a second time
    const signer = chain.reserve.signerForIdentity(identity);
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
    timer.mark('signature + proof anchor');

    // 7. On mainnet, open a one-sided Uniswap v3 pool. No HYPE is deposited. The optional first buy is swapped in the same transaction.
    //    On testnet there is no Uniswap deployment, so the coin is the ERC-20 only.
    push('status', { step: 'launch', message: chain.network === 'mainnet' ? 'opening the HYPE pool on Elysium' : 'deploying the coin on Elysium' });
    yield* drain();
    const launch =
      chain.network === 'mainnet'
        ? await (async () => {
            const firstBuy = BigInt(form.devBuyWei);
            const bal = await session.balanceWei();
            if (bal < firstBuy) throw new Error(`protocol wallet holds ${bal} wei of HYPE, needs ${firstBuy} wei to fill the first buy`);
            return session.openPool!({ name: form.name.trim(), symbol: form.ticker, supply: minted, creator: form.wallet as Address, firstBuyWei: firstBuy, seedWei: 0n, salt: salt! });
          })()
        : await session.deployToken({ name: form.name.trim(), symbol: form.ticker, supply: minted, recipient: address });
    if (launch.ca.toLowerCase() !== ca.toLowerCase()) throw new Error(`deployed ${launch.ca} does not match the reserved ${ca}`);
    timer.mark('elysium deploy');
    push('launch', { ca: launch.ca, txSignature: launch.txHash, path: launch.path, ...('pair' in launch ? { pair: launch.pair } : {}) });
    yield* drain();

    // 8. persist.
    const bornAt = nowSeconds();
    const imageUri = `/api/coin/${ca}/image`;
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
      supply: { totalUnits: genesis.supplyUnits, remainingUnits: genesis.supplyUnits, decimals: genesis.decimals },
      state: 'superposed',
      lastActivityAt: bornAt,
      measurements: [],
      bornAt,
    };
    try {
      await db().$transaction(async (tx) => {
        const paymentTx = BigInt(form.devBuyWei) > 0n ? form.paymentSignature : null;
        if (paymentTx) await assertPaymentUnused(tx, paymentTx);
        await insertCoinWith(tx, coin, {
          launchPath: launch.path,
          launchTx: launch.txHash,
          launchBundle: bundle as unknown as ProofBundle,
          createdBy: form.wallet,
          paymentTx,
          website: form.website,
          twitter: form.twitter,
          telegram: form.telegram,
        });
      });
    } catch (e) {
      if (isTickerUniqueViolation(e)) throw new LaunchValidationError(tickerTakenMessage(form.ticker));
      if (isPaymentUniqueViolation(e)) throw new LaunchValidationError(PAYMENT_USED);
      throw e;
    }
    await db().coinImage.create({ data: { coinCa: ca, mime: form.image.mime, bytes: Buffer.from(form.image.bytes) } });
    await syncIdentityMirror(ca);
    await logEvent({
      type: 'launch',
      coinCa: ca,
      tx: launch.txHash,
      summary: `${coin.ticker} launched (generation 1, half-life ${preset.label}, ${launch.path}); identity ${entry.identityRoot.slice(0, 16)}…`,
      data: { signatureIndex: signed.index, signatureBytes: signed.signature.length, launchBundleHash, proofTx: proofAnchor.txSignature, paymentTx: form.paymentSignature, whype: chain.whype },
    });
    await publish({ type: 'coin', ca });

    timer.mark('save');
    console.info(`[launch] ${ca} timings: ${timer.summary()}`);
    push('status', { step: 'timings', message: `timings: ${timer.summary()}`, timings: timer.all() });
    const lineage: LineageInput = { ca, generation: 1 };
    push('lineage', lineage);
    push('done', { ca });
    yield* drain();
  } catch (e) {
    console.info(`[launch] failed after: ${timer.summary()}`);
    // Never forward a raw chain/RPC error: web3.js fetch errors can carry the RPC URL and its api-key.
    push('error', { message: redactSecrets(e instanceof Error ? e.message : String(e)) });
    yield* drain();
  }
}
