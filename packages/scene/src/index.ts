/**
 * @qsd/scene — public API.
 *
 * Model (headless, no React/three): `sceneReducer`, `createSceneStore`,
 * `replayEvents`, `SceneState`, the event codec and the field mapping.
 * Render (React + three): `<LaunchSequence />`, `<MeasurementScene />`,
 * `<CollapseScene />`, `<FieldScene />`, the quality controller and the
 * sound engine.
 */
export * from './model/index.js';

export { LaunchSequence, StageContent, useSoundEngine, type LaunchSequenceProps } from './render/LaunchSequence.js';
export { MeasurementScene, type MeasurementSceneProps } from './render/MeasurementScene.js';
export { CollapseScene, type CollapseSceneProps, type DaughterInput } from './render/CollapseScene.js';
export { FieldScene, FieldVessels, type FieldSceneProps } from './render/FieldScene.js';
export { SceneCanvas, type SceneCanvasProps } from './render/SceneCanvas.js';
export { SidePanel, hoverDescription, announcedTotals, type SidePanelProps, type PanelSection } from './render/SidePanel.js';
export { SceneProvider, useSceneContext, useSceneStore, useSceneSnapshot, useHover, useQualityProfile, type Hover } from './render/context.js';
export { useSources, type SceneSources } from './render/useSources.js';
export {
  createQualityController,
  QUALITY_LEVELS,
  QUALITY_PROFILES,
  type QualityController,
  type QualityLevel,
  type QualityProfile,
  type QualityState,
  type QualityOptions,
} from './render/quality.js';
export { CAMERA_BY_STAGE, linkPosition, treeNodePosition, signatureSlotPosition, type CameraPose } from './render/layout.js';
export { halfLifePeriodSec, CONTRACTION } from './render/SuperpositionCloud.js';

// individual stage components, for custom compositions
export { Chamber } from './render/Chamber.js';
export { CoinSphere } from './render/CoinSphere.js';
export { SeedStreams } from './render/SeedStreams.js';
export { ChainRing, type ChainRingProps } from './render/ChainRing.js';
export { MerkleTree } from './render/MerkleTree.js';
export { SuperpositionCloud, type SuperpositionCloudProps } from './render/SuperpositionCloud.js';
export { QuantumDraw } from './render/QuantumDraw.js';
export { SignatureStructure } from './render/SignatureStructure.js';
export { Anchor } from './render/Anchor.js';
export { Lineage } from './render/Lineage.js';
export { Effects } from './render/Effects.js';
export { CameraRig, type CameraRigProps } from './render/CameraRig.js';
export { Warmup } from './render/Warmup.js';

export { createSoundEngine, type SoundEngine } from './sound/engine.js';
