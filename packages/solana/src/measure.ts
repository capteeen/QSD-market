/**
 * Measurement composition (what §7 of @qsd/protocol asks the chain package for):
 *
 *   inputs   = measurementInputs(coin, at)
 *   precommit: anchor `qsd:v1:precommit:<hashJson(inputs)>:<nonce>` ON-CHAIN   ← before any draw (security.md H-Q3)
 *   draw     = client.measure(inputs, measurementResolver, { nonce, inputsHash })
 *   proof    : anchor `qsd:v1:proof:<bundleHash(bundle)>`
 *   apply    = applyMeasurement(coin, bundle, { at, by, verify })
 *
 * Both signatures are journalled so the proof panel shows precommit tx + bundle tx.
 *
 * The anchor runs inside @qsd/quantum's `beforeDraw` hook: if the precommit
 * transaction fails, no draw is requested. The client binds (inputsHash,
 * nonce) into the witness statement and the commitment, so the bundle names
 * the same measurement the memo does.
 */
import { randomBytes, bytesToHex } from '@noble/hashes/utils.js';
import {
  measurementInputs,
  measurementResolver,
  applyMeasurement,
  isAutoMeasureDue,
  PROTOCOL_PARAMS,
  type Coin,
  type Measurement,
  type MeasurementInputs,
  type MeasurementOutcome,
  type UnixSeconds,
  type MeasurementBundle,
} from '@qsd/protocol';
import { bundleHash, hashJson, trustedWitnessKeysFromEnv, type DrawBinding, type JsonValue, type OutcomeResolver, type ProofBundle, type VerifyBundleOptions } from '@qsd/quantum';
import type { AnchorFn, AnchorResult } from './anchor.js';
import { ChainError } from './errors.js';
import type { JournalStore } from './journal.js';

/** The slice of @qsd/quantum's QrngClient this module needs. */
export interface MeasureClient {
  measure<I extends JsonValue>(
    inputs: I,
    resolver: OutcomeResolver<I>,
    opts?: { nBytes?: number; nonce?: string; beforeDraw?: (binding: DrawBinding) => void | Promise<void> },
  ): Promise<{ bundle: ProofBundle<I>; binding: DrawBinding }>;
}

export interface MeasurementJournalDoc {
  version: 1;
  ca: string;
  at: UnixSeconds;
  by: string;
  measurementIndex: number;
  inputsHash: string;
  nonce: string;
  precommitTx?: string;
  bundleHash?: string;
  proofTx?: string;
  outcome?: string;
  completedAt?: string;
}

export interface MeasureDeps {
  client: MeasureClient;
  anchor: AnchorFn;
  /** Passed to applyMeasurement → @qsd/quantum verify(); trusted witness keys in production. */
  verify?: VerifyBundleOptions;
  /** Optional per-measurement journal (precommit tx + proof tx). */
  journal?: JournalStore<MeasurementJournalDoc>;
  /** Injectable nonce source (tests); 32 random bytes by default. */
  random?: (n: number) => Uint8Array;
}

export interface MeasureResult {
  coin: Coin;
  measurement: Measurement;
  outcome: MeasurementOutcome;
  inputs: MeasurementInputs;
  inputsHash: string;
  nonce: string;
  precommit: AnchorResult;
  proof: AnchorResult;
  bundle: MeasurementBundle;
}

export const PRECOMMIT_NONCE_BYTES = 32;

export async function measureCoin(coin: Coin, opts: { by: string; at: UnixSeconds }, deps: MeasureDeps): Promise<MeasureResult> {
  const { at, by } = opts;
  const inputs = measurementInputs(coin, at);
  const inputsHash = hashJson(inputs);
  const nonceBytes = (deps.random ?? randomBytes)(PRECOMMIT_NONCE_BYTES);
  if (nonceBytes.length !== PRECOMMIT_NONCE_BYTES) throw new ChainError(`nonce must be ${PRECOMMIT_NONCE_BYTES} bytes`);
  const nonce = bytesToHex(nonceBytes);

  const doc: MeasurementJournalDoc = { version: 1, ca: coin.ca, at, by, measurementIndex: inputs.measurementIndex, inputsHash, nonce };
  await deps.journal?.save(doc);

  // 1 + 2. Pre-commit on-chain BEFORE requesting entropy (inside beforeDraw: no anchor, no draw), then draw.
  let precommit: AnchorResult | undefined;
  const { bundle, binding } = await deps.client.measure(inputs, measurementResolver, {
    nonce,
    beforeDraw: async (b) => {
      if (b.inputsHash !== inputsHash || b.nonce !== nonce) throw new ChainError('quantum client binding does not match the measurement inputs/nonce');
      precommit = await deps.anchor(inputsHash, 'precommit', nonce);
      doc.precommitTx = precommit.txSignature;
      await deps.journal?.save(doc);
    },
  });
  if (!precommit) throw new ChainError('quantum client drew without calling beforeDraw; refusing an un-precommitted draw');
  if (binding.inputsHash !== inputsHash || binding.nonce !== nonce) throw new ChainError('bundle binding differs from the anchored precommit');
  const bh = bundleHash(bundle);
  doc.bundleHash = bh;
  await deps.journal?.save(doc);

  // 3. Anchor the bundle.
  const proof = await deps.anchor(bh, 'proof');
  doc.proofTx = proof.txSignature;
  await deps.journal?.save(doc);

  // 4. Apply (verifies the bundle against the coin at `at`).
  const applied = applyMeasurement(coin, bundle, deps.verify ? { at, by, verify: deps.verify } : { at, by });
  doc.outcome = applied.measurement.outcome.kind;
  doc.completedAt = new Date().toISOString();
  await deps.journal?.save(doc);

  return { coin: applied.coin, measurement: applied.measurement, outcome: applied.outcome, inputs, inputsHash, nonce, precommit, proof, bundle };
}

/** Coins whose auto-measurement window has elapsed at `now`. */
export function autoMeasureDue(coins: readonly Coin[], now: UnixSeconds): Coin[] {
  return coins.filter((c) => isAutoMeasureDue(c, now));
}

/** Auto-measure every due coin; failures are collected, not thrown, so one outage does not block the rest. */
export async function autoMeasureAll(coins: readonly Coin[], now: UnixSeconds, deps: MeasureDeps): Promise<{ results: MeasureResult[]; failures: { ca: string; error: string }[] }> {
  const results: MeasureResult[] = [];
  const failures: { ca: string; error: string }[] = [];
  for (const c of autoMeasureDue(coins, now)) {
    try {
      results.push(await measureCoin(c, { by: PROTOCOL_PARAMS.AUTO_MEASURER_ID, at: now }, deps));
    } catch (e) {
      failures.push({ ca: c.ca, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { results, failures };
}

/**
 * Verify options for production measurement: the published witness keys from
 * `QSD_WITNESS_PUBLIC_KEYS` (see @qsd/quantum) and a mandatory draw binding,
 * so a bundle whose attestation does not name (inputsHash, nonce) is refused.
 * Devnet tests with UNSAFE_DEV_RANDOM use `{ allowUnsafeDev: true }` instead.
 */
export function productionVerifyOptions(env: Record<string, string | undefined> = process.env): VerifyBundleOptions {
  return { trustedWitnessKeys: trustedWitnessKeysFromEnv(env), requireInputBinding: true };
}
