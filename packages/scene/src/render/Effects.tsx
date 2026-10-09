/**
 * Post-processing, gated by the quality profile: subtle bloom, depth of
 * field focused at the centre (so only the periphery softens) and a faint
 * cold radial vignette. 'low' renders nothing here.
 */
import { Bloom, DepthOfField, EffectComposer, Vignette } from '@react-three/postprocessing';
import { type ReactElement } from 'react';
import { useQualityProfile } from './context.js';

export function Effects(): ReactElement | null {
  const q = useQualityProfile();
  if (!q.bloom && !q.depthOfField && !q.vignette) return null;
  const children: ReactElement[] = [];
  if (q.bloom) children.push(<Bloom key="bloom" luminanceThreshold={0.55} luminanceSmoothing={0.35} intensity={0.85} mipmapBlur radius={0.6} />);
  if (q.depthOfField) children.push(<DepthOfField key="dof" target={[0, 0, 0]} focalLength={0.035} bokehScale={2.2} />);
  if (q.vignette) children.push(<Vignette key="vignette" eskil={false} offset={0.22} darkness={0.8} />);
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {children}
    </EffectComposer>
  );
}
