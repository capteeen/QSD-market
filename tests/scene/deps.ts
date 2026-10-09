/**
 * `@react-three/test-renderer` and `three` are devDependencies of the scene
 * package, not of @qsd/tests. They are reached through the scene package's
 * own node_modules links, which resolve to the same pnpm-store copies of
 * react / fiber / three that the scene itself uses (one React instance).
 */
// eslint-disable-next-line import/no-relative-packages
import ReactThreeTestRenderer from '../../packages/scene/node_modules/@react-three/test-renderer/dist/react-three-test-renderer.esm.js';
// eslint-disable-next-line import/no-relative-packages
import * as THREE from '../../packages/scene/node_modules/three/build/three.module.js';

export { ReactThreeTestRenderer, THREE };
