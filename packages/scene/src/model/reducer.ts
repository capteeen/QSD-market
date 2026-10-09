/**
 * `sceneReducer(state, event) → state`
 *
 * The ONLY place stage progression and geometry counts change. Every change
 * is caused by an event from @qsd/crypto, @qsd/quantum, the chain package, an
 * input (superposition / lineage) or the `skipStage` control. There is no
 * clock and no timer anywhere in the model.
 *
 * Complexity: O(1) per event (a chain-ring reset on leaf change is a fixed
 * 67-entry fill). Hash material is kept in typed arrays that are reused in
 * place across events — a `SceneState` is a view that is valid until the next
 * event; call `cloneSceneState` for an independent snapshot. The top-level
 * object and the touched slice object are fresh on every accepted event so
 * store subscribers can compare by reference.
 */
import type { CryptoEvent } from '@qsd/crypto';
import type { QuantumEvent } from '@qsd/quantum';
import {
  CHAINS,
  CHAIN_INSTANCES,
  FUSED_NODES,
  HASH_BYTES,
  LEAVES,
  LINKS,
  TREE_HEIGHT,
  type AnchorState,
  type ChainEvent,
  type CloudState,
  type DrawState,
  type EventSource,
  type KeygenState,
  type MerkleState,
  type SceneEvent,
  type SceneState,
  type SignatureState,
  type Stage,
  type SuperpositionInput,
} from './types.js';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

function initialKeygen(): KeygenState {
  return {
    started: false,
    leaves: 0,
    chains: 0,
    links: 0,
    currentLeaf: -1,
    depths: new Int8Array(CHAINS),
    currentLeafHashes: new Uint8Array(CHAIN_INSTANCES * HASH_BYTES),
    linksPerLeaf: new Uint16Array(LEAVES),
    chainsCompletePerLeaf: new Uint8Array(LEAVES),
    chainSteps: 0,
    chainsComplete: 0,
    leavesFormed: 0,
    leafFormed: new Uint8Array(LEAVES),
    leafHashes: new Uint8Array(LEAVES * HASH_BYTES),
    lastChainIdx: -1,
    lastDepth: -1,
    lastHash: null,
  };
}

function initialMerkle(): MerkleState {
  return {
    fusedPerLevel: new Uint16Array(TREE_HEIGHT),
    fusedTotal: 0,
    fusedFlags: new Uint8Array(FUSED_NODES),
    fusedHashes: new Uint8Array(FUSED_NODES * HASH_BYTES),
    highestLevel: -1,
    root: null,
  };
}

function initialCloud(): CloudState {
  return { input: null, width: 0, halfLifeSec: 0, channels: [] };
}

function initialDraw(): DrawState {
  return {
    phase: 'idle',
    providerId: null,
    nBytes: 0,
    requestedAt: null,
    entropy: null,
    attestation: null,
    arrivedAt: null,
    commitment: null,
    outcome: null,
    resolvedAt: null,
    resolvedCount: 0,
  };
}

function initialSignature(): SignatureState {
  return {
    started: false,
    index: -1,
    r: null,
    digest: null,
    stopDepths: new Int8Array(CHAINS).fill(-1),
    stopHashes: new Uint8Array(CHAINS * HASH_BYTES),
    stopsSeen: 0,
    authPath: new Uint8Array(TREE_HEIGHT * HASH_BYTES),
    authSeen: new Uint8Array(TREE_HEIGHT),
    authCount: 0,
    ready: false,
    bytesLength: null,
  };
}

function initialAnchor(): AnchorState {
  return { submitted: false, anchored: false, txSignature: null, slot: null };
}

export function createInitialState(): SceneState {
  return {
    stage: 1,
    skipped: [],
    version: 0,
    keygen: initialKeygen(),
    merkle: initialMerkle(),
    cloud: initialCloud(),
    draw: initialDraw(),
    signature: initialSignature(),
    anchor: initialAnchor(),
    lineage: null,
    events: { accepted: 0, rejected: 0, lastRejectedReason: null, lastSeq: { crypto: -1, quantum: -1, chain: -1 } },
  };
}

/** Independent deep copy (typed arrays included). */
export function cloneSceneState(s: SceneState): SceneState {
  const k = s.keygen;
  const m = s.merkle;
  const g = s.signature;
  return {
    ...s,
    skipped: [...s.skipped],
    keygen: {
      ...k,
      depths: k.depths.slice(),
      currentLeafHashes: k.currentLeafHashes.slice(),
      linksPerLeaf: k.linksPerLeaf.slice(),
      chainsCompletePerLeaf: k.chainsCompletePerLeaf.slice(),
      leafFormed: k.leafFormed.slice(),
      leafHashes: k.leafHashes.slice(),
      lastHash: k.lastHash ? k.lastHash.slice() : null,
    },
    merkle: {
      ...m,
      fusedPerLevel: m.fusedPerLevel.slice(),
      fusedFlags: m.fusedFlags.slice(),
      fusedHashes: m.fusedHashes.slice(),
      root: m.root ? m.root.slice() : null,
    },
    cloud: { ...s.cloud, channels: [...s.cloud.channels] },
    draw: { ...s.draw, entropy: s.draw.entropy ? s.draw.entropy.slice() : null },
    signature: {
      ...g,
      r: g.r ? g.r.slice() : null,
      digest: g.digest ? g.digest.slice() : null,
      stopDepths: g.stopDepths.slice(),
      stopHashes: g.stopHashes.slice(),
      authPath: g.authPath.slice(),
      authSeen: g.authSeen.slice(),
    },
    anchor: { ...s.anchor },
    events: { ...s.events, lastSeq: { ...s.events.lastSeq } },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flat index base of fused nodes whose children sit at `level`. */
export function fusedNodeOffset(level: number): number {
  let off = 0;
  for (let l = 0; l < level; l++) off += LEAVES >> (l + 1);
  return off;
}

/** Flat index (0..254) of the parent at `index` within level+1. */
export function fusedNodeIndex(level: number, index: number): number {
  return fusedNodeOffset(level) + index;
}

/** Number of parents produced at `level` (children's level). */
export function fusedNodesAtLevel(level: number): number {
  return LEAVES >> (level + 1);
}

const CRYPTO_TYPES = new Set<string>([
  'keygenStart',
  'chainStep',
  'chainComplete',
  'leafFormed',
  'treeLevelFused',
  'rootReady',
  'signStart',
  'signChainStop',
  'authPathNode',
  'signatureReady',
  'verifyStart',
  'verifyChainStep',
  'verifyLeafFormed',
  'verifyLevelFused',
  'verifyResult',
]);
const QUANTUM_TYPES = new Set<string>(['entropyRequested', 'entropyArrived', 'commitmentComputed', 'outcomeResolved']);
const CHAIN_TYPES = new Set<string>(['anchorSubmitted', 'anchored']);
/** Events that begin a new operation may come from a fresh observer whose seq restarts at 0. */
const WATERMARK_RESET = new Set<string>(['keygenStart', 'signStart', 'verifyStart', 'entropyRequested', 'anchorSubmitted']);

export function eventSource(type: string): EventSource | null {
  if (CRYPTO_TYPES.has(type)) return 'crypto';
  if (QUANTUM_TYPES.has(type)) return 'quantum';
  if (CHAIN_TYPES.has(type)) return 'chain';
  return null;
}

function isHash(x: unknown): x is Uint8Array {
  return x instanceof Uint8Array && x.length === HASH_BYTES;
}

function intIn(x: unknown, lo: number, hi: number): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= lo && x < hi;
}

function reject(state: SceneState, reason: string): SceneState {
  return {
    ...state,
    events: { ...state.events, rejected: state.events.rejected + 1, lastRejectedReason: reason },
  };
}

function withStage(state: SceneState, stage: Stage): SceneState {
  return state.stage >= stage ? state : { ...state, stage };
}

function bump(state: SceneState, source: EventSource | null, seq: number | null): SceneState {
  const events = { ...state.events, accepted: state.events.accepted + 1 };
  if (source !== null && seq !== null) events.lastSeq = { ...events.lastSeq, [source]: seq };
  return { ...state, version: state.version + 1, events };
}

/** Relative supply spread as a number in [0, 1], computed with bigint arithmetic. */
export function superpositionWidth(input: SuperpositionInput): number {
  const { supplyMin, supplyMax } = input;
  if (supplyMax <= 0n) return 0;
  const lo = supplyMin < 0n ? 0n : supplyMin;
  if (lo >= supplyMax) return 0;
  const ppm = ((supplyMax - lo) * 1_000_000n) / supplyMax;
  const w = Number(ppm) / 1_000_000;
  return w < 0 ? 0 : w > 1 ? 1 : w;
}

export function cloudFromInput(input: SuperpositionInput): CloudState {
  const channels = input.decayChannels.map((c) => {
    const fraction = Math.min(1, Math.max(0, c.probability / 1_000_000));
    return { id: c.id, label: c.label, fraction, percentLabel: `${(fraction * 100).toFixed(2)}%` };
  });
  return {
    input,
    width: superpositionWidth(input),
    halfLifeSec: Number.isFinite(input.halfLifeSec) && input.halfLifeSec > 0 ? input.halfLifeSec : 0,
    channels,
  };
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

export function sceneReducer(state: SceneState, event: SceneEvent): SceneState {
  const source = eventSource(event.type);

  // --- sequence discipline ---------------------------------------------------
  let seq: number | null = null;
  if (source !== null) {
    seq = (event as { seq: unknown }).seq as number;
    if (!Number.isInteger(seq) || seq < 0) return reject(state, `${event.type}: seq must be a non-negative integer`);
    if (!WATERMARK_RESET.has(event.type) && seq <= state.events.lastSeq[source]) {
      return reject(state, `${event.type}: seq ${seq} is not after ${state.events.lastSeq[source]} (${source})`);
    }
  }

  switch (event.type) {
    // ----------------------------------------------------------------- crypto
    case 'keygenStart': {
      const keygen: KeygenState = { ...state.keygen, started: true, leaves: event.leaves, chains: event.chains, links: event.links };
      return withStage(bump({ ...state, keygen }, source, seq), 2);
    }

    case 'chainStep': {
      if (!intIn(event.leaf, 0, LEAVES)) return reject(state, `chainStep: leaf ${event.leaf} out of range`);
      if (!intIn(event.chainIdx, 0, CHAINS)) return reject(state, `chainStep: chainIdx ${event.chainIdx} out of range`);
      if (!intIn(event.depth, 0, LINKS)) return reject(state, `chainStep: depth ${event.depth} out of range`);
      if (!isHash(event.hash)) return reject(state, 'chainStep: hash must be 32 bytes');
      const k = state.keygen;
      if (event.leaf !== k.currentLeaf) k.depths.fill(0); // fixed-size: O(1)
      const grown = k.depths[event.chainIdx] ?? 0;
      k.depths[event.chainIdx] = grown < LINKS ? grown + 1 : LINKS;
      k.currentLeafHashes.set(event.hash, (event.chainIdx * LINKS + event.depth) * HASH_BYTES);
      k.linksPerLeaf[event.leaf] = (k.linksPerLeaf[event.leaf] ?? 0) + 1;
      const keygen: KeygenState = {
        ...k,
        started: true,
        currentLeaf: event.leaf,
        chainSteps: k.chainSteps + 1,
        lastChainIdx: event.chainIdx,
        lastDepth: event.depth,
        lastHash: event.hash,
      };
      return withStage(bump({ ...state, keygen }, source, seq), 2);
    }

    case 'chainComplete': {
      if (!intIn(event.leaf, 0, LEAVES)) return reject(state, `chainComplete: leaf ${event.leaf} out of range`);
      if (!intIn(event.chainIdx, 0, CHAINS)) return reject(state, `chainComplete: chainIdx ${event.chainIdx} out of range`);
      const k = state.keygen;
      k.chainsCompletePerLeaf[event.leaf] = Math.min(255, (k.chainsCompletePerLeaf[event.leaf] ?? 0) + 1);
      const keygen: KeygenState = { ...k, chainsComplete: k.chainsComplete + 1 };
      return withStage(bump({ ...state, keygen }, source, seq), 2);
    }

    case 'leafFormed': {
      if (!intIn(event.leaf, 0, LEAVES)) return reject(state, `leafFormed: leaf ${event.leaf} out of range`);
      if (!isHash(event.hash)) return reject(state, 'leafFormed: hash must be 32 bytes');
      const k = state.keygen;
      const first = k.leafFormed[event.leaf] === 0;
      k.leafFormed[event.leaf] = 1;
      k.leafHashes.set(event.hash, event.leaf * HASH_BYTES);
      const leavesFormed = first ? k.leavesFormed + 1 : k.leavesFormed;
      const keygen: KeygenState = { ...k, leavesFormed };
      let next = withStage(bump({ ...state, keygen }, source, seq), 2);
      if (keygen.leaves > 0 && leavesFormed >= keygen.leaves) next = withStage(next, 3);
      return next;
    }

    case 'treeLevelFused': {
      if (!intIn(event.level, 0, TREE_HEIGHT)) return reject(state, `treeLevelFused: level ${event.level} out of range`);
      if (!intIn(event.index, 0, fusedNodesAtLevel(event.level))) {
        return reject(state, `treeLevelFused: index ${event.index} out of range for level ${event.level}`);
      }
      if (!isHash(event.parent) || !isHash(event.left) || !isHash(event.right)) {
        return reject(state, 'treeLevelFused: hashes must be 32 bytes');
      }
      const m = state.merkle;
      const flat = fusedNodeIndex(event.level, event.index);
      const first = m.fusedFlags[flat] === 0;
      m.fusedFlags[flat] = 1;
      m.fusedHashes.set(event.parent, flat * HASH_BYTES);
      if (first) m.fusedPerLevel[event.level] = (m.fusedPerLevel[event.level] ?? 0) + 1;
      const merkle: MerkleState = {
        ...m,
        fusedTotal: first ? m.fusedTotal + 1 : m.fusedTotal,
        highestLevel: Math.max(m.highestLevel, event.level),
      };
      return withStage(bump({ ...state, merkle }, source, seq), 3);
    }

    case 'rootReady': {
      if (!isHash(event.root)) return reject(state, 'rootReady: root must be 32 bytes');
      const merkle: MerkleState = { ...state.merkle, root: event.root };
      let next = withStage(bump({ ...state, merkle }, source, seq), 3);
      if (next.cloud.input) next = withStage(next, 4);
      return next;
    }

    case 'signStart': {
      if (!intIn(event.index, 0, LEAVES)) return reject(state, `signStart: index ${event.index} out of range`);
      const signature: SignatureState = { ...initialSignature(), started: true, index: event.index, r: event.r, digest: event.digest };
      return withStage(bump({ ...state, signature }, source, seq), 6);
    }

    case 'signChainStop': {
      if (!intIn(event.chainIdx, 0, CHAINS)) return reject(state, `signChainStop: chainIdx ${event.chainIdx} out of range`);
      if (!intIn(event.depth, 0, LINKS)) return reject(state, `signChainStop: depth ${event.depth} out of range`);
      if (!isHash(event.hash)) return reject(state, 'signChainStop: hash must be 32 bytes');
      const g = state.signature;
      const first = g.stopDepths[event.chainIdx] === -1;
      g.stopDepths[event.chainIdx] = event.depth;
      g.stopHashes.set(event.hash, event.chainIdx * HASH_BYTES);
      const signature: SignatureState = { ...g, started: true, stopsSeen: first ? g.stopsSeen + 1 : g.stopsSeen };
      return withStage(bump({ ...state, signature }, source, seq), 6);
    }

    case 'authPathNode': {
      if (!intIn(event.level, 0, TREE_HEIGHT)) return reject(state, `authPathNode: level ${event.level} out of range`);
      if (!isHash(event.hash)) return reject(state, 'authPathNode: hash must be 32 bytes');
      const g = state.signature;
      const first = g.authSeen[event.level] === 0;
      g.authSeen[event.level] = 1;
      g.authPath.set(event.hash, event.level * HASH_BYTES);
      const signature: SignatureState = { ...g, started: true, authCount: first ? g.authCount + 1 : g.authCount };
      return withStage(bump({ ...state, signature }, source, seq), 6);
    }

    case 'signatureReady': {
      if (!(event.bytes instanceof Uint8Array)) return reject(state, 'signatureReady: bytes must be a Uint8Array');
      const signature: SignatureState = { ...state.signature, started: true, ready: true, index: event.index, bytesLength: event.bytes.length };
      return withStage(bump({ ...state, signature }, source, seq), 6);
    }

    case 'verifyStart':
    case 'verifyChainStep':
    case 'verifyLeafFormed':
    case 'verifyLevelFused':
    case 'verifyResult':
      // Verification is not part of the launch sequence; the events are
      // accepted (so seq stays consistent) but move nothing.
      return bump(state, source, seq);

    // ---------------------------------------------------------------- quantum
    case 'entropyRequested': {
      const d = state.draw;
      const draw: DrawState = {
        ...initialDraw(),
        resolvedCount: d.resolvedCount,
        phase: 'requested',
        providerId: event.providerId,
        nBytes: event.nBytes,
        requestedAt: event.requestedAt,
      };
      return withStage(bump({ ...state, draw }, source, seq), 5);
    }

    case 'entropyArrived': {
      if (!(event.bytes instanceof Uint8Array)) return reject(state, 'entropyArrived: bytes must be a Uint8Array');
      const draw: DrawState = {
        ...state.draw,
        phase: 'arrived',
        entropy: event.bytes,
        attestation: event.attestation,
        arrivedAt: event.at,
        nBytes: event.bytes.length,
        providerId: state.draw.providerId ?? event.attestation.providerId,
      };
      return withStage(bump({ ...state, draw }, source, seq), 5);
    }

    case 'commitmentComputed': {
      const draw: DrawState = { ...state.draw, phase: 'committed', commitment: event.hash };
      return withStage(bump({ ...state, draw }, source, seq), 5);
    }

    case 'outcomeResolved': {
      const draw: DrawState = {
        ...state.draw,
        phase: 'resolved',
        outcome: { value: event.value, label: event.outcomeLabel },
        resolvedAt: event.at,
        resolvedCount: state.draw.resolvedCount + 1,
      };
      return withStage(bump({ ...state, draw }, source, seq), 5);
    }

    // ------------------------------------------------------------------ chain
    case 'anchorSubmitted': {
      const anchor: AnchorState = { ...state.anchor, submitted: true, txSignature: event.txSignature ?? state.anchor.txSignature };
      return withStage(bump({ ...state, anchor }, source, seq), 7);
    }

    case 'anchored': {
      if (typeof event.txSignature !== 'string' || event.txSignature.length === 0) {
        return reject(state, 'anchored: txSignature is required');
      }
      const anchor: AnchorState = { submitted: true, anchored: true, txSignature: event.txSignature, slot: event.slot ?? null };
      let next = withStage(bump({ ...state, anchor }, source, seq), 7);
      if (next.lineage) next = withStage(next, 8);
      return next;
    }

    // ----------------------------------------------------------------- inputs
    case 'superposition': {
      const input = event.input;
      if (typeof input?.supplyMin !== 'bigint' || typeof input.supplyMax !== 'bigint') {
        return reject(state, 'superposition: supplyMin/supplyMax must be bigint');
      }
      if (!Array.isArray(input.decayChannels)) return reject(state, 'superposition: decayChannels must be an array');
      const cloud = cloudFromInput(input);
      let next = bump({ ...state, cloud }, null, null);
      if (next.merkle.root) next = withStage(next, 4);
      return next;
    }

    case 'lineage': {
      if (!event.input || typeof event.input.ca !== 'string') return reject(state, 'lineage: ca is required');
      let next = bump({ ...state, lineage: event.input }, null, null);
      if (next.anchor.anchored) next = withStage(next, 8);
      return next;
    }

    // ---------------------------------------------------------------- control
    case 'skipStage': {
      const target = event.to ?? (Math.min(8, state.stage + 1) as Stage);
      if (!intIn(target, 1, 9)) return reject(state, `skipStage: invalid stage ${String(target)}`);
      if (target <= state.stage) return bump(state, null, null);
      const skipped = [...state.skipped];
      for (let s = state.stage; s < target; s++) if (!skipped.includes(s as Stage)) skipped.push(s as Stage);
      return bump({ ...state, stage: target, skipped }, null, null);
    }

    case 'reset':
      return createInitialState();

    default:
      return reject(state, `unknown event type ${String((event as { type: unknown }).type)}`);
  }
}

// ---------------------------------------------------------------------------
// Selectors — hash retrieval for hover and the side panel
// ---------------------------------------------------------------------------

export function toHex(bytes: Uint8Array, offset = 0, length = HASH_BYTES): string {
  let s = '';
  for (let i = offset; i < offset + length && i < bytes.length; i++) s += (bytes[i] as number).toString(16).padStart(2, '0');
  return s;
}

/** Hash of link `depth` of chain `chainIdx` of the leaf in view, or null if not grown yet. */
export function chainLinkHash(state: SceneState, chainIdx: number, depth: number): Uint8Array | null {
  const k = state.keygen;
  if (!intIn(chainIdx, 0, CHAINS) || !intIn(depth, 0, LINKS)) return null;
  if (depth >= (k.depths[chainIdx] ?? 0)) return null;
  const off = (chainIdx * LINKS + depth) * HASH_BYTES;
  return k.currentLeafHashes.subarray(off, off + HASH_BYTES);
}

export function leafHash(state: SceneState, leaf: number): Uint8Array | null {
  if (!intIn(leaf, 0, LEAVES) || state.keygen.leafFormed[leaf] !== 1) return null;
  return state.keygen.leafHashes.subarray(leaf * HASH_BYTES, (leaf + 1) * HASH_BYTES);
}

export function fusedHash(state: SceneState, level: number, index: number): Uint8Array | null {
  if (!intIn(level, 0, TREE_HEIGHT) || !intIn(index, 0, fusedNodesAtLevel(level))) return null;
  const flat = fusedNodeIndex(level, index);
  if (state.merkle.fusedFlags[flat] !== 1) return null;
  return state.merkle.fusedHashes.subarray(flat * HASH_BYTES, (flat + 1) * HASH_BYTES);
}

export function stopHash(state: SceneState, chainIdx: number): Uint8Array | null {
  if (!intIn(chainIdx, 0, CHAINS) || state.signature.stopDepths[chainIdx] === -1) return null;
  return state.signature.stopHashes.subarray(chainIdx * HASH_BYTES, (chainIdx + 1) * HASH_BYTES);
}

export function authHash(state: SceneState, level: number): Uint8Array | null {
  if (!intIn(level, 0, TREE_HEIGHT) || state.signature.authSeen[level] !== 1) return null;
  return state.signature.authPath.subarray(level * HASH_BYTES, (level + 1) * HASH_BYTES);
}

/** Fraction of the whole key generation that has arrived, 0..1 (274 432 chainSteps = 1). */
export function keygenProgress(state: SceneState): number {
  const k = state.keygen;
  const total = (k.leaves || LEAVES) * (k.chains || CHAINS) * (k.links || LINKS);
  return total === 0 ? 0 : Math.min(1, k.chainSteps / total);
}

/** Fraction of the Merkle fuse that has arrived, 0..1. */
export function merkleProgress(state: SceneState): number {
  return Math.min(1, state.merkle.fusedTotal / FUSED_NODES);
}
