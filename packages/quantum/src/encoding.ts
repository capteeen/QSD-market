import { sha256 as nobleSha256 } from '@noble/hashes/sha256';
import type { Hex, JsonValue } from './types.js';

const HEX_RE = /^[0-9a-f]*$/;

export function bytesToHex(bytes: Uint8Array): Hex {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !HEX_RE.test(hex)) {
    throw new TypeError('expected an even-length lowercase hex string');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function isHex(value: unknown): value is Hex {
  return typeof value === 'string' && value.length % 2 === 0 && HEX_RE.test(value);
}

const encoder = new TextEncoder();

export function utf8(s: string): Uint8Array {
  return encoder.encode(s);
}

export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

export function sha256Hex(data: Uint8Array): Hex {
  return bytesToHex(nobleSha256(data));
}

/** Big-endian 4-byte length prefix followed by the data; prevents ambiguity when concatenating. */
export function lengthPrefixed(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += 4 + p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out[o++] = (p.length >>> 24) & 0xff;
    out[o++] = (p.length >>> 16) & 0xff;
    out[o++] = (p.length >>> 8) & 0xff;
    out[o++] = p.length & 0xff;
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * Canonical JSON: object keys sorted lexicographically (by UTF-16 code unit),
 * no whitespace, arrays in order, numbers as JSON.stringify renders them.
 * Rejects non-JSON values (undefined, functions, bigint, NaN, Infinity,
 * Uint8Array) so that a bundle can never contain something that serialises
 * differently in two places.
 */
export function canonicalJson(value: unknown): string {
  return stringifyCanonical(value, '$');
}

function stringifyCanonical(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(`canonicalJson: non-finite number at ${path}`);
      }
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return '[' + value.map((v, i) => stringifyCanonical(v, `${path}[${i}]`)).join(',') + ']';
      }
      if (value instanceof Uint8Array) {
        throw new TypeError(`canonicalJson: raw bytes at ${path}; encode as hex first`);
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`canonicalJson: non-plain object at ${path}`);
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return (
        '{' +
        keys
          .map((k) => JSON.stringify(k) + ':' + stringifyCanonical(obj[k], `${path}.${k}`))
          .join(',') +
        '}'
      );
    }
    default:
      throw new TypeError(`canonicalJson: unsupported value of type ${typeof value} at ${path}`);
  }
}

/** sha256(canonical(value)) as hex. */
export function hashJson(value: JsonValue): Hex {
  return sha256Hex(utf8(canonicalJson(value)));
}

/** Current time as ISO-8601 with millisecond precision. */
export function nowIso(): string {
  return new Date().toISOString();
}

export function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}
