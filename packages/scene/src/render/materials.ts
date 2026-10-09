/**
 * Materials: pure geometry and light. No textures, no environment maps.
 *
 * Glass = MeshPhysicalMaterial with transmission (refraction), thin-film
 * iridescence on the edges, low roughness. Emission is done per instance by
 * a small shader patch (`aLit` attribute): 0 = dark glass, 1 = lit in
 * probability cyan, 2 = active computation in magenta-white.
 */
import * as THREE from 'three';
import { colors, glow } from '@qsd/ui-tokens';

export const CYAN = new THREE.Color(colors.probability);
export const MAGENTA = new THREE.Color(glow.computeInner);
export const WHITE = new THREE.Color(glow.computeOuter);
export const AMBER = new THREE.Color(colors.decay);
export const COLLAPSE = new THREE.Color(colors.collapse);
export const VOID = new THREE.Color(colors.void);
export const DEAD = new THREE.Color(colors.dead);
export const TUNNEL = new THREE.Color(colors.tunnel);
export const GOLD = new THREE.Color(colors.gold);
export const ICE = new THREE.Color(colors.ice);

export interface GlassOptions {
  transmission?: boolean;
  thickness?: number;
  ior?: number;
  roughness?: number;
  color?: THREE.ColorRepresentation;
  opacity?: number;
}

export function glassMaterial(opts: GlassOptions = {}): THREE.MeshPhysicalMaterial {
  const transmission = opts.transmission ?? true;
  const m = new THREE.MeshPhysicalMaterial({
    color: opts.color ?? 0xffffff,
    metalness: 0,
    roughness: opts.roughness ?? 0.08,
    transmission: transmission ? 1 : 0,
    thickness: opts.thickness ?? 0.6,
    ior: opts.ior ?? 1.45,
    iridescence: 1,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [100, 400],
    transparent: !transmission,
    opacity: transmission ? 1 : (opts.opacity ?? 0.18),
    side: THREE.FrontSide,
    envMapIntensity: 0,
  });
  return m;
}

export interface LitInstancedMaterial extends THREE.MeshPhysicalMaterial {
  userData: { uniforms: { uLit: { value: THREE.Color }; uActive: { value: THREE.Color }; uGlow: { value: number } } };
}

/**
 * Glass whose emission is controlled per instance by the `aLit` attribute.
 * Lit (1) glows in `litColor`; active (2) adds `activeColor` on top.
 */
export function litInstancedGlass(opts: GlassOptions & { litColor?: THREE.Color; activeColor?: THREE.Color } = {}): LitInstancedMaterial {
  const m = glassMaterial(opts) as LitInstancedMaterial;
  const uniforms = {
    uLit: { value: (opts.litColor ?? CYAN).clone() },
    uActive: { value: (opts.activeColor ?? MAGENTA).clone().lerp(WHITE, 0.35) },
    uGlow: { value: 1 },
  };
  m.userData = { uniforms };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLit = uniforms.uLit;
    shader.uniforms.uActive = uniforms.uActive;
    shader.uniforms.uGlow = uniforms.uGlow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLit;\nvarying float vLit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLit;\nuniform vec3 uLit;\nuniform vec3 uActive;\nuniform float uGlow;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n' +
          'float litAmt = clamp(vLit, 0.0, 1.0);\n' +
          'float activeAmt = clamp(vLit - 1.0, 0.0, 1.0);\n' +
          'totalEmissiveRadiance += uGlow * (uLit * litAmt * 0.9 + uActive * activeAmt * 2.2);',
      );
  };
  m.customProgramCacheKey = () => 'qsd-lit-instanced-glass';
  return m;
}

/** Soft additive point material for photons and clouds. No sprite texture: round points via shader. */
export function pointsMaterial(color: THREE.Color, size: number, opacity = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uSize: { value: size },
      uOpacity: { value: opacity },
      uPixelRatio: { value: 1 },
    },
    vertexShader: `
      uniform float uSize; uniform float uPixelRatio;
      attribute float aAlpha; varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * uPixelRatio * (12.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity; varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.05, d);
        gl_FragColor = vec4(uColor, a * uOpacity * vAlpha);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function emissiveMaterial(color: THREE.Color, intensity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: VOID, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0 });
}

export function lineMaterial(color: THREE.Color, opacity = 0.6): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
}

/** Critically damped-ish exponential approach: frame-rate independent easing toward a target. */
export function approach(current: number, target: number, dt: number, rate = 6): number {
  const k = 1 - Math.exp(-rate * dt);
  return current + (target - current) * k;
}
