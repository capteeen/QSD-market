/**
 * Small byte helpers. Everything is Uint8Array so the package runs unchanged in
 * the browser and in Node.
 */

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += (bytes[i]! >>> 4).toString(16) + (bytes[i]! & 0x0f).toString(16);
  }
  return s;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("hex string must have even length");
  if (!/^[0-9a-fA-F]*$/.test(hex)) throw new Error("invalid hex string");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** RFC 8391 toByte(x, y): y-byte big-endian encoding of the non-negative integer x. */
export function toByte(x: number, y: number): Uint8Array {
  if (!Number.isSafeInteger(x) || x < 0) throw new Error("toByte: x must be a non-negative safe integer");
  const out = new Uint8Array(y);
  let v = x;
  for (let i = y - 1; i >= 0; i--) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  if (v !== 0) throw new Error("toByte: value does not fit");
  return out;
}

/** Constant-time equality for equal-length byte strings. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function copy(a: Uint8Array): Uint8Array {
  return new Uint8Array(a);
}

export function xorInto(out: Uint8Array, a: Uint8Array, b: Uint8Array, outOff: number, n: number): void {
  for (let i = 0; i < n; i++) out[outOff + i] = a[i]! ^ b[i]!;
}
