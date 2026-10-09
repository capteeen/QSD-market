/**
 * <HeroCore /> — what the home field shows while no coin exists: the quantum
 * core, idle and waiting for a launch. A stack of gold cryostat plates
 * wrapped in wiring, a processor face with circuit traces, four sensor
 * blocks and a single qubit at its centre, all inside a glass capsule, set in
 * a tunnel of cool light.
 *
 * Nothing here is data. Every element is static geometry and light, and the
 * only motion is AMBIENT at constant rates, encoding nothing:
 *   - the core glow and the qubit breathe slowly;
 *   - streaks of light travel along the tunnel toward the viewer;
 *   - the core tilts a few degrees toward the pointer (parallax).
 * With `prefers-reduced-motion: reduce` all three stop and the scene is still.
 *
 * Performance: no transmission pass (the capsule is a Fresnel shell), wires are
 * one merged LineSegments, coax cables one merged mesh, tunnel lines one
 * LineSegments; about thirty draw calls. Metal reads through a small PMREM
 * environment built from three's RoomEnvironment, which is geometry and light
 * only: no textures, no skybox.
 *
 * Colours come only from @qsd/ui-tokens: warm gold is the `gold` token and cool
 * light the `ice` token (the hero roles added by the palette change), falling
 * back to `decay` and `probability` on a token set that predates them;
 * highlights are `tunnel`, dark metal is `panel`.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactElement } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { colors } from '@qsd/ui-tokens';
import type { CameraPose } from './layout.js';
import { pointsMaterial } from './materials.js';

/** Hero framing: level with the core, far enough back to hold the capsule and the tunnel mouth. */
export const HERO_POSE: CameraPose = { position: [0, 0.7, 16.5], target: [0, -0.2, 0] };

const palette = colors as Readonly<Record<string, string>> & typeof colors;
const GOLD = new THREE.Color(palette['gold'] ?? colors.decay);
const BLUE = new THREE.Color(palette['ice'] ?? colors.probability);
const HIGHLIGHT = new THREE.Color(colors.tunnel);
const DARK = new THREE.Color(colors.panel);

const FLOOR_Y = -4.6;
const TUNNEL_HALF_W = 9;
const TUNNEL_TOP = 6.2;
const TUNNEL_NEAR = 6;
const TUNNEL_FAR = -46;
/** Angular half-width (radians) of the front window the wiring leaves open so the processor face shows. */
const FRONT_WINDOW = 0.75;

const PLATES = [
  { y: 2.75, r: 2.7, h: 0.22 },
  { y: 1.55, r: 2.3, h: 0.16 },
  { y: -1.55, r: 2.3, h: 0.16 },
  { y: -2.75, r: 2.7, h: 0.22 },
] as const;

/** Deterministic PRNG so the wiring is identical on every load. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Angle in [0, 2π) that avoids the front window around +z (angle π/2 in x/z = cos, sin). */
function sideAngle(rand: () => number): number {
  for (;;) {
    const a = rand() * Math.PI * 2;
    const fromFront = Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
    if (fromFront > FRONT_WINDOW) return a;
  }
}

function polar(r: number, a: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
}

/** One cable route: from the top plate, bowing outward, down to the core housing or the lower plates. */
function cableCurve(rand: () => number): THREE.CatmullRomCurve3 {
  const a = sideAngle(rand);
  const drift = (rand() - 0.5) * 0.5;
  const startPlate = rand() < 0.5 ? PLATES[0] : PLATES[1];
  const toHousing = rand() < 0.45;
  const bow = 2.75 + rand() * 0.55;
  const pts = [
    polar(startPlate.r * (0.75 + rand() * 0.22), a, startPlate.y - startPlate.h / 2),
    polar(bow, a + drift * 0.4, 1.1 + rand() * 0.4),
    polar(bow + 0.1, a + drift * 0.8, -0.2 + rand() * 0.5),
  ];
  if (toHousing) pts.push(polar(1.6, a + drift, -0.6 + rand() * 1.4));
  else {
    const end = rand() < 0.6 ? PLATES[2] : PLATES[3];
    pts.push(polar(bow - 0.15, a + drift, -1.0), polar(end.r * (0.8 + rand() * 0.18), a + drift * 1.2, end.y + end.h / 2));
  }
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
}

function buildWires(count: number, seed: number): THREE.BufferGeometry {
  const rand = prng(seed);
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const pts = cableCurve(rand).getPoints(28);
    const shade = 0.35 + rand() * 0.65;
    c.copy(GOLD).lerp(HIGHLIGHT, rand() * 0.25).multiplyScalar(shade);
    for (let k = 0; k < pts.length - 1; k++) {
      const p = pts[k]!;
      const q = pts[k + 1]!;
      pos.push(p.x, p.y, p.z, q.x, q.y, q.z);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

function buildCoax(count: number, seed: number): THREE.BufferGeometry {
  const rand = prng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) parts.push(new THREE.TubeGeometry(cableCurve(rand), 40, 0.022 + rand() * 0.02, 6, false));
  const merged = mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
  for (const p of parts) p.dispose();
  return merged;
}

/** Processor face: concentric square traces, radial traces and pads, as one LineSegments. */
function buildTraces(): THREE.BufferGeometry {
  const pos: number[] = [];
  const square = (h: number): void => {
    const c: Array<[number, number]> = [[-h, -h], [h, -h], [h, h], [-h, h]];
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = c[i]!;
      const [x2, y2] = c[(i + 1) % 4]!;
      pos.push(x1, y1, 0, x2, y2, 0);
    }
  };
  [0.32, 0.5, 0.72, 0.98].forEach(square);
  // radial traces from the inner square to the outer edge, with a dog-leg
  for (let i = 0; i < 4; i++) {
    for (const off of [-0.18, 0, 0.18]) {
      const rot = (i * Math.PI) / 2;
      const seg = (x1: number, y1: number, x2: number, y2: number): void => {
        const cs = Math.cos(rot);
        const sn = Math.sin(rot);
        pos.push(x1 * cs - y1 * sn, x1 * sn + y1 * cs, 0, x2 * cs - y2 * sn, x2 * sn + y2 * cs, 0);
      };
      seg(0.32, off, 0.6, off);
      seg(0.6, off, 0.75, off * 1.8);
      seg(0.75, off * 1.8, 1.05, off * 1.8);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** Tunnel: ribs, longitudinal wall lines and floor rails, fading with depth. */
function buildTunnel(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const fade = (z: number): number => Math.pow(THREE.MathUtils.clamp((z - TUNNEL_FAR) / (TUNNEL_NEAR - TUNNEL_FAR), 0, 1), 2.2);
  const push = (a: THREE.Vector3, b: THREE.Vector3, k: number): void => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const ca = fade(a.z) * k;
    const cb = fade(b.z) * k;
    col.push(BLUE.r * ca, BLUE.g * ca, BLUE.b * ca, BLUE.r * cb, BLUE.g * cb, BLUE.b * cb);
  };
  const W = TUNNEL_HALF_W;
  // ribs
  for (let z = TUNNEL_NEAR - 8; z > TUNNEL_FAR; z -= 4) {
    const k = 0.13;
    push(new THREE.Vector3(-W, FLOOR_Y, z), new THREE.Vector3(-W, TUNNEL_TOP, z), k);
    push(new THREE.Vector3(W, FLOOR_Y, z), new THREE.Vector3(W, TUNNEL_TOP, z), k);
    push(new THREE.Vector3(-W, TUNNEL_TOP, z), new THREE.Vector3(W, TUNNEL_TOP, z), k * 0.6);
  }
  // wall and ceiling lines
  const seg = 2;
  const longLine = (x: number, y: number, k: number): void => {
    for (let z = TUNNEL_NEAR; z > TUNNEL_FAR; z -= seg) push(new THREE.Vector3(x, y, z), new THREE.Vector3(x, y, z - seg), k);
  };
  for (const y of [-3.2, -1.4, 0.4, 2.2, 4.0]) {
    longLine(-W, y, 0.22);
    longLine(W, y, 0.22);
  }
  for (const x of [-5, -1.5, 1.5, 5]) longLine(x, TUNNEL_TOP, 0.12);
  // floor rails: brighter toward the centre lane
  for (const x of [-7.5, -5, -3, -1.3, 1.3, 3, 5, 7.5]) longLine(x, FLOOR_Y + 0.002, Math.abs(x) < 2 ? 0.6 : 0.25);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

const STREAKS = 18;
const STREAK_LEN = 3.2;
/** Fixed lanes for the travelling streaks: wall lines and centre rails. */
function streakLanes(): Array<[number, number]> {
  const lanes: Array<[number, number]> = [];
  for (const y of [-3.2, -1.4, 0.4, 2.2, 4.0]) lanes.push([-TUNNEL_HALF_W, y], [TUNNEL_HALF_W, y]);
  for (const x of [-1.3, 1.3, -3, 3, -5, 5, -7.5, 7.5]) lanes.push([x, FLOOR_Y + 0.004]);
  return lanes;
}

const VIEW_VERT = /* glsl */ `
  varying vec3 vNormalW; varying vec3 vViewW; varying vec2 vUv; varying vec3 vPosW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPosW = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = normalize(cameraPosition - w.xyz);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/** Glass by its edges: additive Fresnel, `edge` at the silhouette blending to `face`. */
function capsuleGlass(edge: THREE.Color, face: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uEdge: { value: edge.clone() }, uFace: { value: face.clone() } },
    vertexShader: VIEW_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uEdge; uniform vec3 uFace;
      varying vec3 vNormalW; varying vec3 vViewW;
      void main() {
        float ndv = abs(dot(normalize(vNormalW), normalize(vViewW)));
        float rim = pow(1.0 - ndv, 6.0);
        float sheen = pow(1.0 - ndv, 2.0) * 0.08;
        vec3 c = uEdge * rim * 0.75 + uFace * sheen;
        gl_FragColor = vec4(c, rim + sheen);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

/** Floor: a warm pool under the core and a cool lane down the tunnel, fading out. */
function floorMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uGold: { value: GOLD.clone() }, uBlue: { value: BLUE.clone() } },
    vertexShader: VIEW_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uGold; uniform vec3 uBlue; varying vec3 vPosW;
      void main() {
        vec2 p = vPosW.xz;
        float pool = exp(-dot(p, p) / 9.0) * 0.35;
        float lane = exp(-p.x * p.x / 6.0) * smoothstep(-46.0, -4.0, p.y) * smoothstep(8.0, 0.0, p.y) * 0.12;
        vec3 c = uGold * pool + uBlue * lane;
        gl_FragColor = vec4(c, pool + lane);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Camera-facing radial glow. `stretch` > 1 widens it horizontally (a lens flare streak). */
function glowMaterial(color: THREE.Color, strength: number, falloff = 2.4): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uStrength: { value: strength }, uFalloff: { value: falloff } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uStrength; uniform float uFalloff; varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - d), uFalloff) * uStrength;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function emissive(color: THREE.Color, intensity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(intensity), toneMapped: false });
}

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduce(mq.matches);
    const on = (e: MediaQueryListEvent): void => setReduce(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduce;
}

/** Normalised pointer position over the window (−1..1), for parallax only. */
function usePointer(): MutableRefObject<{ x: number; y: number }> {
  const p = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const on = (e: PointerEvent): void => {
      p.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      p.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', on, { passive: true });
    return () => window.removeEventListener('pointermove', on);
  }, []);
  return p;
}

export function HeroCore(): ReactElement {
  const gl = useThree((s) => s.gl);
  const reduceMotion = usePrefersReducedMotion();
  const pointer = usePointer();
  const core = useRef<THREE.Group>(null);
  const coreGlow = useRef<THREE.Mesh>(null);
  const qubit = useRef<THREE.Mesh>(null);
  const qubitHalo = useRef<THREE.Mesh>(null);
  const coreLight = useRef<THREE.PointLight>(null);
  const streaks = useRef<THREE.LineSegments>(null);
  const t = useRef(0);

  const env = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const tex = pmrem.fromScene(room, 0.04).texture;
    room.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
    });
    pmrem.dispose();
    return tex;
  }, [gl]);
  useEffect(() => () => env.dispose(), [env]);

  const geo = useMemo(() => {
    const lanes = streakLanes();
    const streakPos = new Float32Array(STREAKS * 6);
    const streakCol = new Float32Array(STREAKS * 6);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(streakCol, 3));
    const rand = prng(7);
    const streakState = Array.from({ length: STREAKS }, (_, i) => ({
      lane: lanes[i % lanes.length]!,
      z: TUNNEL_FAR + rand() * (TUNNEL_NEAR - TUNNEL_FAR),
      speed: 5 + rand() * 6,
    }));
    const lathe: THREE.Vector2[] = [];
    // rounded-rectangle (superellipse) profile for the capsule
    for (let i = 0; i <= 48; i++) {
      const th = -Math.PI / 2 + (i / 48) * Math.PI;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const n = 2 / 5;
      lathe.push(new THREE.Vector2(3.75 * Math.pow(Math.abs(c), n), 4.05 * Math.sign(s) * Math.pow(Math.abs(s), n)));
    }
    const dust = new THREE.BufferGeometry();
    const dp: number[] = [];
    const da: number[] = [];
    const dr = prng(11);
    for (let i = 0; i < 500; i++) {
      dp.push((dr() - 0.5) * 2 * TUNNEL_HALF_W, FLOOR_Y + 0.01, TUNNEL_FAR * 0.6 + dr() * (TUNNEL_NEAR - TUNNEL_FAR * 0.6));
      da.push(0.15 + dr() * 0.5);
    }
    dust.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
    dust.setAttribute('aAlpha', new THREE.Float32BufferAttribute(da, 1));
    return {
      wires: buildWires(260, 1),
      coax: buildCoax(34, 2),
      traces: buildTraces(),
      tunnel: buildTunnel(),
      capsule: new THREE.LatheGeometry(lathe, 96),
      streaks: sg,
      streakState,
      dust,
    };
  }, []);

  const m = useMemo(() => {
    const gold = new THREE.MeshStandardMaterial({ color: GOLD.clone().lerp(HIGHLIGHT, 0.1), metalness: 1, roughness: 0.34, envMap: env, envMapIntensity: 0.65 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: DARK.clone().lerp(HIGHLIGHT, 0.06), metalness: 0.85, roughness: 0.35, envMap: env, envMapIntensity: 0.6 });
    return {
      gold,
      darkMetal,
      wires: new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
      traces: new THREE.LineBasicMaterial({ color: GOLD.clone().multiplyScalar(1.6), transparent: true, opacity: 0.9, toneMapped: false }),
      tunnel: new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      streak: new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      capsule: capsuleGlass(GOLD, BLUE),
      floor: floorMaterial(),
      rim: emissive(GOLD, 1.3),
      coreSquare: emissive(GOLD, 2.0),
      qubit: emissive(BLUE.clone().lerp(HIGHLIGHT, 0.35), 3),
      sensorRing: emissive(BLUE, 1.8),
      coreGlow: glowMaterial(GOLD, 1.0, 2.0),
      qubitHalo: glowMaterial(BLUE, 1.2, 3.0),
      flare: glowMaterial(GOLD, 0.9, 1.5),
      vanish: glowMaterial(BLUE.clone().lerp(HIGHLIGHT, 0.3), 0.55, 1.8),
      dust: pointsMaterial(BLUE.clone().lerp(HIGHLIGHT, 0.5), 1.4, 0.6),
    };
  }, [env]);

  useEffect(
    () => () => {
      for (const g of Object.values(geo)) if (g instanceof THREE.BufferGeometry) g.dispose();
      for (const mat of Object.values(m)) mat.dispose();
    },
    [geo, m],
  );

  useFrame((state, dt) => {
    const step = reduceMotion ? 0 : dt;
    t.current += step;
    // AMBIENT: constant-rate breathing of the core glow and the qubit
    const breath = reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t.current * 1.3);
    if (coreGlow.current) coreGlow.current.scale.setScalar(1 + 0.08 * breath);
    if (qubit.current) qubit.current.scale.setScalar(1 + 0.12 * breath);
    if (qubitHalo.current) qubitHalo.current.scale.setScalar(0.9 + 0.25 * breath);
    if (coreLight.current) coreLight.current.intensity = 10 + 3 * breath;
    // AMBIENT: parallax toward the pointer
    const g = core.current;
    if (g) {
      const tx = reduceMotion ? 0 : pointer.current.x * 0.12;
      const ty = reduceMotion ? 0 : pointer.current.y * 0.05;
      g.rotation.y += (tx - g.rotation.y) * Math.min(1, dt * 2.5);
      g.rotation.x += (ty - g.rotation.x) * Math.min(1, dt * 2.5);
    }
    // AMBIENT: light streaks travelling along the tunnel toward the viewer
    const S = streaks.current;
    if (S) {
      const pos = geo.streaks.getAttribute('position') as THREE.BufferAttribute;
      const col = geo.streaks.getAttribute('color') as THREE.BufferAttribute;
      geo.streakState.forEach((s, i) => {
        s.z += s.speed * step;
        if (s.z > TUNNEL_NEAR) s.z = TUNNEL_FAR;
        const [x, y] = s.lane;
        pos.setXYZ(i * 2, x, y, s.z);
        pos.setXYZ(i * 2 + 1, x, y, s.z - STREAK_LEN);
        const k = reduceMotion ? 0 : Math.pow(THREE.MathUtils.clamp((s.z - TUNNEL_FAR) / (TUNNEL_NEAR - TUNNEL_FAR), 0, 1), 1.2) * 1.6;
        col.setXYZ(i * 2, BLUE.r * k + 0.2 * k, BLUE.g * k + 0.2 * k, BLUE.b * k + 0.2 * k);
        col.setXYZ(i * 2 + 1, 0, 0, 0);
      });
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
    // keep camera-facing glows facing the camera
    for (const ref of [coreGlow, qubitHalo]) ref.current?.quaternion.copy(state.camera.quaternion);
  });

  const housingFront = 1.62;

  return (
    <group name="hero-core">
      <ambientLight intensity={0.12} />
      <directionalLight position={[-8, 5, -6]} intensity={2.2} color={BLUE} />
      <directionalLight position={[8, 3, -6]} intensity={1.6} color={BLUE} />
      <directionalLight position={[3, 6, 10]} intensity={0.5} color={HIGHLIGHT} />
      <pointLight ref={coreLight} position={[0, 0, 2.6]} intensity={11} distance={9} decay={2} color={GOLD} />
      <pointLight position={[0, 1.5, -14]} intensity={40} distance={40} decay={2} color={BLUE} />

      {/* the tunnel and its floor */}
      <lineSegments geometry={geo.tunnel} material={m.tunnel} frustumCulled={false} />
      <lineSegments ref={streaks} geometry={geo.streaks} material={m.streak} frustumCulled={false} />
      <mesh material={m.floor} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, -18]}>
        <planeGeometry args={[TUNNEL_HALF_W * 2, 56]} />
      </mesh>
      <points geometry={geo.dust} material={m.dust} frustumCulled={false} />
      <mesh material={m.vanish} position={[0, 0.5, TUNNEL_FAR + 2]}>
        <planeGeometry args={[30, 22]} />
      </mesh>

      <group ref={core}>
        {/* stem to the floor */}
        <mesh material={m.darkMetal} position={[0, (FLOOR_Y + PLATES[3].y) / 2, 0]}>
          <cylinderGeometry args={[0.42, 0.6, PLATES[3].y - FLOOR_Y, 32]} />
        </mesh>

        {/* cryostat plates with lit gold rims */}
        {PLATES.map((p) => (
          <group key={p.y} position={[0, p.y, 0]}>
            <mesh material={m.gold}>
              <cylinderGeometry args={[p.r, p.r, p.h, 96]} />
            </mesh>
            <mesh material={m.rim} position={[0, p.h / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[p.r, 0.014, 6, 160]} />
            </mesh>
          </group>
        ))}
        {/* support rods */}
        {Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2; // 0°, 60°, … — none crosses the front window at 90°
          return (
            <mesh key={i} material={m.gold} position={[Math.cos(a) * 2.05, 0, Math.sin(a) * 2.05]}>
              <cylinderGeometry args={[0.05, 0.05, PLATES[0].y - PLATES[3].y, 12]} />
            </mesh>
          );
        })}
        {/* cable loops on the top and bottom plates */}
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <group key={i}>
              <mesh material={m.gold} position={[Math.cos(a) * 2.2, PLATES[0].y + 0.38, Math.sin(a) * 2.2]} rotation={[0, -a, 0]}>
                <torusGeometry args={[0.24, 0.028, 8, 32]} />
              </mesh>
              <mesh material={m.gold} position={[Math.cos(a + 0.4) * 2.2, PLATES[3].y - 0.38, Math.sin(a + 0.4) * 2.2]} rotation={[0, -a - 0.4, 0]}>
                <torusGeometry args={[0.2, 0.024, 8, 32]} />
              </mesh>
            </group>
          );
        })}

        {/* wiring: fine wires and coax, leaving the front window open */}
        <lineSegments geometry={geo.wires} material={m.wires} />
        <mesh geometry={geo.coax} material={m.gold} />

        {/* core housing and the processor face */}
        <mesh material={m.darkMetal}>
          <cylinderGeometry args={[1.55, 1.55, PLATES[1].y - PLATES[2].y - PLATES[1].h, 64]} />
        </mesh>
        <mesh material={m.darkMetal} position={[0, 0, housingFront - 0.08]}>
          <boxGeometry args={[2.3, 2.3, 0.16]} />
        </mesh>
        <lineSegments geometry={geo.traces} material={m.traces} position={[0, 0, housingFront + 0.002]} />
        <mesh material={m.coreSquare} position={[0, 0, housingFront + 0.004]}>
          <planeGeometry args={[0.42, 0.42]} />
        </mesh>
        {/* four sensor blocks at the corners of the face */}
        {[
          [-1.3, 0.95],
          [1.3, 0.95],
          [-1.3, -0.95],
          [1.3, -0.95],
        ].map(([x, y]) => (
          <group key={`${x},${y}`} position={[x!, y!, housingFront - 0.25]}>
            <mesh material={m.darkMetal}>
              <boxGeometry args={[0.72, 0.6, 0.6]} />
            </mesh>
            <mesh material={m.sensorRing} position={[0, 0, 0.305]}>
              <torusGeometry args={[0.17, 0.018, 8, 48]} />
            </mesh>
          </group>
        ))}
        {/* the qubit, its halo, the core glow and the horizontal flare */}
        <mesh ref={coreGlow} material={m.coreGlow} position={[0, 0, housingFront + 0.2]}>
          <planeGeometry args={[3.4, 3.4]} />
        </mesh>
        <mesh material={m.flare} position={[0, 0, housingFront + 0.25]} scale={[1, 0.05, 1]}>
          <planeGeometry args={[9, 9]} />
        </mesh>
        <mesh ref={qubit} material={m.qubit} position={[0, 0, housingFront + 0.12]}>
          <sphereGeometry args={[0.11, 24, 16]} />
        </mesh>
        <mesh ref={qubitHalo} material={m.qubitHalo} position={[0, 0, housingFront + 0.3]}>
          <planeGeometry args={[1.1, 1.1]} />
        </mesh>

        {/* the glass capsule */}
        <mesh geometry={geo.capsule} material={m.capsule} />
      </group>
    </group>
  );
}
