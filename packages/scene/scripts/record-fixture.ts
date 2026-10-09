/**
 * `pnpm --filter @qsd/scene fixtures`
 * Records the real event stream fixture (see test/fixtures/generate.ts).
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_DIR, generateFixture, writeFixture } from '../test/fixtures/generate.js';

const t0 = performance.now();
const f = await generateFixture();
writeFixture(f);
const bytes = statSync(join(FIXTURE_DIR, 'crypto.bin')).size;
console.log(
  `fixture written to ${FIXTURE_DIR}\n` +
    `  crypto events: ${f.crypto.length} (${(bytes / 1e6).toFixed(1)} MB, redacted)\n` +
    `  root:          ${f.manifest.rootHex}\n` +
    `  keygen:        ${f.manifest.keygenMs.toFixed(0)} ms\n` +
    `  quantum:       ${f.quantum.length} events (${f.quantum[0]?.type === 'entropyRequested' ? f.quantum[0].providerId : '?'})\n` +
    `  total:         ${((performance.now() - t0) / 1000).toFixed(1)} s`,
);
