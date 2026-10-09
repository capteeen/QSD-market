/**
 * The scroll story: an abstract walk through the mechanic in light.
 *
 *   chapter 0  launch     a coin appears; its parameters spread into a cloud of ranges
 *   chapter 1  decay      quiet time drains the half-life ring; a buy resets it (Zeno)
 *   chapter 2  measure    quantum bytes stream in, the resolver picks an outcome,
 *                         the cloud contracts to one value
 *   chapter 3  collapse   the mother dims; its cloud flows into a daughter
 *   chapter 4  share      every holder of the mother receives a share of the daughter
 *
 * ILLUSTRATIVE: unlike every other scene in this package, nothing here is
 * driven by protocol events. It is a diagram, driven only by scroll position
 * and pointer, and the host labels it as an illustration. It draws no coin,
 * holder or number from live data. Colours come from @qsd/ui-tokens.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactElement } from 'react';
import * as THREE from 'three';
import { colors } from '@qsd/ui-tokens';
import { AMBER, COLLAPSE, CYAN, DEAD, MAGENTA, TUNNEL, WHITE, approach, emissiveMaterial } from '../materials.js';
import { createSprites, setSprite } from './sprites.js';

export const STORY_CHAPTERS = 5;

export interface StoryInput {
  /** Scroll position through the story, 0 … STORY_CHAPTERS. */
  progress: number;
  /** Pointer in normalised device coordinates of the canvas (-1 … 1); null when absent. */
  pointer: { x: number; y: number } | null;
  /** Incremented on every tap on the chamber (a buy: resets decay in the decay chapter). */
  pokes: number;
}

export interface StorySceneProps {
  input: MutableRefObject<StoryInput>;
  /** The chapter the host shows; with reduced motion each change renders one still frame. */
  chapter: number;
  /** Render still frames only (prefers-reduced-motion). */
  reducedMotion?: boolean;
  /** False while the story is off screen: the render loop stops. */
  running?: boolean;
  className?: string;
  style?: CSSProperties;
}

// ───────────────────────── illustration constants ─────────────────────────
const CLOUD = 360;
const BYTES = 90;
const STREAM = 150;
const HOLDERS = 7;
/** Illustrative bag fractions and entanglement weights. Not data. */
const BAG = [0.27, 0.2, 0.15, 0.12, 0.11, 0.09, 0.06];
const WEIGHT = [1.2, 1.45, 1.0, 1.5, 1.3, 1.1, 1.4]; // in [1.0, 1.5], as in physics.md
const SHARE = (() => {
  const raw = BAG.map((b, k) => b * (WEIGHT[k] as number));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((r) => r / sum);
})();
const MOTHER_X = -1.7;
const DAUGHTER_X = 1.7;
const OUTCOMES = [
  { pos: new THREE.Vector3(-1.35, -1.85, 0), color: CYAN }, // survive
  { pos: new THREE.Vector3(0, -2.15, 0), color: TUNNEL }, // tunnel
  { pos: new THREE.Vector3(1.35, -1.85, 0), color: COLLAPSE }, // collapse
];
// halo slots
const H_MOTHER = 0;
const H_DAUGHTER = 1;
const H_SELECT = 2;
const H_HOLDERS = 3;
const H_DHOLDERS = H_HOLDERS + HOLDERS;
const HALOS = H_DHOLDERS + HOLDERS;
// particle slots: cloud, bytes, streams, then a bright core dot per holder (mother side, daughter side)
const P_BYTES = CLOUD;
const P_STREAM = P_BYTES + BYTES;
const P_DOTS = P_STREAM + STREAM;
const PARTICLES = P_DOTS + HOLDERS * 2;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const fract = (x: number): number => x - Math.floor(x);

/** Deterministic PRNG so the illustration looks the same on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function useStoryData() {
  return useMemo(() => {
    const rnd = mulberry32(0x05d);
    const gauss = (): number => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
    const g = new Float32Array(CLOUD * 3);
    const ph = new Float32Array(CLOUD);
    const delay = new Float32Array(CLOUD);
    const arc = new Float32Array(CLOUD);
    for (let i = 0; i < CLOUD; i++) {
      const x = gauss() * 0.55;
      const y = gauss() * 0.55;
      const z = gauss() * 0.55;
      g[i * 3] = x;
      g[i * 3 + 1] = y;
      g[i * 3 + 2] = z;
      ph[i] = rnd() * Math.PI * 2;
      delay[i] = rnd() * 0.4;
      arc[i] = (rnd() - 0.3) * 1.4;
    }
    const bytePh = Float32Array.from({ length: BYTES }, () => rnd());
    // stream particles are allotted to holders in proportion to their share
    const streamHolder = new Uint8Array(STREAM);
    const streamPh = new Float32Array(STREAM);
    let q = 0;
    SHARE.forEach((s, k) => {
      const n = k === HOLDERS - 1 ? STREAM - q : Math.max(1, Math.round(s * STREAM));
      for (let j = 0; j < n && q < STREAM; j++, q++) {
        streamHolder[q] = k;
        streamPh[q] = rnd();
      }
    });
    const holderAngle = Array.from({ length: HOLDERS }, (_, k) => (k / HOLDERS) * Math.PI * 2 + 0.4);
    return { g, ph, delay, arc, bytePh, streamHolder, streamPh, holderAngle };
  }, []);
}

function circleGeometry(radius: number, segments: number): THREE.BufferGeometry {
  const pts = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i++) {
    // start at the top, run clockwise: what remains of the ring is the life left
    const a = Math.PI / 2 - (i / segments) * Math.PI * 2;
    pts[i * 3] = Math.cos(a) * radius;
    pts[i * 3 + 1] = Math.sin(a) * radius;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  return geo;
}

function lineMat(color: THREE.Color): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
}

function StoryWorld({ input, chapter, reducedMotion }: { input: MutableRefObject<StoryInput>; chapter: number; reducedMotion: boolean }): ReactElement {
  const data = useStoryData();
  const { camera, size, invalidate } = useThree();

  const particles = useMemo(() => createSprites(PARTICLES, 1.6), []);
  const halos = useMemo(() => createSprites(HALOS, 3.2), []);

  const motherCore = useMemo(() => emissiveMaterial(CYAN, 1.4), []);
  const daughterCore = useMemo(() => emissiveMaterial(CYAN, 1.4), []);
  // the glass shell is drawn as its edges: light on the facets, no solid fill
  const shellGeo = useMemo(() => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.62, 1)), []);
  const shellMat = useMemo(() => lineMat(CYAN), []);
  const dShellMat = useMemo(() => lineMat(CYAN), []);
  const motherShell = useMemo(() => new THREE.LineSegments(shellGeo, shellMat), [shellGeo, shellMat]);
  const daughterShell = useMemo(() => new THREE.LineSegments(shellGeo, dShellMat), [shellGeo, dShellMat]);
  const ringMats = useMemo(() => OUTCOMES.map((o) => new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })), []);
  const rippleMat = useMemo(() => new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), []);

  const lifeGeo = useMemo(() => circleGeometry(0.85, 128), []);
  const lifeTrackGeo = useMemo(() => circleGeometry(0.85, 128), []);
  const lifeMat = useMemo(() => lineMat(CYAN), []);
  const lifeTrackMat = useMemo(() => lineMat(CYAN), []);
  const lineageGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(33 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    return g;
  }, []);
  const lineageMat = useMemo(() => lineMat(CYAN), []);
  const lifeLine = useMemo(() => new THREE.Line(lifeGeo, lifeMat), [lifeGeo, lifeMat]);
  const lifeTrack = useMemo(() => new THREE.Line(lifeTrackGeo, lifeTrackMat), [lifeTrackGeo, lifeTrackMat]);
  const lineage = useMemo(() => new THREE.Line(lineageGeo, lineageMat), [lineageGeo, lineageMat]);

  const mother = useRef<THREE.Group>(null);
  const daughter = useRef<THREE.Group>(null);
  const ripple = useRef<THREE.Mesh>(null);
  const life = useRef<THREE.Group>(null);

  // per-frame state, never React state
  const st = useRef({ p: input.current.progress, time: 0, zeno: 0, pokes: input.current.pokes, rippleT: 1, pin: 0, camX: 0, camY: 0 });
  const v = useMemo(
    () => ({ m: new THREE.Vector3(), d: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), pw: new THREE.Vector3(), dir: new THREE.Vector3(), hm: [] as THREE.Vector3[], hd: [] as THREE.Vector3[], c: new THREE.Color(), c2: new THREE.Color(), mc: new THREE.Color() }),
    [],
  );
  if (v.hm.length === 0) for (let k = 0; k < HOLDERS; k++) (v.hm.push(new THREE.Vector3()), v.hd.push(new THREE.Vector3()));

  // reduced motion: one still frame per chapter
  useEffect(() => {
    invalidate();
  }, [chapter, size.width, size.height, invalidate]);

  useEffect(
    () => () => {
      for (const d of [particles.mesh.geometry, particles.mesh.material, halos.mesh.geometry, halos.mesh.material, motherCore, daughterCore, shellGeo, shellMat, dShellMat, rippleMat, lifeGeo, lifeTrackGeo, lifeMat, lifeTrackMat, lineageGeo, lineageMat, ...ringMats]) d.dispose();
    },
    [particles, halos, motherCore, daughterCore, shellGeo, shellMat, dShellMat, rippleMat, lifeGeo, lifeTrackGeo, lifeMat, lifeTrackMat, lineageGeo, lineageMat, ringMats],
  );

  useFrame((_, rawDt) => {
    const s = st.current;
    const inp = input.current;
    const rm = reducedMotion;
    const dt = rm ? 10 : Math.min(rawDt, 0.1);
    if (!rm) s.time += dt;
    const time = s.time;

    // still frames show each chapter in its finished state
    const target = rm ? Math.min(STORY_CHAPTERS, Math.floor(inp.progress) + 0.9) : inp.progress;
    s.p = rm ? target : approach(s.p, target, dt, 5);
    const p = s.p;
    const t0 = clamp01(p);
    const t1 = clamp01(p - 1);
    const t2 = clamp01(p - 2);
    const t3 = clamp01(p - 3);
    const t4 = clamp01(p - 4);

    // a tap is a buy: the Zeno reset
    if (inp.pokes !== s.pokes) {
      s.pokes = inp.pokes;
      if (!rm) {
        s.zeno = 1;
        s.rippleT = 0;
      }
    }
    s.zeno = approach(s.zeno, 0, dt, 0.7);
    s.rippleT = Math.min(1, s.rippleT + dt * 1.1);

    const s2 = smooth(t2);
    const e3 = smooth(t3 * 1.25);
    const decay = clamp01(smooth(t1) * 0.95 - s.zeno * 0.85 * (1 - s2));
    const flash = smooth((t2 - 0.8) / 0.15) * (1 - smooth((t3 - 0.05) / 0.3));

    // ── camera: framing per aspect, pointer parallax ──
    const aspect = size.width / Math.max(1, size.height);
    const wide = aspect > 1.15;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(21));
    const z = wide ? 10 : Math.max(10, 3.3 / (tanHalf * aspect));
    const halfH = tanHalf * z;
    const lookX = wide ? -0.42 * halfH * aspect : 0; // content sits right of the text column
    const lookY = wide ? 0.2 : 0.4 - 0.42 * halfH; // portrait: content sits above the card
    const ptr = inp.pointer;
    s.pin = approach(s.pin, ptr && !rm ? 1 : 0, dt, 3);
    s.camX = approach(s.camX, ptr && !rm ? ptr.x : 0, dt, 2.5);
    s.camY = approach(s.camY, ptr && !rm ? ptr.y : 0, dt, 2.5);
    camera.position.set(lookX + s.camX * 0.7, lookY + 0.5 + s.camY * 0.45, z);
    camera.lookAt(lookX, lookY, 0);
    camera.updateMatrixWorld();

    // pointer on the z = 0 plane, for the repel field
    let repel = 0;
    if (ptr && s.pin > 0.01) {
      v.pw.set(ptr.x, ptr.y, 0.5).unproject(camera);
      v.dir.copy(v.pw).sub(camera.position).normalize();
      v.pw.copy(camera.position).addScaledVector(v.dir, -camera.position.z / v.dir.z);
      repel = s.pin;
    }

    // ── mother and daughter ──
    v.m.set(MOTHER_X * e3, 0, 0);
    v.d.set(DAUGHTER_X, 0, 0);
    const birth = smooth(p * 2.5);
    const dGrow = smooth((t3 - 0.3) / 0.6);

    v.mc.copy(CYAN).lerp(AMBER, decay).lerp(WHITE, s2 * 0.55).lerp(COLLAPSE, flash).lerp(DEAD, e3 * (1 - flash));
    if (mother.current) {
      mother.current.position.copy(v.m);
      mother.current.scale.setScalar(Math.max(0.001, birth * (1 - 0.35 * e3) * (1 + flash * 0.25 + (rm ? 0 : 0.04 * Math.sin(time * 1.6) * (1 - e3)))));
    }
    motherCore.emissive.copy(v.mc);
    motherCore.emissiveIntensity = 1.2 + flash * 1.5 - e3 * 0.6;
    motherShell.rotation.set(time * 0.11, time * 0.3, 0);
    shellMat.color.copy(v.mc);
    shellMat.opacity = 0.45 * (1 - 0.5 * e3) + flash * 0.4;
    if (daughter.current) {
      daughter.current.position.copy(v.d);
      daughter.current.scale.setScalar(Math.max(0.001, dGrow * (1 + (rm ? 0 : 0.04 * Math.sin(time * 1.6 + 1)))));
      daughter.current.visible = dGrow > 0.001;
    }
    daughterCore.emissive.copy(CYAN);
    daughterShell.rotation.set(-time * 0.09, -time * 0.3, 0);
    dShellMat.opacity = 0.45 * dGrow;

    // ripple on a buy
    if (ripple.current) {
      ripple.current.position.copy(v.m);
      ripple.current.scale.setScalar(0.6 + s.rippleT * 2.4);
      rippleMat.opacity = (1 - s.rippleT) * 0.8 * birth;
    }

    // half-life ring: what remains is the life left
    const lifeVis = smooth(t1 / 0.2) * (1 - s2);
    if (life.current) life.current.position.copy(v.m);
    lifeGeo.setDrawRange(0, Math.max(2, Math.round((1 - decay) * 128) + 1));
    lifeMat.color.copy(CYAN).lerp(AMBER, decay);
    lifeMat.opacity = lifeVis * 0.9;
    lifeTrackMat.color.copy(DEAD);
    lifeTrackMat.opacity = lifeVis * 0.5;

    // outcome rings and the resolver's selector
    const ringVis = smooth((t2 - 0.15) / 0.15) * (1 - e3);
    const landed = t2 >= 0.8 || rm;
    const pick = landed ? 2 : Math.floor(time * 5) % 3;
    OUTCOMES.forEach((_, k) => {
      const m = ringMats[k] as THREE.MeshBasicMaterial;
      m.opacity = ringVis * (k === pick ? 0.95 : 0.3);
    });

    // lineage: an arc from mother to daughter
    const lin = lineageGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= 32; i++) {
      const u = i / 32;
      lin.setXYZ(i, v.m.x + (v.d.x - v.m.x) * u, Math.sin(Math.PI * u) * 0.9, 0);
    }
    lin.needsUpdate = true;
    lineageMat.opacity = dGrow * 0.45;
    lineageGeo.setDrawRange(0, Math.max(2, Math.round(dGrow * 32) + 1));

    // ── halos ──
    v.c.copy(v.mc);
    setSprite(halos, H_MOTHER, v.m, v.c, (2.4 + flash * 2.2) * birth * (1 - 0.3 * e3), 0.55 * (1 - 0.6 * e3) + flash * 0.5);
    setSprite(halos, H_DAUGHTER, v.d, CYAN, 2.4 * dGrow, 0.6 * dGrow);
    const sel = OUTCOMES[pick] as (typeof OUTCOMES)[number];
    setSprite(halos, H_SELECT, sel.pos, sel.color, landed ? 1.6 : 1.1, ringVis * (landed ? 0.9 : 0.5));

    const holdersIn = smooth((t0 - 0.55) / 0.4);
    const receive = smooth((t4 - 0.25) / 0.6);
    for (let k = 0; k < HOLDERS; k++) {
      const a = (data.holderAngle[k] as number) + (rm ? 0 : time * 0.12);
      const bag = BAG[k] as number;
      const hm = v.hm[k] as THREE.Vector3;
      const hd = v.hd[k] as THREE.Vector3;
      hm.set(v.m.x + Math.cos(a) * 1.25, v.m.y + Math.sin(a) * 1.05, Math.sin(a * 2) * 0.3);
      hd.set(v.d.x + Math.cos(a) * 1.05, v.d.y + Math.sin(a) * 0.9, Math.sin(a * 2) * 0.3);
      // holders dim when the mother collapses, light again as they receive the daughter
      const dim = e3 * (1 - smooth(t4 / 0.3));
      v.c.copy(CYAN).lerp(DEAD, dim);
      setSprite(halos, H_HOLDERS + k, hm, v.c, (0.35 + 1.4 * Math.sqrt(bag)) * holdersIn, holdersIn * (0.35 - 0.2 * dim));
      setSprite(particles, P_DOTS + k, hm, v.c, (0.1 + 0.3 * Math.sqrt(bag)) * holdersIn, holdersIn * (1 - 0.5 * dim));
      v.c2.copy(CYAN).lerp(WHITE, 0.35);
      setSprite(halos, H_DHOLDERS + k, hd, v.c2, (0.3 + 1.7 * Math.sqrt(SHARE[k] as number)) * receive, receive * 0.45);
      setSprite(particles, P_DOTS + HOLDERS + k, hd, v.c2, (0.1 + 0.34 * Math.sqrt(SHARE[k] as number)) * receive, receive);
    }
    halos.commit();

    // ── particles: the cloud of ranges ──
    const spread = smooth(t0) * (1 + 0.25 * decay * (1 - s2)) * (1 - 0.92 * s2);
    for (let i = 0; i < CLOUD; i++) {
      const gx = data.g[i * 3] as number;
      const gy = data.g[i * 3 + 1] as number;
      const gz = data.g[i * 3 + 2] as number;
      const phase = data.ph[i] as number;
      const breath = rm ? 1 : 1 + 0.07 * Math.sin(time * 1.3 + phase);
      v.a.set(v.m.x + gx * spread * 1.7 * breath, v.m.y + gy * spread * 1.7 * breath, gz * spread * 1.7 * breath);
      v.c.copy(CYAN).lerp(AMBER, decay).lerp(WHITE, s2 * 0.7);
      let alpha = 0.8 * smooth(t0 * 1.5) * (1 - 0.4 * decay);
      // collapse: the cloud flows from the mother into the daughter, where it is a range again
      const u = smooth((t3 - (data.delay[i] as number)) / 0.6);
      if (u > 0) {
        v.b.set(v.d.x + gx * 1.15 * breath, v.d.y + gy * 1.15 * breath, gz * 1.15 * breath);
        v.a.lerp(v.b, u);
        v.a.y += Math.sin(Math.PI * u) * (data.arc[i] as number);
        v.c.copy(COLLAPSE).lerp(CYAN, u);
        alpha = 0.85;
      }
      if (repel > 0) {
        const dx = v.a.x - v.pw.x;
        const dy = v.a.y - v.pw.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 1e-4;
        const push = Math.max(0, 1 - dist / 1.1) * 0.45 * repel;
        v.a.x += (dx / dist) * push;
        v.a.y += (dy / dist) * push;
      }
      setSprite(particles, i, v.a, v.c, 0.11, alpha);
    }

    // quantum bytes: a helix falling from above into the mother
    const bytesVis = smooth(t2 / 0.12) * (1 - smooth((t2 - 0.78) / 0.12));
    for (let j = 0; j < BYTES; j++) {
      const ph = data.bytePh[j] as number;
      const f = fract((rm ? 0 : time * 0.5) + ph);
      const r = 0.3 * (1 - f);
      const a = ph * 40 + f * 7;
      v.a.set(v.m.x + Math.cos(a) * r, v.m.y + 0.45 + (1 - f) * 4.2, Math.sin(a) * r);
      v.c.copy(MAGENTA).lerp(WHITE, f * 0.8);
      setSprite(particles, P_BYTES + j, v.a, v.c, 0.09, bytesVis * Math.sin(Math.PI * f) * 0.95);
    }

    // shares: streams from each holder of the mother to their place around the daughter
    const streamVis = smooth(t4 / 0.2);
    for (let q = 0; q < STREAM; q++) {
      const k = data.streamHolder[q] as number;
      const f = fract((rm ? 0.5 : time * 0.32) + (data.streamPh[q] as number));
      v.a.copy(v.hm[k] as THREE.Vector3).lerp(v.hd[k] as THREE.Vector3, f);
      v.a.y += Math.sin(Math.PI * f) * (1.1 + k * 0.08);
      v.c.copy(CYAN).lerp(WHITE, f * 0.5);
      setSprite(particles, P_STREAM + q, v.a, v.c, 0.075, streamVis * Math.sin(Math.PI * f) * 0.9);
    }
    particles.commit();
  });

  return (
    <group>
      <ambientLight intensity={0.15} />
      <directionalLight position={[-6, 8, 6]} intensity={1.6} color={CYAN} />
      <pointLight position={[0, 6, 6]} intensity={30} distance={30} decay={2} color={'#ffffff'} />

      <group ref={mother}>
        <mesh material={motherCore}>
          <sphereGeometry args={[0.3, 32, 20]} />
        </mesh>
        <primitive object={motherShell} />
      </group>
      <group ref={daughter} visible={false}>
        <mesh material={daughterCore}>
          <sphereGeometry args={[0.3, 32, 20]} />
        </mesh>
        <primitive object={daughterShell} />
      </group>

      <mesh ref={ripple} material={rippleMat}>
        <torusGeometry args={[0.5, 0.012, 6, 96]} />
      </mesh>
      <group ref={life}>
        <primitive object={lifeTrack} />
        <primitive object={lifeLine} />
      </group>
      <primitive object={lineage} />
      {OUTCOMES.map((o, k) => (
        <mesh key={k} position={o.pos} material={ringMats[k] as THREE.MeshBasicMaterial}>
          <torusGeometry args={[0.26, 0.018, 8, 64]} />
        </mesh>
      ))}

      <primitive object={halos.mesh} renderOrder={1} />
      <primitive object={particles.mesh} renderOrder={2} />
    </group>
  );
}

export function StoryScene({ input, chapter, reducedMotion = false, running = true, className, style }: StorySceneProps): ReactElement {
  const [dpr, setDpr] = useState(1.5);
  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', background: colors.void, ...style }} data-qsd-story>
      <Canvas
        dpr={[1, dpr]}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 42, near: 0.1, far: 80, position: [0, 0.5, 10] }}
        frameloop={reducedMotion ? 'demand' : running ? 'always' : 'never'}
        onCreated={({ gl }) => gl.setClearColor(colors.void, 1)}
        style={{ position: 'absolute', inset: 0 }}
        aria-hidden="true"
      >
        <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.5)} />
        <StoryWorld input={input} chapter={chapter} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
}
