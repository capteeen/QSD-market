/**
 * API data-transfer types shared by route handlers and client code.
 * bigint values travel as decimal strings. Every response is either the
 * payload or `{ unavailable: { reason } }` with HTTP 503.
 */
import type { CoinState, MeasurementOutcome } from '@qsd/protocol';
import type { ProofBundle } from '@qsd/quantum';

export interface Unavailable {
  unavailable: { reason: string };
}

export function isUnavailable(x: unknown): x is Unavailable {
  return typeof x === 'object' && x !== null && 'unavailable' in x && typeof (x as Unavailable).unavailable?.reason === 'string';
}

export interface ChannelDto {
  id: string;
  probabilityPpm: number;
  label: string;
  halfLifeSec: { min: number; max: number };
  poolUnits: { min: string; max: string };
}

export interface MeasurementDto {
  id: string;
  index: number;
  at: number;
  by: string;
  outcome: MeasurementOutcome;
  decayBefore: number;
  decayAfter: number;
  proofBundle: ProofBundle;
  precommitTx: string | null;
  proofTx: string | null;
  attestationKind: string;
}

export interface CoinDto {
  ca: string;
  name: string;
  ticker: string;
  image: { uri: string; hash: string; lineage: string };
  lineageId: string;
  generation: number;
  motherCa: string | null;
  daughterCa: string | null;
  identityRoot: string;
  halfLifeSec: number;
  decayProgress: number;
  decayChannels: ChannelDto[];
  superposition: { supplyMin: string; supplyMax: string };
  supply: { totalUnits: string; remainingUnits: string; decimals: number };
  state: CoinState;
  lastActivityAt: number;
  bornAt: number;
  collapsedAt: number | null;
  launchPath: string;
  launchTx: string;
  createdBy: string | null;
  measurements: MeasurementDto[];
  /** Server clock at response time (unix seconds) so clients compute live decay consistently. */
  now: number;
  /** Number of distinct wallets that bought the coin (from the trade log); null when no trade has been seen. */
  holderCount: number | null;
  /** Recent trade activity 0..1 (the app's own normalisation; see README). */
  activity: number;
  nextAutoMeasureAt: number | null;
}

export interface CoinSummaryDto {
  ca: string;
  name: string;
  ticker: string;
  generation: number;
  lineageId: string;
  /** The coin this one was born from on collapse; null for a generation-one coin. */
  motherCa: string | null;
  state: CoinState;
  halfLifeSec: number;
  lastActivityAt: number;
  bornAt: number;
  collapsedAt: number | null;
  superposition: { supplyMin: string; supplyMax: string };
  supply: { totalUnits: string; remainingUnits: string; decimals: number };
  activity: number;
  nextAutoMeasureAt: number | null;
  measurementCount: number;
}

export interface CoinsResponse {
  coins: CoinSummaryDto[];
  now: number;
}

export interface HolderDto {
  wallet: string;
  balance: string;
  firstAcquiredAt: number;
  heldThroughMeasurementIds: string[];
  heldThroughQuietPeriod: boolean;
}

export interface HoldersResponse {
  ca: string;
  /** Holders reconstructed from the trade log, or null when no trade has been seen. */
  holders: HolderDto[] | null;
  bornAt: number;
  quietPeriodStart: number;
  measurements: { id: string; outcome: MeasurementOutcome }[];
  superposition: { supplyMin: string; supplyMax: string };
  now: number;
  source: 'trade-log';
}

export interface AirdropProgressDto {
  /** Cohort wallets with a journal entry (pending + sent + confirmed). */
  wallets: number;
  pending: number;
  sent: number;
  confirmed: number;
  /** Unix seconds of the first and last confirmed transfer, null until one confirms. */
  firstConfirmedAt: number | null;
  lastConfirmedAt: number | null;
}

export interface LineageCollapseDto {
  motherCa: string;
  motherName: string;
  motherGeneration: number;
  daughterCa: string | null;
  measurement: MeasurementDto | null;
  allocation: {
    merkleRoot: string;
    rootAnchorTx: string | null;
    totalUnits: string;
    allocatedUnits: string;
    dustUnits: string;
    leafCount: number;
    wallets: number;
    weightMinBps: number | null;
    weightMaxBps: number | null;
    collapseAt: number;
    /** The airdrop journal mirror for this table: one entry per cohort wallet, by status. */
    airdrop: AirdropProgressDto;
  } | null;
  measurementsSurvived: number;
  channelLabel: string | null;
}

export interface LineageResponse {
  id: string;
  genesisCa: string;
  coins: CoinSummaryDto[];
  collapses: LineageCollapseDto[];
  now: number;
}

export interface StatsResponse {
  counters: {
    superposed: number;
    measurementsToday: number;
    collapses: number;
    daughters: number;
    tunnels: number;
    qsdBurned: string;
  };
  nextBurnAt: string | null;
  health: {
    db: boolean;
    redis: boolean;
    /** True iff a QRNG provider is configured for this process (the draw itself can still fail). */
    qrng: { configured: boolean; providerId: string | null; reason: string | null };
    chain: { configured: boolean; cluster: 'devnet' | 'mainnet-beta' | null; reason: string | null };
  };
  now: number;
}

export interface LogEntryDto {
  id: string;
  type: string;
  at: string;
  coinCa: string | null;
  refId: string | null;
  tx: string | null;
  summary: string;
}

export interface LogResponse {
  entries: LogEntryDto[];
}

export interface BurnDto {
  id: string;
  tx: string;
  swapTx: string | null;
  lamportsIn: string;
  qsdBurned: string;
  at: string;
}

export interface BurnsResponse {
  burns: BurnDto[];
  totalBurned: string;
  qsdMint: string | null;
}

export interface MeResponse {
  wallet: string;
  created: CoinSummaryDto[];
  held: { coin: CoinSummaryDto; tradedUnits: string | null; tradedUiAmount: number; firstAcquiredAt: number | null }[];
  received: { daughterCa: string; motherCa: string; units: string; sharePpb: number; weightBps: number; merkleRoot: string; status: string | null }[];
  identities: { coinCa: string; root: string; nextIndex: number; remaining: number }[];
  now: number;
}

export interface HowResponse {
  physics: string;
  economics: string;
  source: { physics: string; economics: string };
}

export interface LaunchQuoteResponse {
  cluster: 'devnet' | 'mainnet-beta';
  launchCostLamports: string | null;
  identityReserveLamports: string | null;
  payTo: string | null;
  reasons: { launchCost?: string; identityReserve?: string; payTo?: string };
}

export interface MeasureChallengeResponse {
  nonce: string;
  message: string;
  expiresAt: string;
}

export interface MeasureResponse {
  measurement: MeasurementDto;
  coin: CoinDto;
  /** Collapse outcomes only: whether the daughter launch was handed to the collapse worker. null for survive / tunnel. */
  daughterLaunch: { status: 'scheduled'; reason: null } | { status: 'not-scheduled'; reason: string } | null;
}

/** SSE event names on /api/events. */
export type LiveEvent =
  | { type: 'log'; entry: LogEntryDto }
  | { type: 'measurement'; ca: string; measurementId: string; outcome: MeasurementOutcome['kind']; at: number }
  | { type: 'coin'; ca: string }
  | { type: 'stats' }
  | { type: 'burn'; tx: string }
  | { type: 'heartbeat'; at: string };
