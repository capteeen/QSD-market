/**
 * Shader warm-up. Every stage introduces materials the GPU has not compiled
 * and linked yet (lit instanced glass, plain glass, the points shader,
 * emissive, lines, additive basic). three links a program on the first draw
 * that uses it (`WebGLProgram.onFirstUse`), so without this the first frame
 * of a stage stalls for the link.
 *
 * After the first frame has painted: build a private scene holding one tiny
 * sample of each material variant, `compileAsync` it (non-blocking where
 * KHR_parallel_shader_compile exists), and when it resolves draw the samples
 * for exactly one frame — in the frustum, at scale 1e-4, so they rasterise
 * nothing — which completes the links while nothing else is pending. Then
 * they are hidden for good. Encodes no data; draws nothing visible.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import * as THREE from 'three';
import { useQualityProfile } from './context.js';
import { AMBER, COLLAPSE, CYAN, MAGENTA, WHITE, emissiveMaterial, glassMaterial, lineMaterial, litInstancedGlass, pointsMaterial } from './materials.js';

function buildSamples(transmission: boolean): THREE.Object3D[] {
  const objects: THREE.Object3D[] = [];
  const box = new THREE.BoxGeometry(0.01, 0.01, 0.01);
  const litBox = box.clone();
  litBox.setAttribute('aLit', new THREE.InstancedBufferAttribute(new Float32Array(1), 1));
  const lit = new THREE.InstancedMesh(litBox, litInstancedGlass({ transmission, litColor: CYAN, activeColor: MAGENTA }), 1);
  const litW = new THREE.InstancedMesh(litBox, litInstancedGlass({ transmission, litColor: WHITE, activeColor: MAGENTA }), 1);
  const litFlat = new THREE.InstancedMesh(litBox, litInstancedGlass({ transmission: false, opacity: 0.35, litColor: CYAN, activeColor: WHITE }), 1);
  litFlat.setColorAt(0, new THREE.Color(CYAN));
  objects.push(lit, litW, litFlat);
  objects.push(new THREE.Mesh(box, glassMaterial({ transmission })));
  objects.push(new THREE.Mesh(box, glassMaterial({ transmission: false, color: CYAN })));
  objects.push(new THREE.Mesh(box, glassMaterial({ transmission: false, color: AMBER })));
  objects.push(new THREE.Mesh(box, emissiveMaterial(CYAN, 1)));
  objects.push(new THREE.Mesh(box, emissiveMaterial(COLLAPSE, 1)));
  objects.push(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })));
  objects.push(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.5 })));
  const pts = new THREE.BufferGeometry();
  pts.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  pts.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array([1]), 1));
  objects.push(new THREE.Points(pts, pointsMaterial(CYAN, 1, 0.5)));
  objects.push(new THREE.Points(pts, pointsMaterial(WHITE, 1, 0.5)));
  objects.push(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0.01, 0)]), lineMaterial(CYAN, 0.5)));
  for (const o of objects) {
    o.scale.setScalar(0.0001);
    o.frustumCulled = false;
  }
  return objects;
}

export function Warmup(): ReactElement {
  const { gl, camera, scene } = useThree();
  const q = useQualityProfile();
  const group = useRef<THREE.Group>(null);
  const phase = useRef<'wait' | 'compiling' | 'draw' | 'done'>('wait');
  const frames = useRef(0);
  const samples = useMemo(() => buildSamples(q.transmission), [q.transmission]);

  useEffect(() => {
    phase.current = 'wait';
    frames.current = 0;
  }, [samples]);

  useFrame(({ camera: cam }) => {
    const g = group.current;
    if (!g) return;
    switch (phase.current) {
      case 'wait': {
        frames.current++;
        if (frames.current < 2) return; // let the stage-1 frame paint first
        phase.current = 'compiling';
        const warm = new THREE.Scene();
        for (const o of samples) warm.add(o);
        const next = (): void => {
          for (const o of samples) g.add(o); // move into the live scene for the one-frame draw
          phase.current = 'draw';
        };
        const r = gl as THREE.WebGLRenderer;
        if (typeof r.compileAsync === 'function') r.compileAsync(warm, camera, scene).then(next, next);
        else {
          try {
            r.compile(warm, camera, scene);
          } catch {
            /* pay at first use */
          }
          next();
        }
        return;
      }
      case 'draw': {
        // in front of the camera, invisible at this scale; drawn this frame, hidden next
        g.position.copy(cam.position).addScaledVector(cam.getWorldDirection(new THREE.Vector3()), 2);
        g.visible = true;
        phase.current = 'done';
        return;
      }
      case 'done':
        if (g.visible) g.visible = false;
        return;
      default:
        return;
    }
  });

  return <group ref={group} name="shader-warmup" visible={false} />;
}
