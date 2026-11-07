/**
 * @qsd/scene/model — the headless model. No React, no three. Safe to import
 * in Node tests and in a Worker.
 */
export * from './types.js';
export {
  sceneReducer,
  createInitialState,
  cloneSceneState,
  eventSource,
  fusedNodeOffset,
  fusedNodeIndex,
  fusedNodesAtLevel,
  superpositionWidth,
  cloudFromInput,
  toHex,
  chainLinkHash,
  leafHash,
  fusedHash,
  stopHash,
  authHash,
  keygenProgress,
  merkleProgress,
} from './reducer.js';
export { createSceneStore, replayEvents, type SceneStore, type SceneStoreOptions } from './store.js';
export { encodeCryptoEvents, decodeCryptoEvents, iterateCryptoEvents, encodedEventCount } from './codec.js';
export {
  vesselParams,
  vesselPosition,
  clamp01,
  STATE_HEX,
  type FieldCoin,
  type VesselParams,
  type LiveMeasurement,
} from './field.js';
