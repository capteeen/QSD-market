/**
 * The quantum stack: one mechanical object that carries the home page, in
 * the manner of the exploded lens on animejs.com. It is a dilution-fridge
 * "chandelier" read as a stacked cylinder: plates, knurled rings, a ribbed
 * body with pods, a bellows, a caged glowing core, a tick gear, pistons, a
 * bell and a flange, with cables running down the outside.
 *
 * ILLUSTRATIVE. Nothing here is driven by protocol events and no part
 * encodes live data. Each part is named after the real step of a QSD launch
 * it stands for, so the host can label the exploded view honestly.
 *
 * Geometry is procedural (three primitives merged per part): no asset
 * download, ≈ 24 k triangles in all, one fill draw and one edge draw per part.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type StackPartId = 'intake' | 'witness' | 'chains' | 'tree' | 'superposition' | 'core' | 'decay' | 'measure' | 'daughter' | 'share' | 'cables';

export interface StackPartSpec {
  id: StackPartId;
  /** Rest position of the part's centre on the stack axis (y). */
  y: number;
  /** Displacement along the axis at full explode (positive = up). */
  explode: number;
  /** Where a callout line should point, in the part's local frame. */
  anchor: [number, number, number];
  /** Builds the merged fill geometry in the part's local frame. */
  build: () => THREE.BufferGeometry;
  /** Edge-angle threshold for the line-art pass (degrees). */
  edgeAngle: number;
  /** Emissive parts (the core) take the glow material instead of the body material. */
  glow?: boolean;
}

const SEG = 48;
const TAU = Math.PI * 2;

function at(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
  m.setPosition(x, y, z);
  g.applyMatrix4(m);
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    // keep only position + normal so every piece merges
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', n.getAttribute('position'));
    out.setAttribute('normal', n.getAttribute('normal'));
    return out;
  });
  const merged = mergeGeometries(clean, false);
  if (!merged) throw new Error('stack part failed to merge');
  merged.computeBoundingSphere();
  return merged;
}

const cyl = (rTop: number, rBot: number, h: number, seg = SEG, open = false): THREE.BufferGeometry => new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
const disc = (r: number, h: number, seg = SEG): THREE.BufferGeometry => cyl(r, r, h, seg);
const torus = (r: number, tube: number, seg = SEG, tseg = 12): THREE.BufferGeometry => at(new THREE.TorusGeometry(r, tube, tseg, seg), 0, 0, 0, Math.PI / 2);
const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);

/** `count` copies of `make()` around the axis at radius `r`, each facing outward. */
function around(count: number, r: number, y: number, make: () => THREE.BufferGeometry, phase = 0): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * TAU;
    out.push(at(make(), Math.cos(a) * r, y, Math.sin(a) * r, 0, -a, 0));
  }
  return out;
}

export const STACK_PARTS: readonly StackPartSpec[] = [
  {
    id: 'intake',
    y: 2.95,
    explode: 1.7,
    anchor: [0.55, 0.1, 0],
    edgeAngle: 22,
    build: () =>
      merge([
        disc(0.62, 0.14),
        disc(0.2, 0.34, 24).translate(0, 0.22, 0),
        torus(0.2, 0.03, 24, 8).translate(0, 0.4, 0),
        ...around(4, 0.42, 0.1, () => disc(0.055, 0.08, 10)),
        ...around(4, 0.62, -0.02, () => box(0.16, 0.08, 0.26), Math.PI / 4),
      ]),
  },
  {
    id: 'witness',
    y: 2.58,
    explode: 1.3,
    anchor: [-0.8, 0, 0],
    edgeAngle: 30,
    build: () => merge([torus(0.74, 0.11, SEG, 10), ...around(44, 0.84, 0, () => box(0.05, 0.14, 0.07)), disc(0.5, 0.2, 32)]),
  },
  {
    id: 'chains',
    y: 2.02,
    explode: 0.9,
    anchor: [0.9, 0.2, 0],
    edgeAngle: 22,
    build: () => {
      const plates: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 8; i++) plates.push(disc(0.9 - (i % 2) * 0.06, 0.045).translate(0, -0.39 + i * 0.111, 0));
      return merge([...plates, disc(0.36, 0.86, 32), ...around(3, 0.36, 0, () => box(0.08, 0.86, 0.1))]);
    },
  },
  {
    id: 'tree',
    y: 1.15,
    explode: 0.5,
    anchor: [-0.95, -0.05, 0],
    edgeAngle: 22,
    build: () =>
      merge([
        disc(0.8, 0.72, 8),
        ...around(8, 0.8, 0, () => box(0.06, 0.74, 0.05), Math.PI / 8),
        ...around(4, 0.78, -0.02, () => at(cyl(0.16, 0.16, 0.5, 20), 0.2, 0, 0, 0, 0, Math.PI / 2)),
        ...around(4, 1.02, -0.02, () => disc(0.19, 0.06, 20).rotateZ(Math.PI / 2)),
        torus(0.82, 0.04, SEG, 8).translate(0, 0.36, 0),
        torus(0.82, 0.04, SEG, 8).translate(0, -0.36, 0),
      ]),
  },
  {
    id: 'superposition',
    y: 0.62,
    explode: 0.22,
    anchor: [0.98, 0, 0],
    edgeAngle: 35,
    build: () => {
      const bellows: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 5; i++) bellows.push(torus(i % 2 ? 0.8 : 0.96, 0.065, SEG, 10).translate(0, -0.26 + i * 0.13, 0));
      return merge([...bellows, disc(0.76, 0.6, 40)]);
    },
  },
  {
    id: 'core',
    y: 0,
    explode: 0,
    anchor: [0, 0, 0.72],
    edgeAngle: 25,
    build: () =>
      merge([
        ...around(12, 0.7, 0, () => disc(0.025, 0.92, 8)),
        torus(0.7, 0.035, SEG, 8).translate(0, 0.46, 0),
        torus(0.7, 0.035, SEG, 8).translate(0, -0.46, 0),
        disc(0.28, 0.1, 24).translate(0, 0.42, 0),
        disc(0.28, 0.1, 24).translate(0, -0.42, 0),
      ]),
  },
  {
    id: 'core',
    y: 0,
    explode: 0,
    anchor: [0, 0, 0],
    edgeAngle: 40,
    glow: true,
    build: () => merge([box(0.5, 0.26, 0.5), new THREE.SphereGeometry(0.09, 16, 12).translate(0, 0.24, 0), ...around(4, 0.3, 0, () => box(0.06, 0.14, 0.06), Math.PI / 4)]),
  },
  {
    id: 'decay',
    y: -0.7,
    explode: -0.32,
    anchor: [-1.1, 0, 0],
    edgeAngle: 30,
    build: () => merge([disc(1.0, 0.1), ...around(60, 1.03, 0, () => box(0.06, 0.12, 0.05)), torus(0.86, 0.025, SEG, 6).translate(0, 0.06, 0), disc(0.42, 0.2, 32)]),
  },
  {
    id: 'measure',
    y: -1.22,
    explode: -0.7,
    anchor: [1.05, 0, 0],
    edgeAngle: 22,
    build: () =>
      merge([
        disc(0.52, 0.5, 32),
        ...around(6, 0.72, 0, () => at(cyl(0.1, 0.1, 0.46, 14), 0, 0, 0, 0, 0, Math.PI / 2)),
        ...around(6, 1.0, 0, () => box(0.14, 0.26, 0.26)),
        ...around(6, 0.52, 0, () => box(0.06, 0.42, 0.3), Math.PI / 6),
      ]),
  },
  {
    id: 'daughter',
    y: -1.9,
    explode: -1.12,
    anchor: [-0.9, -0.1, 0],
    edgeAngle: 22,
    build: () => merge([cyl(0.5, 0.95, 0.64), torus(0.95, 0.06, SEG, 10).translate(0, -0.32, 0), disc(0.34, 0.14, 24).translate(0, 0.38, 0), ...around(8, 0.74, -0.1, () => box(0.05, 0.3, 0.04))]),
  },
  {
    id: 'share',
    y: -2.42,
    explode: -1.6,
    anchor: [1.15, 0, 0],
    edgeAngle: 22,
    build: () => merge([disc(1.15, 0.14), torus(0.75, 0.05, SEG, 8).translate(0, 0.1, 0), ...around(8, 0.95, 0.12, () => disc(0.08, 0.1, 10)), disc(0.5, 0.1, 32).translate(0, -0.1, 0)]),
  },
  {
    id: 'cables',
    y: 1.2,
    explode: 1.0,
    anchor: [0, 1.4, 1.15],
    edgeAngle: 40,
    build: () => {
      const tubes: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.3;
        const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const pts = [
          new THREE.Vector3(0, 1.72, 0).addScaledVector(dir, 0.22),
          new THREE.Vector3(0, 1.95, 0).addScaledVector(dir, 0.75),
          new THREE.Vector3(0, 1.2, 0).addScaledVector(dir, 1.18),
          new THREE.Vector3(0, -0.3, 0).addScaledVector(dir, 1.14),
          new THREE.Vector3(0, -1.9, 0).addScaledVector(dir, 1.08),
        ];
        tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.032, 6, false));
      }
      return merge(tubes);
    },
  },
];

export interface BuiltPart {
  spec: StackPartSpec;
  fill: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
}

/** Build every part once. Call on the client only (allocates GPU-bound buffers). */
export function buildStackParts(): BuiltPart[] {
  return STACK_PARTS.map((spec) => {
    const fill = spec.build();
    const edges = new THREE.EdgesGeometry(fill, spec.edgeAngle);
    return { spec, fill, edges };
  });
}

export function disposeStackParts(parts: BuiltPart[]): void {
  for (const p of parts) {
    p.fill.dispose();
    p.edges.dispose();
  }
}
