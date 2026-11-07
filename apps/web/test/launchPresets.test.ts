// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HALF_LIFE_PRESETS } from '@qsd/protocol';

vi.mock('server-only', () => ({}));

describe('launchPresets', () => {
  afterEach(() => {
    delete process.env.QSD_FAST_LAUNCH_PHASE;
  });

  it('offers the protocol presets normally, and only the 30-second preset during the launch phase', async () => {
    const { launchPresets, FAST_LAUNCH_PRESET } = await import('@/server/launch');
    expect(launchPresets()).toBe(HALF_LIFE_PRESETS);
    process.env.QSD_FAST_LAUNCH_PHASE = 'true';
    expect(launchPresets()).toEqual([FAST_LAUNCH_PRESET]);
    expect(FAST_LAUNCH_PRESET).toMatchObject({ halfLifeSec: 30, maxWindowSec: 60 });
  });

  it('a launch form with no half-life choice uses the 24 hour preset', async () => {
    const { directLaunchPreset, validateLaunchForm } = await import('@/server/launch');
    expect(directLaunchPreset().id).toBe('24h');
    const form = { name: 'Photon', ticker: 'PHO', description: '', halfLifePreset: '' };
    expect(() => validateLaunchForm(form)).toThrow(/dev buy/);
    expect(form.halfLifePreset).toBe('24h');
  });
});
