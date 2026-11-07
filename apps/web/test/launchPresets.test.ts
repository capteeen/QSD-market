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
    expect(() => validateLaunchForm(form)).toThrow(/first buy/);
    expect(form.halfLifePreset).toBe('24h');
  });

  it('keeps blank socials blank and stores https links, including an x or telegram handle', async () => {
    const { validateLaunchForm } = await import('@/server/launch');
    const base = {
      name: 'Photon',
      ticker: 'PHO',
      description: '',
      halfLifePreset: '24h',
      devBuyWei: '0',
      image: { bytes: new Uint8Array([1]), mime: 'image/png' },
      wallet: `0x${'11'.repeat(20)}`,
      paymentSignature: `0x${'ab'.repeat(32)}`,
      website: '',
      twitter: '@hypiobeat',
      telegram: 't.me/hypiobeat',
    };
    expect(() => validateLaunchForm(base)).not.toThrow();
    expect(base.website).toBeNull();
    expect(base.twitter).toBe('https://x.com/hypiobeat');
    expect(base.telegram).toBe('https://t.me/hypiobeat');
    expect(() => validateLaunchForm({ ...base, website: 'javascript:alert(1)' })).toThrow(/website must be an https link/);
  });
});

describe('parseHypeToWei', () => {
  it('reads a typed HYPE amount as wei and rejects a blank or an amount over 100', async () => {
    const { parseHypeToWei } = await import('@/lib/hype');
    expect(parseHypeToWei('')).toBeNull();
    expect(parseHypeToWei('1')).toBe(10n ** 18n);
    expect(parseHypeToWei('0.5')).toBe(5n * 10n ** 17n);
    expect(parseHypeToWei('1.')).toBe(10n ** 18n);
    expect(() => parseHypeToWei('101')).toThrow(/between 0 and 100/);
    expect(() => parseHypeToWei('nope')).toThrow(/HYPE amount/);
  });
});
