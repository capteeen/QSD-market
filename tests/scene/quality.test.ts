/**
 * Item 7 (controller part). SPEC §7 PERFORMANCE: "Degrade bloom/DOF before
 * degrading frame rate; never degrade correctness of the chain counts."
 */
import { describe, expect, it } from 'vitest';
import { QUALITY_LEVELS, QUALITY_PROFILES, createQualityController, type QualityLevel } from '@qsd/scene';

function feed(ctl: ReturnType<typeof createQualityController>, frames: number, fps: number): void {
  for (let i = 0; i < frames; i++) ctl.sample(1 / fps);
}

describe('quality ladder', () => {
  it('ladder order degrades DOF, then bloom, then vignette+transmission+dpr — never a geometry count', () => {
    expect(QUALITY_LEVELS).toEqual(['ultra', 'high', 'medium', 'low']);
    const [u, h, m, l] = QUALITY_LEVELS.map((k) => QUALITY_PROFILES[k]);
    expect(u).toMatchObject({ bloom: true, depthOfField: true, vignette: true, transmission: true });
    expect(h).toMatchObject({ bloom: true, depthOfField: false, vignette: true, transmission: true });
    expect(m).toMatchObject({ bloom: false, depthOfField: false, vignette: true, transmission: true });
    expect(l).toMatchObject({ bloom: false, depthOfField: false, vignette: false, transmission: false });
    expect(u!.dpr).toBeGreaterThanOrEqual(h!.dpr);
    expect(h!.dpr).toBeGreaterThanOrEqual(m!.dpr);
    expect(m!.dpr).toBeGreaterThanOrEqual(l!.dpr);
    // the profile type has no count-like field at all
    for (const p of [u, h, m, l]) expect(Object.keys(p!).sort()).toEqual(['bloom', 'depthOfField', 'dpr', 'level', 'transmission', 'vignette']);
  });

  it('auto mode steps down one level per bad window and back up only after six comfortable windows', () => {
    const ctl = createQualityController({ mode: 'auto', targetFps: 55, window: 90 });
    expect(ctl.getState().profile.level).toBe('ultra');
    feed(ctl, 89, 20);
    expect(ctl.getState().profile.level).toBe('ultra'); // window not complete
    feed(ctl, 1, 20);
    expect(ctl.getState().profile.level).toBe('high');
    expect(ctl.getState().downgrades).toBe(1);
    feed(ctl, 90, 20);
    expect(ctl.getState().profile.level).toBe('medium');
    feed(ctl, 90, 20);
    expect(ctl.getState().profile.level).toBe('low');
    feed(ctl, 900, 20);
    expect(ctl.getState().profile.level).toBe('low'); // floor
    expect(ctl.getState().downgrades).toBe(3);
    // recovery: needs > target+15 for six windows
    feed(ctl, 90 * 5, 90);
    expect(ctl.getState().profile.level).toBe('low');
    feed(ctl, 90, 90);
    expect(ctl.getState().profile.level).toBe('medium');
    // 60 fps is "fine" but not comfortable: no promotion
    feed(ctl, 90 * 12, 60);
    expect(ctl.getState().profile.level).toBe('medium');
  });

  it('a fixed level never changes, and the cap bounds auto', () => {
    for (const level of QUALITY_LEVELS as QualityLevel[]) {
      const ctl = createQualityController({ mode: level });
      feed(ctl, 900, 5);
      feed(ctl, 900, 120);
      expect(ctl.getState().profile.level).toBe(level);
      expect(ctl.getState().medianFps).not.toBeNull();
    }
    const capped = createQualityController({ mode: 'auto', cap: 'medium' });
    expect(capped.getState().profile.level).toBe('medium');
    feed(capped, 90 * 20, 120);
    expect(capped.getState().profile.level).toBe('medium');
  });

  it('ignores non-positive, NaN and > 1 s samples (tab switches)', () => {
    const ctl = createQualityController({ mode: 'auto', window: 10 });
    for (let i = 0; i < 100; i++) ctl.sample(NaN);
    for (let i = 0; i < 100; i++) ctl.sample(0);
    for (let i = 0; i < 100; i++) ctl.sample(-1);
    for (let i = 0; i < 100; i++) ctl.sample(5);
    expect(ctl.getState().profile.level).toBe('ultra');
    expect(ctl.getState().medianFps).toBeNull();
  });

  /**
   * FAILS-BY-DESIGN (H-S6). The decision window is 90 *frames*, not a time
   * span. On the very device the ladder exists for (one that cannot hold
   * the target), reaching 'low' from 'ultra' needs 270 frames: at 5 fps that
   * is 54 s of degraded frame rate before post-processing is fully shed, at
   * 2 fps 135 s. The spec asks for bloom/DOF to be degraded BEFORE the
   * frame rate; this controller degrades them only after the frame rate has
   * been bad for a (frame-rate-dependent) long time. The README's own
   * SwiftShader 'auto' run never finished within 10 min for this reason.
   */
  it('[H-S6] from ultra at 5 fps, post-processing should be fully shed within 10 s of wall time', () => {
    const ctl = createQualityController({ mode: 'auto', targetFps: 55 });
    let simulatedSeconds = 0;
    while (ctl.getState().profile.level !== 'low' && simulatedSeconds < 600) {
      ctl.sample(0.2);
      simulatedSeconds += 0.2;
    }
    expect(simulatedSeconds, `took ${simulatedSeconds.toFixed(1)} s of 5 fps frames to reach 'low'`).toBeLessThanOrEqual(10);
  });
});
