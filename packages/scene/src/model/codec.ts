/**
 * Compact binary codec for recorded @qsd/crypto event streams.
 *
 * A full key generation is 292 097 events; as JSON that is ~40 MB, encoded
 * here it is ~11.5 MB (a chainStep is 1 + 4 + 1 + 1 + 1 + 32 = 40 bytes).
 * Used by the test fixture generator, the perf page (fetches the .bin and
 * replays it) and as the transfer format from a keygen Worker to the main
 * thread (`postMessage` of one ArrayBuffer per batch instead of thousands of
 * objects).
 *
 * The codec is lossless for every CryptoEvent type. It does NOT redact: call
 * `redactEvents` from @qsd/crypto before encoding a keygen stream you intend
 * to store or share.
 */
import type { CryptoEvent } from '@qsd/crypto';
import { HASH_BYTES } from './types.js';

const T = {
  keygenStart: 1,
  chainStep: 2,
  chainComplete: 3,
  leafFormed: 4,
  treeLevelFused: 5,
  rootReady: 6,
  signStart: 7,
  signChainStop: 8,
  authPathNode: 9,
  signatureReady: 10,
  verifyStart: 11,
  verifyChainStep: 12,
  verifyLeafFormed: 13,
  verifyLevelFused: 14,
  verifyResult: 15,
} as const;

const MAGIC = 0x51534431; // 'QSD1'

function sizeOf(e: CryptoEvent): number {
  const H = HASH_BYTES;
  switch (e.type) {
    case 'keygenStart':
      return 1 + 4 + 2 + 1 + 1;
    case 'chainStep':
      return 1 + 4 + 1 + 1 + 1 + H;
    case 'chainComplete':
      return 1 + 4 + 1 + 1 + H;
    case 'leafFormed':
      return 1 + 4 + 1 + H;
    case 'treeLevelFused':
      return 1 + 4 + 1 + 1 + 3 * H;
    case 'rootReady':
      return 1 + 4 + H;
    case 'signStart':
      return 1 + 4 + 2 + 2 * H;
    case 'signChainStop':
      return 1 + 4 + 1 + 1 + H;
    case 'authPathNode':
      return 1 + 4 + 1 + H;
    case 'signatureReady':
      return 1 + 4 + 2 + 4 + e.bytes.length;
    case 'verifyStart':
      return 1 + 4 + 2 + H;
    case 'verifyChainStep':
      return 1 + 4 + 1 + 1 + H;
    case 'verifyLeafFormed':
      return 1 + 4 + 2 + H;
    case 'verifyLevelFused':
      return 1 + 4 + 1 + 3 * H;
    case 'verifyResult':
      return 1 + 4 + 2 * H + 1;
  }
}

class Writer {
  readonly buf: Uint8Array;
  readonly view: DataView;
  pos = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }
  u8(v: number): void {
    this.buf[this.pos++] = v;
  }
  u16(v: number): void {
    this.view.setUint16(this.pos, v);
    this.pos += 2;
  }
  u32(v: number): void {
    this.view.setUint32(this.pos, v);
    this.pos += 4;
  }
  bytes(b: Uint8Array): void {
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
  hash(b: Uint8Array): void {
    if (b.length !== HASH_BYTES) throw new Error(`codec: expected ${HASH_BYTES}-byte hash, got ${b.length}`);
    this.bytes(b);
  }
}

export function encodeCryptoEvents(events: readonly CryptoEvent[]): Uint8Array {
  let size = 8;
  for (const e of events) size += sizeOf(e);
  const w = new Writer(size);
  w.u32(MAGIC);
  w.u32(events.length);
  for (const e of events) {
    w.u8(T[e.type]);
    w.u32(e.seq);
    switch (e.type) {
      case 'keygenStart':
        w.u16(e.leaves);
        w.u8(e.chains);
        w.u8(e.links);
        break;
      case 'chainStep':
        w.u8(e.leaf);
        w.u8(e.chainIdx);
        w.u8(e.depth);
        w.hash(e.hash);
        break;
      case 'chainComplete':
        w.u8(e.leaf);
        w.u8(e.chainIdx);
        w.hash(e.hash);
        break;
      case 'leafFormed':
        w.u8(e.leaf);
        w.hash(e.hash);
        break;
      case 'treeLevelFused':
        w.u8(e.level);
        w.u8(e.index);
        w.hash(e.left);
        w.hash(e.right);
        w.hash(e.parent);
        break;
      case 'rootReady':
        w.hash(e.root);
        break;
      case 'signStart':
        w.u16(e.index);
        w.hash(e.r);
        w.hash(e.digest);
        break;
      case 'signChainStop':
        w.u8(e.chainIdx);
        w.u8(e.depth);
        w.hash(e.hash);
        break;
      case 'authPathNode':
        w.u8(e.level);
        w.hash(e.hash);
        break;
      case 'signatureReady':
        w.u16(e.index);
        w.u32(e.bytes.length);
        w.bytes(e.bytes);
        break;
      case 'verifyStart':
        w.u16(e.index);
        w.hash(e.digest);
        break;
      case 'verifyChainStep':
        w.u8(e.chainIdx);
        w.u8(e.depth);
        w.hash(e.hash);
        break;
      case 'verifyLeafFormed':
        w.u16(e.index);
        w.hash(e.hash);
        break;
      case 'verifyLevelFused':
        w.u8(e.level);
        w.hash(e.left);
        w.hash(e.right);
        w.hash(e.parent);
        break;
      case 'verifyResult':
        w.hash(e.computedRoot);
        w.hash(e.expectedRoot);
        w.u8(e.valid ? 1 : 0);
        break;
    }
  }
  return w.buf;
}

/** Decode a stream encoded by `encodeCryptoEvents`. Hash values are copies (not views). */
export function decodeCryptoEvents(data: Uint8Array): CryptoEvent[] {
  return Array.from(iterateCryptoEvents(data));
}

/** Lazy decoder: yields one event at a time without materialising the whole array. */
export function* iterateCryptoEvents(data: Uint8Array): Generator<CryptoEvent, void, undefined> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  const u8 = (): number => data[pos++] as number;
  const u16 = (): number => {
    const v = view.getUint16(pos);
    pos += 2;
    return v;
  };
  const u32 = (): number => {
    const v = view.getUint32(pos);
    pos += 4;
    return v;
  };
  const bytes = (n: number): Uint8Array => {
    const b = data.slice(pos, pos + n);
    pos += n;
    return b;
  };
  const hash = (): Uint8Array => bytes(HASH_BYTES);

  if (u32() !== MAGIC) throw new Error('codec: bad magic');
  const n = u32();
  for (let i = 0; i < n; i++) {
    const t = u8();
    const seq = u32();
    switch (t) {
      case T.keygenStart:
        yield { type: 'keygenStart', seq, leaves: u16(), chains: u8(), links: u8() };
        break;
      case T.chainStep:
        yield { type: 'chainStep', seq, leaf: u8(), chainIdx: u8(), depth: u8(), hash: hash() };
        break;
      case T.chainComplete:
        yield { type: 'chainComplete', seq, leaf: u8(), chainIdx: u8(), hash: hash() };
        break;
      case T.leafFormed:
        yield { type: 'leafFormed', seq, leaf: u8(), hash: hash() };
        break;
      case T.treeLevelFused:
        yield { type: 'treeLevelFused', seq, level: u8(), index: u8(), left: hash(), right: hash(), parent: hash() };
        break;
      case T.rootReady:
        yield { type: 'rootReady', seq, root: hash() };
        break;
      case T.signStart:
        yield { type: 'signStart', seq, index: u16(), r: hash(), digest: hash() };
        break;
      case T.signChainStop:
        yield { type: 'signChainStop', seq, chainIdx: u8(), depth: u8(), hash: hash() };
        break;
      case T.authPathNode:
        yield { type: 'authPathNode', seq, level: u8(), hash: hash() };
        break;
      case T.signatureReady: {
        const index = u16();
        const len = u32();
        yield { type: 'signatureReady', seq, index, bytes: bytes(len) };
        break;
      }
      case T.verifyStart:
        yield { type: 'verifyStart', seq, index: u16(), digest: hash() };
        break;
      case T.verifyChainStep:
        yield { type: 'verifyChainStep', seq, chainIdx: u8(), depth: u8(), hash: hash() };
        break;
      case T.verifyLeafFormed:
        yield { type: 'verifyLeafFormed', seq, index: u16(), hash: hash() };
        break;
      case T.verifyLevelFused:
        yield { type: 'verifyLevelFused', seq, level: u8(), left: hash(), right: hash(), parent: hash() };
        break;
      case T.verifyResult:
        yield { type: 'verifyResult', seq, computedRoot: hash(), expectedRoot: hash(), valid: u8() === 1 };
        break;
      default:
        throw new Error(`codec: unknown event tag ${t} at ${pos - 5}`);
    }
  }
}

/** Number of events in an encoded stream without decoding it. */
export function encodedEventCount(data: Uint8Array): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0) !== MAGIC) throw new Error('codec: bad magic');
  return view.getUint32(4);
}
