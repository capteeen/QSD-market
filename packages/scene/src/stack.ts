/**
 * @qsd/scene/stack — the home-page quantum stack (illustrative, scroll-driven).
 * A separate entry so the host can lazy-load it apart from the launch scenes.
 */
export { StackScene, type StackSceneProps, type StackAnchor } from './render/stack/StackScene.js';
export { STACK_PARTS, type StackPartId, type StackPartSpec } from './render/stack/parts.js';
export { stackPose, kf, STACK_CHAPTERS, type StackPose, type StackLayout } from './render/stack/timeline.js';
