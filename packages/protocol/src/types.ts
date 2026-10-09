import type { JsonValue, ProofBundle } from '@qsd/quantum';

/** Unix time in whole seconds. The protocol never reads a clock; callers pass `now`. */
export type UnixSeconds = number;

/** Lowercase hex, no 0x prefix. */
export type Hex = string;

/** Solana base58 address (contract address or wallet). Opaque to the protocol. */
export type Address = string;

export type CoinState = 'superposed' | 'measured-alive' | 'collapsed' | 'tunnelled';

/** Inclusive integer range used for daughter parameters. */
export interface Range {
  min: number;
  max: number;
}

export interface BigRange {
  min: bigint;
  max: bigint;
}

/** The ranges a decay channel allows for the daughter it would produce. */
export interface ParamRanges {
  /** Daughter half-life range, seconds; clamped to [HALF_LIFE_MIN_SEC, HALF_LIFE_MAX_SEC]. */
  halfLifeSec: Range;
  /**
   * Outer bounds of the daughter's allocation pool (units of the daughter
   * reserved for the mother's holders). The daughter's published band is a
   * sub-interval of this, narrowed by the mother's longevity.
   */
  poolUnits: BigRange;
}

export interface Channel {
  id: string;
  /** Probability of this channel being selected on collapse, parts per million. All channels sum to 1 000 000. */
  probabilityPpm: number;
  daughterParams: ParamRanges;
  label: string;
}

export interface CoinImage {
  uri: string;
  /** sha256 of the image bytes, hex. */
  hash: Hex;
  /** sha256 chain over the lineage's image hashes, hex. See nextImageLineage(). */
  lineage: Hex;
}

export interface CoinSupply {
  /** Total units minted, base units. */
  totalUnits: bigint;
  /** Units still in circulation (total − burned), base units. */
  remainingUnits: bigint;
  decimals: number;
}

export type MeasurementOutcome =
  | { kind: 'survive' }
  | { kind: 'tunnel' }
  | {
      kind: 'collapse';
      channelId: string;
      channelIndex: number;
      /** Where in the mother's superposition band the daughter pool landed, ppm. */
      poolPointPpm: number;
    };

/** The JSON the resolver is applied to. Hashed into the proof bundle; no floats. */
export interface MeasurementInputs {
  [key: string]: JsonValue;
  ca: Address;
  /** decayProgress at the moment of measurement, parts per billion. */
  decayProgressPpb: number;
  channels: { id: string; probabilityPpm: number }[];
  tunnelProbabilityPpm: number;
  /** Index of this measurement in the coin's history (0 for the first). */
  measurementIndex: number;
}

export type MeasurementBundle = ProofBundle<MeasurementInputs>;

export interface Measurement {
  /** bundleHash(proofBundle): sha256 of the canonical bundle. */
  id: Hex;
  at: UnixSeconds;
  /** Wallet of the measurer, or PROTOCOL_PARAMS.AUTO_MEASURER_ID. */
  by: Address | 'protocol';
  proofBundle: MeasurementBundle;
  outcome: MeasurementOutcome;
  decayBefore: number;
  decayAfter: number;
}

export interface Coin {
  ca: Address;
  name: string;
  ticker: string;
  image: CoinImage;
  /** Shared by every coin descending from the same generation-1 launch. */
  lineageId: string;
  /** 1 for a fresh launch, 2 for its daughter, and so on. */
  generation: number;
  motherCa?: Address;
  daughterCa?: Address;
  /** The launch identity's Merkle root (@qsd/crypto), hex. */
  identityRoot: Hex;
  halfLifeSec: number;
  /**
   * decayProgress as of the last state write. Informational: always use
   * decayProgress(coin, now) for the live value.
   */
  decayProgress: number;
  decayChannels: Channel[];
  /** Band of daughter units reserved for holders; resolved to a point by the collapse draw. */
  superposition: { supplyMin: bigint; supplyMax: bigint };
  supply: CoinSupply;
  state: CoinState;
  /**
   * Origin of the quiet clock. Equals the time of the last buy when no
   * partial reset has been applied; Zeno resets and survives move it forward
   * by a fraction of the quiet time elapsed, so it is "the effective time
   * since which the coin has been quiet", not literally the last trade.
   */
  lastActivityAt: UnixSeconds;
  measurements: Measurement[];
  bornAt: UnixSeconds;
  collapsedAt?: UnixSeconds;
}

export interface HolderSnapshot {
  wallet: Address;
  /** Mother units held at the collapse block. */
  balance: bigint;
  /** Start of the wallet's current unbroken holding period. */
  firstAcquiredAt: UnixSeconds;
  /** Ids of mother measurements the wallet held through (it held before and after). */
  heldThroughMeasurementIds: string[];
  /** True iff firstAcquiredAt <= quietPeriodStart and the wallet still held at collapse. */
  heldThroughQuietPeriod: boolean;
}

export interface AllocationInput {
  snapshot: HolderSnapshot[];
  /** The mother's measurements. Only survived ones count for the measurement score. */
  measurements: Pick<Measurement, 'id' | 'outcome'>[];
  bornAt: UnixSeconds;
  collapseAt: UnixSeconds;
  /** Start of the final quiet period: the coin's lastActivityAt at collapse. */
  quietPeriodStart: UnixSeconds;
  /** Daughter units to distribute (the resolved pool). */
  totalDaughterUnits: bigint;
}

export interface AllocationEntry {
  wallet: Address;
  bagUnits: bigint;
  /** bagUnits / Σ bagUnits, parts per billion (floor). */
  bagFractionPpb: number;
  /** Entanglement weight in basis points, 10 000..15 000. */
  weightBps: number;
  /** units / totalUnits, parts per billion (floor). */
  sharePpb: number;
  /** Daughter units this wallet receives. */
  units: bigint;
  /** Merkle leaf = sha256(canonical({wallet, units})), hex. */
  leaf: Hex;
}

export interface AllocationTable {
  version: 'qsd-allocation/v1';
  /** Sorted by wallet ascending (UTF-16 code unit order). */
  entries: AllocationEntry[];
  totalUnits: bigint;
  /** Σ entries.units. */
  allocatedUnits: bigint;
  /** totalUnits − allocatedUnits, burned. Always < entries.length. */
  dustUnits: bigint;
  merkleRoot: Hex;
  /** Number of leaves after padding (power of two, ≥ 2). */
  leafCount: number;
}

export interface AllocationProof {
  /** Leaf index in the padded, wallet-sorted leaf list. */
  index: number;
  /** Sibling hashes, leaf level first, hex. */
  path: Hex[];
}

export interface DaughterParams {
  halfLifeSec: number;
  superposition: { supplyMin: bigint; supplyMax: bigint };
  decayChannels: Channel[];
  /** The longevity score the mapping used, bps 0..10 000, for display. */
  longevityBps: number;
  name: string;
  generation: number;
  imageLineage: Hex;
}

/** The mother's final state as the daughter mapping sees it. */
export interface MotherFinalState {
  halfLifeSec: number;
  lifetimeSec: number;
  measurementsSurvived: number;
  supplyRemainingBps: number;
  generation: number;
}
