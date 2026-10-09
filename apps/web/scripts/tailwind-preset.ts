/**
 * Snapshot `@qsd/ui-tokens`'s Tailwind preset to JSON. Tailwind loads
 * tailwind.config.ts with jiti, which cannot resolve the workspace packages'
 * `./x.js` → `./x.ts` specifiers; tsx can. The preset is pure data (no
 * plugins), so the snapshot is exact; test/preset.test.ts fails on drift.
 * Runs automatically before `dev` and `build`.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { preset } from '@qsd/ui-tokens/preset';

const out = path.resolve(__dirname, '../src/styles/tailwind.preset.generated.json');
writeFileSync(out, JSON.stringify(preset, null, 2) + '\n');
console.log(`wrote ${out}`);
