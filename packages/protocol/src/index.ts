/**
 * @qsd/protocol — the QSD game rules. Pure TypeScript, no I/O, no clock:
 * every function takes `now`. See README.md for the state machine and the
 * formulas, and /docs/economics.md for the public explanation.
 */

// Parameters
export {
  PROTOCOL_PARAMS,
  HALF_LIFE_PRESETS,
  maxWindowSec,
  BPS,
  PPM,
  PPB,
  type ProtocolParams,
  type ProtocolParamName,
  type HalfLifePreset,
} from './params.js';

// Types
export type {
  UnixSeconds,
  Hex,
  Address,
  CoinState,
  Range,
  BigRange,
  ParamRanges,
  Channel,
  CoinImage,
  CoinSupply,
  MeasurementOutcome,
  MeasurementInputs,
  MeasurementBundle,
  Measurement,
  Coin,
  HolderSnapshot,
  AllocationInput,
  AllocationEntry,
  AllocationTable,
  AllocationProof,
  DaughterParams,
  MotherFinalState,
} from './types.js';

// Errors
export { ProtocolError, InvalidStateError, BundleMismatchError, NotImplementedError } from './errors.js';

// Decay and Zeno
export {
  MEASURABLE_STATES,
  isMeasurable,
  assertHalfLife,
  quietSeconds,
  decayProgressFor,
  decayProgress,
  decayProgressPpb,
  nextAutoMeasureAt,
  isAutoMeasureDue,
  zenoResetBps,
  resetQuietTime,
  applyBuy,
} from './decay.js';

// Resolver
export {
  MEASUREMENT_RESOLVER_ID,
  RESOLVER_DRAW_BYTES,
  measurementResolver,
  resolveMeasurement,
  outcomeLabel,
  parseOutcome,
  validateChannels,
  validateMeasurementInputs,
  readU64,
} from './resolver.js';

// Measurement
export {
  measurementInputs,
  applyMeasurement,
  collapseMeasurement,
  survivedMeasurementIds,
  resolvePoolUnits,
  collapseRewards,
  surviveRebate,
  type ApplyMeasurementOptions,
  type ApplyMeasurementResult,
  type CollapseRewards,
} from './measurement.js';

// Daughter
export {
  GENERATION_SEPARATOR,
  daughterName,
  baseName,
  initialImageLineage,
  nextImageLineage,
  longevityBps,
  generationPenaltyBps,
  daughterHalfLifeSec,
  bandWidthBps,
  daughterBand,
  daughterParamsFrom,
  motherFinalState,
  deriveDaughterParams,
  buildDaughterCoin,
  type DaughterBirth,
} from './daughter.js';

// Allocation
export {
  ALLOCATION_VERSION,
  ALLOCATION_TREE_SEED,
  ALLOCATION_TREE_SEED_HEX,
  EMPTY_LEAF,
  EMPTY_LEAF_HEX,
  durationScoreBps,
  measurementScoreBps,
  entanglementWeightBps,
  compareWallets,
  allocationLeaf,
  paddedLeaves,
  allocationTree,
  computeAllocation,
  allocationProof,
  verifyAllocationProof,
  allocationRoot,
  weightToNumber,
  type WeightInputs,
  type WeightContext,
} from './allocation.js';
