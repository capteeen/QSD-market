import { describe, expect, it } from 'vitest';
import { CryptoObserver, redactEvents, type CryptoEvent } from '@qsd/crypto';
import { decodeCryptoEvents, encodeCryptoEvents } from '@qsd/scene/model';
import { sha256 } from '@noble/hashes/sha256';

/** The launch stream encodes crypto events with the scene codec and the client decodes them; the round trip must be lossless. */
describe('SSE crypto codec round trip', () => {
  it('encode → base64 → decode reproduces real observer events exactly (redacted stream)', () => {
    const observer = new CryptoObserver();
    const events: CryptoEvent[] = [];
    observer.subscribe((e) => events.push(e));
    const h = (s: string) => sha256(new TextEncoder().encode(s));
    observer.emit({ type: 'keygenStart', leaves: 256, chains: 67, links: 16 });
    for (let d = 0; d < 16; d++) observer.emit({ type: 'chainStep', leaf: 3, chainIdx: 5, depth: d, hash: h(`c${d}`) });
    observer.emit({ type: 'chainComplete', leaf: 3, chainIdx: 5, hash: h('c15') });
    observer.emit({ type: 'leafFormed', leaf: 3, hash: h('leaf') });
    observer.emit({ type: 'treeLevelFused', level: 0, index: 1, left: h('l'), right: h('r'), parent: h('p') });
    observer.emit({ type: 'rootReady', root: h('root') });
    observer.emit({ type: 'signStart', index: 0, r: h('r'), digest: h('d') });
    observer.emit({ type: 'signChainStop', chainIdx: 1, depth: 7, hash: h('s') });
    observer.emit({ type: 'authPathNode', level: 2, hash: h('a') });
    observer.emit({ type: 'signatureReady', index: 0, bytes: new Uint8Array(2436).fill(7) });
    const redacted = redactEvents(events);
    const encoded = encodeCryptoEvents(redacted);
    const b64 = Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength).toString('base64');
    const back = decodeCryptoEvents(Uint8Array.from(Buffer.from(b64, 'base64')));
    expect(back.length).toBe(redacted.length);
    for (let i = 0; i < back.length; i++) {
      const norm = (e: CryptoEvent) => Object.fromEntries(Object.entries(e).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
      expect(norm(back[i]!)).toEqual(norm(redacted[i]!));
    }
    // depth < 15 chain values are commitments, the tip is the real value
    const step0 = back.find((e) => e.type === 'chainStep' && e.depth === 0) as Extract<CryptoEvent, { type: 'chainStep' }>;
    const step15 = back.find((e) => e.type === 'chainStep' && e.depth === 15) as Extract<CryptoEvent, { type: 'chainStep' }>;
    expect(Array.from(step0.hash)).toEqual(Array.from(sha256(h('c0'))));
    expect(Array.from(step15.hash)).toEqual(Array.from(h('c15')));
  });
});
