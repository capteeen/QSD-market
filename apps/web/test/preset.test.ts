import { describe, expect, it } from 'vitest';
import { preset } from '@qsd/ui-tokens';
import generated from '../src/styles/tailwind.preset.generated.json';

describe('tailwind preset snapshot', () => {
  it('equals the live @qsd/ui-tokens preset (run `pnpm --filter web tailwind:preset` on drift)', () => {
    expect(generated).toEqual(JSON.parse(JSON.stringify(preset)));
  });
});
