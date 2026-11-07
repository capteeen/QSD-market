import { describe, expect, it } from 'vitest';
import { decodeCryptoEvents, encodeCryptoEvents, encodedEventCount, iterateCryptoEvents } from '../src/model/index.js';
import { loadFixture } from './fixtures/generate.js';

describe('crypto event codec', () => {
  it('round-trips the recorded stream losslessly', async () => {
    const f = await loadFixture();
    const bin = encodeCryptoEvents(f.crypto);
    expect(encodedEventCount(bin)).toBe(f.crypto.length);
    const back = decodeCryptoEvents(bin);
    expect(back).toHaveLength(f.crypto.length);
    // deep-equal on a sample across all event types, plus full count equality by type
    const byType = (es: typeof back): Record<string, number> =>
      es.reduce<Record<string, number>>((m, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {});
    expect(byType(back)).toEqual(byType(f.crypto));
    for (const i of [0, 1, 1000, 123456, f.crypto.length - 80, f.crypto.length - 1]) {
      expect(back[i]).toEqual(f.crypto[i]);
    }
    let n = 0;
    for (const _e of iterateCryptoEvents(bin)) n++;
    expect(n).toBe(f.crypto.length);
  });

  it('rejects garbage', () => {
    expect(() => decodeCryptoEvents(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]))).toThrow(/magic/);
  });
});
