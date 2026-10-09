import type { Config } from 'tailwindcss';
// Generated from @qsd/ui-tokens by scripts/tailwind-preset.ts (see that file); never edited by hand.
import preset from './src/styles/tailwind.preset.generated.json';

export default {
  presets: [preset as unknown as Partial<Config>],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui-tokens/src/**/*.{ts,tsx}', '../../packages/scene/src/**/*.{ts,tsx}'],
} satisfies Config;
