/**
 * `@react-three/test-renderer` and `three` are devDependencies of the scene
 * package, not of @qsd/tests. They are reached through the scene package's
 * own node_modules links (vitest aliases `scene-rttr` / `scene-three` in
 * vitest.config.ts; tsconfig `paths` point the same names at their .d.ts),
 * which resolve to the same pnpm-store copies of react / fiber / three that
 * the scene itself uses (one React instance).
 */
import ReactThreeTestRenderer from 'scene-rttr';
import * as THREE from 'scene-three';

export { ReactThreeTestRenderer, THREE };
