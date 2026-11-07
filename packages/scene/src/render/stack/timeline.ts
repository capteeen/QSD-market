/**
 * The scroll timeline of the quantum stack: pure functions of scroll
 * progress p ∈ [0, 1] across the home-page story (hero → pulled apart →
 * blueprint with callouts → reassembled). No clock: only the host's scroll
 * position moves anything, except the documented slow idle spin in the hero
 * (an ambient item that encodes no data; off with reduced motion).
 */

export interface StackPose {
  /** Explosion amount 0 … 1. */
  explode: number;
  /** Object rotation (radians): tilt about z, spin about y, nod about x. */
  rotX: number;
  rotY: number;
  rotZ: number;
  /** World offset of the object's centre. */
  x: number;
  y: number;
  scale: number;
  /** 0 = dark machine (peach rim light), 1 = line-art on paper. */
  mode: number;
  /** 0 … 1 strength of the exploded-view callouts. */
  callouts: number;
  /** 0 … 1 presence of the hero dial around the object. */
  dial: number;
  /** Idle spin speed in rad/s (hero only). */
  spin: number;
}

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Piecewise interpolation with smoothstep easing between keyframes. */
export function kf(p: number, keys: readonly (readonly [number, number])[]): number {
  if (keys.length === 0) return 0;
  const first = keys[0] as readonly [number, number];
  if (p <= first[0]) return first[1];
  for (let i = 1; i < keys.length; i++) {
    const [p1, v1] = keys[i] as readonly [number, number];
    const [p0, v0] = keys[i - 1] as readonly [number, number];
    if (p <= p1) return v0 + (v1 - v0) * smooth((p - p0) / (p1 - p0));
  }
  return (keys[keys.length - 1] as readonly [number, number])[1];
}

export type StackLayout = 'desktop' | 'mobile';

/** Chapter boundaries (fractions of the story container). */
export const STACK_CHAPTERS = { hero: 0, apart: 0.25, blueprint: 0.5, rebuilt: 0.75, end: 1 } as const;

export function stackPose(p: number, layout: StackLayout): StackPose {
  const wide = layout === 'desktop';
  const sideX = wide ? 1.75 : 0;
  const heroY = wide ? 0 : 1.65;
  return {
    explode: kf(p, [
      [0.2, 0],
      [0.42, 1],
      [0.7, 1],
      [0.76, 1],
      [0.95, 0],
    ]),
    rotZ: kf(p, [
      [0.22, 0],
      [0.45, -0.75],
      [0.62, 0.62],
      [0.78, 0.62],
      [0.98, Math.PI / 2],
    ]),
    rotX: kf(p, [
      [0.22, 0.12],
      [0.45, 0.35],
      [0.62, -0.25],
      [0.98, 0.1],
    ]),
    rotY: kf(p, [
      [0.22, 0],
      [0.5, 1.4],
      [0.98, 3.1],
    ]),
    x: kf(p, [
      [0.2, sideX],
      [0.4, wide ? -0.2 : 0],
      [0.56, wide ? 1.1 : 0],
      [0.74, wide ? 1.1 : 0],
      [0.95, 0],
    ]),
    y: kf(p, [
      [0.2, heroY],
      [0.4, 0.15],
      [0.6, wide ? 0.2 : 1.35],
      [0.98, 0],
    ]),
    scale: kf(p, [
      [0.2, wide ? 0.92 : 0.46],
      [0.42, wide ? 0.78 : 0.5],
      [0.6, wide ? 0.74 : 0.42],
      [0.8, wide ? 0.72 : 0.42],
      [0.98, wide ? 0.95 : 0.6],
    ]),
    mode: kf(p, [
      [0.44, 0],
      [0.52, 1],
    ]),
    callouts: kf(p, [
      [0.5, 0],
      [0.58, 1],
      [0.72, 1],
      [0.8, 0],
    ]),
    dial: kf(p, [
      [0.08, 1],
      [0.24, 0],
    ]),
    spin: kf(p, [
      [0.18, 0.22],
      [0.3, 0],
    ]),
  };
}
