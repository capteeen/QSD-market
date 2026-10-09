/**
 * <StackScene /> — the quantum stack drawn by scroll. Dark sections: solid
 * dark body with a hard peach rim band from an upper-left key light, thin
 * near-black edge lines. Paper sections: the same geometry filled in paper
 * and drawn as grey line-art (hidden lines removed by the fill).
 *
 * Driven only by the host's scroll progress (a ref read every frame) and,
 * in the hero, a slow idle spin that encodes nothing (documented ambient;
 * off with reduced motion). Every frame the host receives the screen
 * position of each part's callout anchor and of the object's centre.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type CSSProperties, type MutableRefObject, type ReactElement } from 'react';
import * as THREE from 'three';
import { colors } from '@qsd/ui-tokens';
import { approach } from '../materials.js';
import { buildStackParts, disposeStackParts, type StackPartId } from './parts.js';
import { stackPose, type StackLayout, type StackPose } from './timeline.js';

export interface StackAnchor {
  id: StackPartId | 'center';
  /** Screen position in CSS pixels relative to the canvas. */
  x: number;
  y: number;
  /** Projected radius of the whole object (center only), in pixels. */
  r: number;
  visible: boolean;
}

export interface StackSceneProps {
  /** Scroll progress through the story, 0 … 1 (read every frame; no React render per scroll). */
  progress: MutableRefObject<number>;
  layout: StackLayout;
  /** Disables the idle spin; the scroll still drives the pose. */
  reducedMotion?: boolean;
  /** False while off screen: the render loop stops. */
  running?: boolean;
  onAnchors?: (anchors: readonly StackAnchor[], pose: StackPose) => void;
  className?: string;
  style?: CSSProperties;
}

const BODY = new THREE.Color('#33312F');
const BODY_DEEP = new THREE.Color('#1D1C1B');
const RIM = new THREE.Color(colors.rim);
const PAPER = new THREE.Color(colors.paper);
const LINE_DARK = new THREE.Color('#131211');
const LINE_PAPER = new THREE.Color(colors.line);
const GOLD = new THREE.Color(colors.gold);
const ICE = new THREE.Color(colors.ice);

function bodyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBody: { value: BODY.clone() },
      uDeep: { value: BODY_DEEP.clone() },
      uRim: { value: RIM.clone() },
      uPaper: { value: PAPER.clone() },
      uMode: { value: 0 },
      uLight: { value: new THREE.Vector3(-0.55, 0.7, 0.45).normalize() },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uBody, uDeep, uRim, uPaper, uLight; uniform float uMode;
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 n = normalize(vN);
        float key = dot(n, normalize(uLight));
        float band = smoothstep(0.62, 0.72, key);           // the hard peach band
        float fill = 0.35 + 0.65 * clamp(key * 0.5 + 0.5, 0.0, 1.0);
        float fres = pow(1.0 - clamp(dot(n, vV), 0.0, 1.0), 3.0);
        vec3 dark = mix(uDeep, uBody, fill);
        dark = mix(dark, uRim, band);
        dark += uRim * fres * 0.12;
        vec3 paper = uPaper * (0.985 + 0.015 * key);
        gl_FragColor = vec4(mix(dark, paper, uMode), 1.0);
      }`,
  });
}

function glowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uGold: { value: GOLD.clone() },
      uIce: { value: ICE.clone() },
      uPaper: { value: PAPER.clone() },
      uMode: { value: 0 },
      uPulse: { value: 0 },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vP;
      void main() { vN = normalize(normalMatrix * normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uGold, uIce, uPaper; uniform float uMode, uPulse;
      varying vec3 vN; varying vec3 vP;
      void main() {
        float up = clamp(vN.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = mix(uGold * 0.55, uGold * 1.25, up);
        if (vP.y > 0.16) c = mix(uIce, vec3(1.0), 0.35 + 0.25 * uPulse);
        gl_FragColor = vec4(mix(c, uPaper, uMode), 1.0);
      }`,
  });
}

function Stack({ progress, layout, reducedMotion = false, onAnchors }: StackSceneProps): ReactElement {
  const parts = useMemo(() => buildStackParts(), []);
  const body = useMemo(() => bodyMaterial(), []);
  const glow = useMemo(() => glowMaterial(), []);
  const line = useMemo(() => new THREE.LineBasicMaterial({ color: LINE_DARK.clone(), transparent: true, opacity: 0.9 }), []);
  const root = useRef<THREE.Group>(null);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const { camera, size } = useThree();
  const spin = useRef(0);
  const smooth = useRef<StackPose | null>(null);
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), c: new THREE.Color(), anchors: [] as StackAnchor[] }), []);

  useEffect(() => {
    return () => {
      disposeStackParts(parts);
      body.dispose();
      glow.dispose();
      line.dispose();
    };
  }, [parts, body, glow, line]);

  useFrame((state, dt) => {
    const target = stackPose(progress.current, layout);
    const s = smooth.current ?? (smooth.current = { ...target });
    // ease toward the scroll target so fast scrolling still reads as motion
    const k = Math.min(1, dt * 9);
    for (const key of Object.keys(target) as (keyof StackPose)[]) s[key] += (target[key] - s[key]) * k;
    if (!reducedMotion) spin.current += s.spin * dt;

    const g = root.current;
    if (!g) return;
    g.position.set(s.x, s.y, 0);
    g.scale.setScalar(s.scale);
    g.rotation.set(s.rotX, s.rotY + spin.current, s.rotZ, 'ZYX');
    parts.forEach((p, i) => {
      const pg = groups.current[i];
      if (pg) pg.position.y = p.spec.y + p.spec.explode * s.explode;
    });
    (body.uniforms.uMode as THREE.IUniform<number>).value = s.mode;
    (glow.uniforms.uMode as THREE.IUniform<number>).value = s.mode;
    (glow.uniforms.uPulse as THREE.IUniform<number>).value = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 1.7);
    line.color.copy(LINE_DARK).lerp(LINE_PAPER, s.mode);
    line.opacity = approach(line.opacity, s.mode > 0.5 ? 1 : 0.9, dt, 4);

    if (onAnchors) {
      const out = tmp.anchors;
      out.length = 0;
      const project = (id: StackAnchor['id'], v: THREE.Vector3, r: number): void => {
        const z = v.project(camera).z;
        out.push({ id, x: (v.x * 0.5 + 0.5) * size.width, y: (-v.y * 0.5 + 0.5) * size.height, r, visible: z > -1 && z < 1 });
      };
      // object centre + projected radius (for the hero dial)
      g.getWorldPosition(tmp.v);
      const edge = tmp.v.clone().add(new THREE.Vector3(0, 3.1 * s.scale, 0)).project(camera);
      const ctr = tmp.v.clone().project(camera);
      const rPx = Math.hypot((edge.x - ctr.x) * 0.5 * size.width, (edge.y - ctr.y) * 0.5 * size.height);
      project('center', tmp.v, rPx);
      parts.forEach((p, i) => {
        const pg = groups.current[i];
        if (!pg || p.spec.glow) return;
        tmp.v.set(...p.spec.anchor);
        pg.localToWorld(tmp.v);
        project(p.spec.id, tmp.v, 0);
      });
      onAnchors(out, s);
    }
  });

  return (
    <group ref={root}>
      {parts.map((p, i) => (
        <group key={`${p.spec.id}-${i}`} ref={(el) => {
            groups.current[i] = el;
          }} position={[0, p.spec.y, 0]}>
          <mesh geometry={p.fill} material={p.spec.glow ? glow : body} />
          <lineSegments geometry={p.edges} material={line} />
        </group>
      ))}
    </group>
  );
}

export function StackScene(props: StackSceneProps): ReactElement {
  const { running = true, className, style } = props;
  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', ...style }} data-qsd-stack>
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov: 38, near: 0.1, far: 60, position: [0, 0.2, 10.5] }}
        frameloop={running ? 'always' : 'never'}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Stack {...props} />
      </Canvas>
    </div>
  );
}
