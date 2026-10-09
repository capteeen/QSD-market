'use client';
/**
 * The WebGL scenes from @qsd/scene are client-only (three.js); they are
 * loaded with next/dynamic({ ssr: false }). The loading fallback is an
 * empty chamber-coloured box, not an animation.
 */
import dynamic from 'next/dynamic';
import type { ReactElement } from 'react';

function Loading(): ReactElement {
  return <div className="h-full w-full bg-void" aria-busy="true" aria-label="loading scene" />;
}

export const FieldScene = dynamic(() => import('@qsd/scene').then((m) => m.FieldScene), { ssr: false, loading: Loading });
export const LaunchSequence = dynamic(() => import('@qsd/scene').then((m) => m.LaunchSequence), { ssr: false, loading: Loading });
export const MeasurementScene = dynamic(() => import('@qsd/scene').then((m) => m.MeasurementScene), { ssr: false, loading: Loading });
export const CollapseScene = dynamic(() => import('@qsd/scene').then((m) => m.CollapseScene), { ssr: false, loading: Loading });
export const StoryScene = dynamic(() => import('@qsd/scene').then((m) => m.StoryScene), { ssr: false, loading: Loading });
