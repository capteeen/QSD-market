/**
 * WOTS+ (RFC 8391 section 3), n = 32, w = 16, len = 67.
 *
 * Private key derivation follows the RFC-era reference implementation and
 * Bouncy Castle (which published the known-answer vectors we test against):
 *   S_ots   = PRF(SK_SEED, ADRS{type = OTS, ots = leaf})   (one n-byte seed per leaf)
 *   sk[i]   = PRF(S_ots, toByte(i, 32))                     (RFC 8391 section 3.1.7)
 * Everything on the public side (chain, base_w, checksum) is exactly
 * Algorithms 1-6 of the RFC.
 */
import { Address, ADRS_TYPE_OTS } from "./address.js";
import { toByte } from "./bytes.js";
import type { CryptoObserver } from "./events.js";
import { prf, thashF } from "./hash.js";
import { LEN, LEN_1, LEN_2, LOG_W, N, W } from "./params.js";

/** Per-leaf WOTS+ secret seed S_ots (RFC-era reference / Bouncy Castle derivation). */
export function wotsSecretSeed(skSeed: Uint8Array, leaf: number): Uint8Array {
  const adrs = new Address().setType(ADRS_TYPE_OTS).setOTS(leaf);
  return prf(skSeed, adrs.bytes);
}

/** Expand S_ots into the 67 secret chain start values sk[i] = PRF(S_ots, toByte(i, 32)). */
export function wotsExpandSecretKey(sOts: Uint8Array): Uint8Array[] {
  const sk: Uint8Array[] = new Array(LEN);
  for (let i = 0; i < LEN; i++) sk[i] = prf(sOts, toByte(i, 32));
  return sk;
}

/** base_w (RFC 8391 Algorithm 1) for w = 16: split bytes into nibbles, MSB first. */
export function baseW(input: Uint8Array, outLen: number): number[] {
  const out: number[] = new Array(outLen);
  let inIdx = 0;
  let total = 0;
  let bits = 0;
  for (let consumed = 0; consumed < outLen; consumed++) {
    if (bits === 0) {
      total = input[inIdx++]!;
      bits = 8;
    }
    bits -= LOG_W;
    out[consumed] = (total >>> bits) & (W - 1);
  }
  return out;
}

/** Message digits (64) followed by checksum digits (3): the 67 chain stop depths. */
export function chainLengths(msg: Uint8Array): number[] {
  if (msg.length !== N) throw new Error("WOTS+: message must be n bytes");
  const digits = baseW(msg, LEN_1);
  let csum = 0;
  for (let i = 0; i < LEN_1; i++) csum += W - 1 - digits[i]!;
  // len_2 * log_w = 12 bits; left-align in 2 bytes.
  csum <<= 8 - ((LEN_2 * LOG_W) % 8);
  const csumBytes = toByte(csum, Math.ceil((LEN_2 * LOG_W) / 8));
  return digits.concat(baseW(csumBytes, LEN_2));
}

export interface ChainHooks {
  /** Called with the value at each depth, from `start` (the input, inclusive) to `start + steps`. */
  onStep?: (depth: number, value: Uint8Array) => void;
}

/**
 * chain(X, i, s, SEED, ADRS) (RFC 8391 Algorithm 2): apply the keyed, masked
 * F to X `steps` times, starting at hash address `start`.
 * `adrs` must already have the chain address set; its hash address is updated here.
 */
export function chain(
  x: Uint8Array,
  start: number,
  steps: number,
  seed: Uint8Array,
  adrs: Address,
  hooks?: ChainHooks,
): Uint8Array {
  if (start + steps > W - 1) throw new Error("WOTS+: chain would exceed w - 1");
  let tmp = x;
  hooks?.onStep?.(start, tmp);
  for (let i = start; i < start + steps; i++) {
    adrs.setHash(i);
    tmp = thashF(tmp, seed, adrs);
    hooks?.onStep?.(i + 1, tmp);
  }
  return tmp;
}

/** Build an OTS address for a leaf (layer 0, tree 0). */
export function otsAddress(leaf: number): Address {
  return new Address().setType(ADRS_TYPE_OTS).setOTS(leaf);
}

/**
 * WOTS_genPK (Algorithm 4): run every chain to its tip. Emits chainStep /
 * chainComplete events through `observer` if given.
 */
export function wotsPublicKey(
  sk: Uint8Array[],
  seed: Uint8Array,
  leaf: number,
  observer?: CryptoObserver,
): Uint8Array[] {
  const pk: Uint8Array[] = new Array(LEN);
  const adrs = otsAddress(leaf);
  for (let i = 0; i < LEN; i++) {
    adrs.setChain(i);
    const hooks: ChainHooks | undefined = observer
      ? {
          onStep: (depth, value) => observer.emit({ type: "chainStep", leaf, chainIdx: i, depth, hash: value }),
        }
      : undefined;
    pk[i] = chain(sk[i]!, 0, W - 1, seed, adrs, hooks);
    observer?.emit({ type: "chainComplete", leaf, chainIdx: i, hash: pk[i]! });
  }
  return pk;
}

/** WOTS_sign (Algorithm 5). Emits signChainStop events. */
export function wotsSign(
  sk: Uint8Array[],
  msg: Uint8Array,
  seed: Uint8Array,
  leaf: number,
  observer?: CryptoObserver,
): Uint8Array[] {
  const lengths = chainLengths(msg);
  const sig: Uint8Array[] = new Array(LEN);
  const adrs = otsAddress(leaf);
  for (let i = 0; i < LEN; i++) {
    adrs.setChain(i);
    sig[i] = chain(sk[i]!, 0, lengths[i]!, seed, adrs);
    observer?.emit({ type: "signChainStop", chainIdx: i, depth: lengths[i]!, hash: sig[i]! });
  }
  return sig;
}

/** WOTS_pkFromSig (Algorithm 6). Emits verifyChainStep events. */
export function wotsPublicKeyFromSignature(
  sig: Uint8Array[],
  msg: Uint8Array,
  seed: Uint8Array,
  leaf: number,
  observer?: CryptoObserver,
): Uint8Array[] {
  const lengths = chainLengths(msg);
  const pk: Uint8Array[] = new Array(LEN);
  const adrs = otsAddress(leaf);
  for (let i = 0; i < LEN; i++) {
    adrs.setChain(i);
    const hooks: ChainHooks | undefined = observer
      ? {
          onStep: (depth, value) => {
            if (depth > lengths[i]!) observer.emit({ type: "verifyChainStep", chainIdx: i, depth, hash: value });
          },
        }
      : undefined;
    pk[i] = chain(sig[i]!, lengths[i]!, W - 1 - lengths[i]!, seed, adrs, hooks);
  }
  return pk;
}
