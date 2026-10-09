/**
 * Camera-facing glow sprites, drawn as one instanced quad per sprite. Used by
 * the scroll story for particles and halos. Quads (not GL points) so halo
 * size is never clamped by a device's maximum point size, which is as low as
 * 64 px on some mobile GPUs.
 */
import * as THREE from 'three';

export interface SpriteBuffers {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  offset: Float32Array;
  color: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  /** Mark every attribute dirty after writing a frame. */
  commit(): void;
}

/**
 * @param count     number of sprites
 * @param softness  falloff exponent: ~2 for crisp particles, ~4+ for wide, faint halos
 */
export function createSprites(count: number, softness: number): SpriteBuffers {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.instanceCount = count;

  const offset = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const alpha = new Float32Array(count);
  const aOffset = new THREE.InstancedBufferAttribute(offset, 3).setUsage(THREE.DynamicDrawUsage);
  const aColor = new THREE.InstancedBufferAttribute(color, 3).setUsage(THREE.DynamicDrawUsage);
  const aSize = new THREE.InstancedBufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
  const aAlpha = new THREE.InstancedBufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iOffset', aOffset);
  geo.setAttribute('iColor', aColor);
  geo.setAttribute('iSize', aSize);
  geo.setAttribute('iAlpha', aAlpha);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uSoft: { value: softness } },
    vertexShader: `
      attribute vec3 iOffset; attribute vec3 iColor; attribute float iSize; attribute float iAlpha;
      varying vec2 vUv; varying vec3 vColor; varying float vAlpha;
      void main() {
        vUv = position.xy * 2.0;
        vColor = iColor; vAlpha = iAlpha;
        vec4 mv = modelViewMatrix * vec4(iOffset, 1.0);
        mv.xy += position.xy * iSize;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uSoft;
      varying vec2 vUv; varying vec3 vColor; varying float vAlpha;
      void main() {
        float d = length(vUv);
        if (d > 1.0 || vAlpha <= 0.001) discard;
        float a = pow(1.0 - d, uSoft);
        gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return {
    mesh,
    offset,
    color,
    size,
    alpha,
    commit() {
      aOffset.needsUpdate = true;
      aColor.needsUpdate = true;
      aSize.needsUpdate = true;
      aAlpha.needsUpdate = true;
    },
  };
}

export function setSprite(s: SpriteBuffers, i: number, p: THREE.Vector3, c: THREE.Color, size: number, alpha: number): void {
  s.offset[i * 3] = p.x;
  s.offset[i * 3 + 1] = p.y;
  s.offset[i * 3 + 2] = p.z;
  s.color[i * 3] = c.r;
  s.color[i * 3 + 1] = c.g;
  s.color[i * 3 + 2] = c.b;
  s.size[i] = size;
  s.alpha[i] = alpha;
}
