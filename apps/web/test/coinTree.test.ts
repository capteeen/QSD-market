import { describe, expect, it } from 'vitest';
import { coinTree } from '@/lib/coin';

const c = (ca: string, motherCa: string | null, bornAt: number) => ({ ca, motherCa, bornAt });

describe('coinTree', () => {
  it('puts every daughter under its mother, newest mother first, daughters in birth order', () => {
    const rows = coinTree([c('a', null, 10), c('b', null, 20), c('a1', 'a', 11), c('a2', 'a', 12), c('a1x', 'a1', 13)], (x, y) => y.bornAt - x.bornAt);
    expect(rows.map((r) => `${r.coin.ca}@${r.depth}${r.last ? '$' : ''}`)).toEqual(['b@0$', 'a@0$', 'a1@1', 'a1x@2$', 'a2@1$']);
  });
  it('lists a daughter whose mother is absent at the root, and never repeats a coin', () => {
    const rows = coinTree([c('d', 'gone', 5), c('d', 'gone', 5)], (x, y) => y.bornAt - x.bornAt);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.depth).toBe(0);
  });
});
