/**
 * Example inputs for stories. Nothing here is a real on-chain value and every
 * story labels it "example input". The hash is computed, not typed in, so
 * it is at least a real SHA-256 of a known string.
 */

const SUBTLE_CRYPTO = typeof crypto !== 'undefined' ? crypto.subtle : undefined;

/** SHA-256 of the UTF-8 string "qsd", hex-encoded. Computed in the browser. */
export async function sha256Hex(input: string): Promise<string> {
  if (!SUBTLE_CRYPTO) throw new Error('WebCrypto unavailable in this environment');
  const buf = await SUBTLE_CRYPTO.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const EXAMPLE_INPUT = 'qsd';
export const EXAMPLE_LABEL = 'example input — SHA-256("qsd"), not a live value';
