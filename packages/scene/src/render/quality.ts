/**
 * Quality ladder. Degrades post-processing and resolution before frame rate,
 * and NEVER geometry counts: every level draws exactly the same 67 × 16 links,
 * 256 leaves, 255 fused nodes and N vessels.
 *
 *   ultra   bloom + depth of field + vignette, transmission glass, dpr ≤ 2
 *   high    bloom + vignette (no DOF),         transmission glass, dpr ≤ 1.5
 *   medium  vignette only,                      transmission glass, dpr 1
 *   low     no post-processing,                 glass without transmission, dpr 0.75
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

export type QualityLevel = 'ultra' | 'high' | 'medium' | 'low';
export const QUALITY_LEVELS: readonly QualityLevel[] = ['ultra', 'high', 'medium', 'low'];

export interface QualityProfile {
  level: QualityLevel;
  bloom: boolean;
  depthOfField: boolean;
  vignette: boolean;
  transmission: boolean;
  /** Device-pixel-ratio cap. */
  dpr: number;
}

export const QUALITY_PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = {
  ultra: { level: 'ultra', bloom: true, depthOfField: true, vignette: true, transmission: true, dpr: 2 },
  high: { level: 'high', bloom: true, depthOfField: false, vignette: true, transmission: true, dpr: 1.5 },
  medium: { level: 'medium', bloom: false, depthOfField: false, vignette: true, transmission: true, dpr: 1 },
  low: { level: 'low', bloom: false, depthOfField: false, vignette: false, transmission: false, dpr: 0.75 },
};

export interface QualityState {
  /** Current profile. */
  profile: QualityProfile;
  /** 'auto' adapts; a fixed level never changes. */
  mode: 'auto' | QualityLevel;
  /** Median fps of the last completed window, or null before the first window. */
  medianFps: number | null;
  /** Number of automatic downgrades so far. */
  downgrades: number;
}

export interface QualityController extends StoreApi<QualityState> {
  /** Feed one frame time in seconds. Call from the render loop. */
  sample(dt: number): void;
  setMode(mode: 'auto' | QualityLevel): void;
}

export interface QualityOptions {
  mode?: 'auto' | QualityLevel;
  /** Highest level 'auto' may use. Default 'ultra'. */
  cap?: QualityLevel;
  /** Target median fps. Default 55. */
  targetFps?: number;
  /** Frames per decision window. Default 90 (1.5 s at 60 fps). */
  window?: number;
}

export function createQualityController(opts: QualityOptions = {}): QualityController {
  const cap = opts.cap ?? 'ultra';
  const target = opts.targetFps ?? 55;
  const windowSize = opts.window ?? 90;
  const mode = opts.mode ?? 'auto';
  const initial = mode === 'auto' ? cap : mode;

  const base = createStore<QualityState>(() => ({ profile: QUALITY_PROFILES[initial], mode, medianFps: null, downgrades: 0 }));
  const ctl = base as QualityController;

  const times: number[] = [];
  let goodWindows = 0;
  let badWindows = 0;

  ctl.sample = (dt) => {
    if (!(dt > 0) || dt > 1) return; // ignore tab-switch stalls
    times.push(dt);
    if (times.length < windowSize) return;
    const sorted = times.slice().sort((a, b) => a - b);
    const median = 1 / (sorted[sorted.length >> 1] as number);
    times.length = 0;
    const s = base.getState();
    if (s.mode !== 'auto') {
      base.setState({ medianFps: median });
      return;
    }
    const idx = QUALITY_LEVELS.indexOf(s.profile.level);
    const capIdx = QUALITY_LEVELS.indexOf(cap);
    if (median < target) {
      badWindows++;
      goodWindows = 0;
      if (badWindows >= 1 && idx < QUALITY_LEVELS.length - 1) {
        base.setState({ profile: QUALITY_PROFILES[QUALITY_LEVELS[idx + 1] as QualityLevel], medianFps: median, downgrades: s.downgrades + 1 });
        badWindows = 0;
        return;
      }
    } else if (median > target + 15) {
      goodWindows++;
      badWindows = 0;
      if (goodWindows >= 6 && idx > capIdx) {
        base.setState({ profile: QUALITY_PROFILES[QUALITY_LEVELS[idx - 1] as QualityLevel], medianFps: median });
        goodWindows = 0;
        return;
      }
    } else {
      goodWindows = 0;
      badWindows = 0;
    }
    base.setState({ medianFps: median });
  };

  ctl.setMode = (m) => {
    times.length = 0;
    goodWindows = badWindows = 0;
    base.setState({ mode: m, profile: QUALITY_PROFILES[m === 'auto' ? cap : m] });
  };

  return ctl;
}
