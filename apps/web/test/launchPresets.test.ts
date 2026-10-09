// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HALF_LIFE_PRESETS } from '@qsd/protocol';

vi.mock('server-only', () => ({}));

describe('launchPresets', () => {
  afterEach(() => {
    delete process.env.QSD_FAST_LAUNCH_PHASE;
  });

  it('offers the protocol presets normally, and only the 5-minute preset during the launch phase', async () => {
    const { launchPresets, FAST_LAUNCH_PRESET } = await import('@/server/launch');
    expect(launchPresets()).toBe(HALF_LIFE_PRESETS);
    process.env.QSD_FAST_LAUNCH_PHASE = 'true';
    expect(launchPresets()).toEqual([FAST_LAUNCH_PRESET]);
    expect(FAST_LAUNCH_PRESET).toMatchObject({ halfLifeSec: 300, maxWindowSec: 600 });
  });
});
