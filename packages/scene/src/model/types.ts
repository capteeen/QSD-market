/**
 * Headless model types for @qsd/scene.
 *
 * Nothing in this file imports React or three. The model is a pure reducer
 * over the real event streams of @qsd/crypto, @qsd/quantum and the chain
 * package, plus two *inputs* (superposition ranges from the protocol package,
 * lineage from the app) and a single control event (`skipStage`).
 */
import type { CryptoEvent } from '@qsd/crypto';
import type { Attestation, QuantumEvent } from '@qsd/quantum';

// ---------------------------------------------------------------------------
// Constants (mirror @qsd/crypto; the reducer validates events against them)
// ---------------------------------------------------------------------------

/** WOTS+ chains per one-time key (64 message + 3 checksum). */
export const CHAINS = 67;
/** Links (positions) per chain: depth 0 … 15. */
export const LINKS = 16;
/** One-time keys per identity (tree height 8). */
export const LEAVES = 256;
/** Merkle tree height. */
export const TREE_HEIGHT = 8;
/** Internal (fused) nodes of a 256-leaf tree: 128+64+32+16+8+4+2+1. */
export const FUSED_NODES = 255;
/** Hash length in bytes. */
export const HASH_BYTES = 32;
/** Instances in the chain ring of the leaf in view: exactly 67 × 16. */
export const CHAIN_INSTANCES = CHAINS * LINKS;

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export type Stage = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const STAGE_NAMES: Readonly<Record<Stage, string>> = {
  1: 'INITIALIZATION',
  2: 'KEY GENERATION',
  3: 'MERKLE',
  4: 'SUPERPOSITION',
  5: 'QUANTUM DRAW',
  6: 'SIGNING',
  7: 'ANCHORING',
  8: 'LINEAGE',
};

// ---------------------------------------------------------------------------
// Inputs that are not event streams
// ---------------------------------------------------------------------------

/** One decay channel of a coin in superposition. `probability` is in ppm (parts per million). */
export interface DecayChannelInput {
  id: string;
  /** Parts per million; all channels of a coin sum to 1 000 000. */
  probability: number;
  label: string;
}

/**
 * The protocol package's superposition ranges. The app maps its `Coin` to this
 * shape; the scene depends on nothing else from the protocol package.
 */
export interface SuperpositionInput {
  supplyMin: bigint;
  supplyMax: bigint;
  halfLifeSec: number;
  decayChannels: readonly DecayChannelInput[];
}

/** The coin's place in its lineage, for stage 8 and the collapse scene. */
export interface LineageInput {
  /** Contract address of the coin this sequence launches. */
  ca: string;
  generation: number;
  /** Present when the coin is a daughter. */
  mother?: {
    ca: string;
    generation: number;
    /** How the mother ended. */
    finalState: 'collapsed' | 'tunnelled';
    /** The decay channel that was selected, if the mother collapsed. */
    channelLabel?: string;
    measurementsSurvived?: number;
  };
}

// ---------------------------------------------------------------------------
// Chain (Solana) events — defined here so the scene does not wait on /packages/solana
// ---------------------------------------------------------------------------

export type ChainEvent =
  | {
      type: 'anchorSubmitted';
      seq: number;
      /** Known once the transaction is signed locally, before confirmation. */
      txSignature?: string;
    }
  | {
      type: 'anchored';
      seq: number;
      /** Base58 Solana transaction signature. */
      txSignature: string;
      slot?: number;
    };

export interface ChainObserver {
  subscribe(listener: (event: ChainEvent) => void): () => void;
}

/** Minimal observable shape the scene needs from every source. */
export interface Observable<E> {
  subscribe(listener: (event: E) => void): () => void;
}

// ---------------------------------------------------------------------------
// Scene events (what the reducer consumes)
// ---------------------------------------------------------------------------

export type SuperpositionEvent = { type: 'superposition'; input: SuperpositionInput };
export type LineageEvent = { type: 'lineage'; input: LineageInput };

export type ControlEvent =
  | {
      /**
       * Advance the stage label. Never fabricates geometry: counts remain
       * exactly what the events produced. `to` jumps to a later stage; omitted
       * = next stage.
       */
      type: 'skipStage';
      to?: Stage;
    }
  | { type: 'reset' };

export type SceneEvent =
  | CryptoEvent
  | QuantumEvent
  | ChainEvent
  | SuperpositionEvent
  | LineageEvent
  | ControlEvent;

export type SceneEventType = SceneEvent['type'];

/** Which seq watermark an event is checked against. */
export type EventSource = 'crypto' | 'quantum' | 'chain';

// ---------------------------------------------------------------------------
// Scene state
// ---------------------------------------------------------------------------

export interface KeygenState {
  started: boolean;
  /** From keygenStart; 0 until then. */
  leaves: number;
  chains: number;
  links: number;
  /** Leaf whose chains are rendered in the ring (the leaf of the latest chainStep). -1 before any. */
  currentLeaf: number;
  /**
   * Computed links per chain of `currentLeaf` (0..16): the number of DISTINCT
   * depths whose chainStep has arrived for chain i of the leaf in view. A
   * duplicate chainStep is rejected and never counted.
   */
  depths: Int8Array;
  /** 1 if the chainStep for link [chainIdx * 16 + depth] of the leaf in view has arrived. Cleared on leaf change. */
  linkArrived: Uint8Array;
  /** Hashes of the leaf in view, [chainIdx * 16 + depth] × 32 bytes — for hover. Cleared on leaf change. */
  currentLeafHashes: Uint8Array;
  /** Aggregate: chainStep events per leaf (max 1072 each), all 256 leaves. */
  linksPerLeaf: Uint16Array;
  /** Aggregate: chainComplete events per leaf (max 67 each). */
  chainsCompletePerLeaf: Uint8Array;
  /** Running totals. `chainSteps` counts every accepted chainStep event; a re-delivered one (same leaf/chain/depth) is counted here AND in `duplicateSteps`, never as a new link. */
  chainSteps: number;
  duplicateSteps: number;
  chainsComplete: number;
  leavesFormed: number;
  /** 1 if leafFormed arrived for that leaf. */
  leafFormed: Uint8Array;
  /** The 256 leaf hashes (L-tree outputs), public. */
  leafHashes: Uint8Array;
  /** Latest chainStep for the side panel. */
  lastChainIdx: number;
  lastDepth: number;
  lastHash: Uint8Array | null;
}

export interface MerkleState {
  /** Fused pairs per level (level = children's level, 0..7). Full = [128,64,32,16,8,4,2,1]. */
  fusedPerLevel: Uint16Array;
  fusedTotal: number;
  /** 1 if the fused node at flat index (see `fusedNodeOffset`) has arrived. */
  fusedFlags: Uint8Array;
  /** Parent hashes, flat index × 32 bytes. */
  fusedHashes: Uint8Array;
  /** Highest level fused so far, -1 before any. */
  highestLevel: number;
  root: Uint8Array | null;
}

export interface CloudState {
  /** Input as provided, or null → nothing to render. */
  input: SuperpositionInput | null;
  /** Relative supply spread (supplyMax − supplyMin) / supplyMax, clamped 0..1. Drives breathing amplitude. */
  width: number;
  /** Half-life in seconds, drives the ring's rotation rate. 0 when the input is not a finite positive number: renderers treat 0 as "unavailable" (the panel shows the unavailable state, the ring does not turn). */
  halfLifeSec: number;
  /** Channels with probability as a fraction 0..1 and a percent label. */
  channels: readonly { id: string; label: string; fraction: number; percentLabel: string }[];
}

export type DrawPhase = 'idle' | 'requested' | 'arrived' | 'committed' | 'resolved';

export interface DrawState {
  phase: DrawPhase;
  providerId: string | null;
  nBytes: number;
  requestedAt: string | null;
  /** Raw entropy bytes exactly as they arrived. */
  entropy: Uint8Array | null;
  attestation: Attestation | null;
  /** Timestamp of the entropyArrived event. */
  arrivedAt: string | null;
  commitment: string | null;
  outcome: { value: unknown; label: string } | null;
  resolvedAt: string | null;
  /** How many outcomeResolved events have been seen (collapse flashes = this count). */
  resolvedCount: number;
}

export interface SignatureState {
  started: boolean;
  index: number;
  r: Uint8Array | null;
  digest: Uint8Array | null;
  /** Stop depth per chain, -1 until signChainStop for that chain. */
  stopDepths: Int8Array;
  stopHashes: Uint8Array;
  stopsSeen: number;
  /** Auth path sibling per level, 8 × 32 bytes; `authSeen` flags. */
  authPath: Uint8Array;
  authSeen: Uint8Array;
  authCount: number;
  ready: boolean;
  /** Signature size in bytes once ready. */
  bytesLength: number | null;
}

export interface AnchorState {
  submitted: boolean;
  anchored: boolean;
  txSignature: string | null;
  slot: number | null;
}

export interface EventAccounting {
  accepted: number;
  rejected: number;
  lastRejectedReason: string | null;
  /** Last accepted seq per source, -1 before any. */
  lastSeq: Record<EventSource, number>;
}

export interface SceneState {
  stage: Stage;
  /** Stages that were skipped by the user (label advanced without their events). */
  skipped: readonly Stage[];
  /** Bumped on every accepted event; renderers compare it to know if anything changed. */
  version: number;
  keygen: KeygenState;
  merkle: MerkleState;
  cloud: CloudState;
  draw: DrawState;
  signature: SignatureState;
  anchor: AnchorState;
  lineage: LineageInput | null;
  events: EventAccounting;
}
