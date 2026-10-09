/**
 * RFC 8391 section 2.5 hash function address scheme (ADRS).
 *
 * ADRS is 32 bytes made of eight 32-bit big-endian words:
 *   word 0: layer address
 *   word 1-2: tree address (64-bit)
 *   word 3: type (0 = OTS, 1 = L-tree, 2 = hash tree)
 *   word 4: OTS address / L-tree address / padding
 *   word 5: chain address / tree height
 *   word 6: hash address / tree index
 *   word 7: keyAndMask
 */

export const ADRS_TYPE_OTS = 0;
export const ADRS_TYPE_LTREE = 1;
export const ADRS_TYPE_HASHTREE = 2;

export class Address {
  readonly bytes = new Uint8Array(32);

  private setWord(i: number, v: number): void {
    const o = i * 4;
    this.bytes[o] = (v >>> 24) & 0xff;
    this.bytes[o + 1] = (v >>> 16) & 0xff;
    this.bytes[o + 2] = (v >>> 8) & 0xff;
    this.bytes[o + 3] = v & 0xff;
  }

  setLayer(v: number): this {
    this.setWord(0, v);
    return this;
  }
  setTree(v: number): this {
    // 64-bit tree address; QSD only ever uses the single tree 0.
    this.setWord(1, Math.floor(v / 2 ** 32));
    this.setWord(2, v >>> 0);
    return this;
  }
  /** Setting the type also zeroes words 4..7, as RFC 8391 requires. */
  setType(v: number): this {
    this.setWord(3, v);
    this.setWord(4, 0);
    this.setWord(5, 0);
    this.setWord(6, 0);
    this.setWord(7, 0);
    return this;
  }
  setOTS(v: number): this {
    this.setWord(4, v);
    return this;
  }
  setLTree(v: number): this {
    this.setWord(4, v);
    return this;
  }
  setChain(v: number): this {
    this.setWord(5, v);
    return this;
  }
  setTreeHeight(v: number): this {
    this.setWord(5, v);
    return this;
  }
  setHash(v: number): this {
    this.setWord(6, v);
    return this;
  }
  setTreeIndex(v: number): this {
    this.setWord(6, v);
    return this;
  }
  setKeyAndMask(v: number): this {
    this.setWord(7, v);
    return this;
  }

  clone(): Address {
    const a = new Address();
    a.bytes.set(this.bytes);
    return a;
  }
}
