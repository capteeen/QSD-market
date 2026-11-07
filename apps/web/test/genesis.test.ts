// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('server-only', () => ({}));

const example = path.join(__dirname, '..', 'genesis.example.json');

describe('QSD_GENESIS_CONFIG', () => {
  beforeEach(() => vi.resetModules());

  it('accepts the JSON inline (Vercel) or a file path, with the same result', async () => {
    process.env.QSD_GENESIS_CONFIG = example;
    const fromFile = (await import('@/server/genesis')).genesisStatus();
    vi.resetModules();
    process.env.QSD_GENESIS_CONFIG = JSON.stringify(JSON.parse(readFileSync(example, 'utf8')));
    const inline = (await import('@/server/genesis')).genesisStatus();
    expect(inline.error).toBeUndefined();
    expect(inline.config).toEqual(fromFile.config);
    expect(inline.config!.poolUnits).toEqual({ min: 3_000_000_000_000n, max: 3_400_000_000_000n });
  });

  it('reports bad inline JSON instead of defaulting', async () => {
    process.env.QSD_GENESIS_CONFIG = '{not json';
    expect((await import('@/server/genesis')).genesisStatus().error).toMatch(/could not be loaded/);
  });
});
