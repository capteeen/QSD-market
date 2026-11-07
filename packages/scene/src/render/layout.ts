/**
 * Static world layout. Positions are a deterministic function of indices —
 * chain i link d is always in the same place — so the geometry a viewer sees
 * is exactly the set of events that arrived.
 */
import { CHAINS, LEAVES, LINKS, TREE_HEIGHT } from '../model/types.js';
import type { Stage } from '../model/types.js';

export const VESSEL_RADIUS = 3;
export const VESSEL_HEIGHT = 6.4;
export const COIN_RADIUS = 0.55;

export const RING_RADIUS = 2.35;
export const LINK_Y0 = -2.45;
export const LINK_DY = 0.33;
export const LINK_SIZE: [number, number, number] = [0.16, 0.26, 0.16];

export function chainAngle(chainIdx: number): number {
  return (chainIdx / CHAINS) * Math.PI * 2;
}

export function linkPosition(chainIdx: number, depth: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const a = chainAngle(chainIdx);
  out[0] = Math.cos(a) * RING_RADIUS;
  out[1] = LINK_Y0 + depth * LINK_DY;
  out[2] = Math.sin(a) * RING_RADIUS;
  return out;
}

export const TREE_Y0 = VESSEL_HEIGHT / 2 + 0.5;
export const TREE_DY = 0.5;
export const TREE_R0 = 2.7;

/** Node count at a tree level: 256 leaves at level 0 … 1 root at level 8. */
export function treeLevelCount(level: number): number {
  return LEAVES >> level;
}

/**
 * Position of node `index` at `level` (0 = leaves, 8 = root). A parent sits at
 * the angular midpoint of its two children: angle = (index + 0.5) / count · 2π.
 */
export function treeNodePosition(level: number, index: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const count = treeLevelCount(level);
  const a = ((index + 0.5) / count) * Math.PI * 2;
  const r = level >= TREE_HEIGHT ? 0 : TREE_R0 * Math.pow(0.78, level);
  out[0] = Math.cos(a) * r;
  out[1] = TREE_Y0 + level * TREE_DY;
  out[2] = Math.sin(a) * r;
  return out;
}

/** Where the k-th stopped block locks into the signature structure: a helix outside the vessel. */
export const SIG_RADIUS = VESSEL_RADIUS + 0.6;
export function signatureSlotPosition(chainIdx: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const a = chainAngle(chainIdx) + Math.PI / CHAINS;
  out[0] = Math.cos(a) * SIG_RADIUS;
  out[1] = -1.6 + (chainIdx / (CHAINS - 1)) * 3.2;
  out[2] = Math.sin(a) * SIG_RADIUS;
  return out;
}

export const LANE_TOP: [number, number, number] = [0, -VESSEL_HEIGHT / 2 - 0.3, 0];
export const BLOCK_POSITION: [number, number, number] = [0, -VESSEL_HEIGHT / 2 - 4.2, 0];
export const MOTHER_POSITION: [number, number, number] = [-7, BLOCK_POSITION[1], 0];
export const DAUGHTER_GHOST_POSITION: [number, number, number] = [5.5, 0, 0];

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

export const CAMERA_BY_STAGE: Readonly<Record<Stage, CameraPose>> = {
  1: { position: [0, 0.4, 11.5], target: [0, 0, 0] },
  2: { position: [0, 0.6, 9.5], target: [0, 0.2, 0] },
  3: { position: [0, 4.2, 12.5], target: [0, 4.6, 0] },
  4: { position: [0, 0.4, 7.6], target: [0, 0, 0] },
  5: { position: [0, 0.3, 7], target: [0, 0, 0] },
  6: { position: [0, 1.2, 11], target: [0, 1.2, 0] },
  7: { position: [0, -4.5, 11], target: [0, -5.2, 0] },
  8: { position: [0, -2.5, 21], target: [-1.5, -4.5, 0] },
};

export { CHAINS, LINKS, LEAVES, TREE_HEIGHT };
