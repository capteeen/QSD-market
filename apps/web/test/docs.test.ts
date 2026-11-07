import { describe, expect, it } from 'vitest';
import { findDocsDir, readDocs } from '@/server/docs';

describe('docs resolution', () => {
  it('finds /docs walking up from apps/web and reads both files verbatim', async () => {
    const dir = await findDocsDir(process.cwd());
    expect(dir.endsWith('docs')).toBe(true);
    const d = await readDocs();
    expect(d.physics.startsWith('# The physics behind INFINITWAP')).toBe(true);
    expect(d.economics.startsWith('# How INFINITWAP works')).toBe(true);
    expect(d.source.physics).toBe('docs/physics.md');
    expect(d.source.economics).toBe('docs/economics.md');
  });
});
