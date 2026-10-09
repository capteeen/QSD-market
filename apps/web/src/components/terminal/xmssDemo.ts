import {
  CryptoObserver,
  chainLengths,
  deriveKeyMaterial,
  encodeSignature,
  signatureBytesForHeight,
  xmssKeyGen,
  xmssSign,
  xmssVerify,
  W,
} from '@qsd/crypto';

/**
 * One real XMSS-SHA256 round trip, computed in the browser: a fresh random
 * seed, a height-`height` key tree, a signature over a random 32-byte message
 * at a random leaf, then the full verification. Everything the verify terminal
 * prints is read from the verifier's own events.
 */
export interface XmssDemoRun {
  height: number;
  leaves: number;
  index: number;
  message: Uint8Array;
  /** Depth the signer stopped each of the 67 chains at (the digest's base-16 digits plus checksum). */
  startDepths: number[];
  /** Each chain's tip as the verifier recomputed it (the claimed WOTS public key element). */
  tips: Uint8Array[];
  leaf: Uint8Array;
  /** Parent hash after each level of the climb from leaf to root. */
  climb: Uint8Array[];
  expectedRoot: Uint8Array;
  computedRoot: Uint8Array;
  valid: boolean;
  signatureBytes: number;
  /** Hashes the verifier computed (chain steps + l-tree + climb), counted from its events where it emits them. */
  verifyChainSteps: number;
  ms: number;
}

export function runXmssDemo(height = 3, rand: (n: number) => Uint8Array = randomBytes): XmssDemoRun {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const material = deriveKeyMaterial(rand(32));
  const kp = xmssKeyGen(material, height);
  const message = rand(32);
  const index = rand(1)[0]! % (1 << height);
  const signature = encodeSignature(xmssSign(material, kp, index, message));

  const obs = new CryptoObserver();
  let digest: Uint8Array | null = null;
  const lastStep = new Map<number, Uint8Array>();
  let leaf: Uint8Array | null = null;
  const climb: Uint8Array[] = [];
  let computedRoot: Uint8Array | null = null;
  let steps = 0;
  obs.subscribe((e) => {
    switch (e.type) {
      case 'verifyStart':
        digest = e.digest;
        break;
      case 'verifyChainStep':
        steps += 1;
        lastStep.set(e.chainIdx, e.hash);
        break;
      case 'verifyLeafFormed':
        leaf = e.hash;
        break;
      case 'verifyLevelFused':
        climb.push(e.parent);
        break;
      case 'verifyResult':
        computedRoot = e.computedRoot;
        break;
      default:
        break;
    }
  });
  const valid = xmssVerify(kp.root, kp.pubSeed, message, signature, height, obs);
  if (!digest || !leaf) throw new Error('verifier emitted no events');
  const startDepths = chainLengths(digest);
  // A chain the signer already ran to the top (depth 15) needs no verifier step; its tip is the signature value itself.
  const sigWots = (i: number) => signature.slice(4 + 32 + i * 32, 4 + 32 + (i + 1) * 32);
  const tips = startDepths.map((d, i) => (d >= W - 1 ? sigWots(i) : lastStep.get(i)!));
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    height,
    leaves: 1 << height,
    index,
    message,
    startDepths,
    tips,
    leaf,
    climb,
    expectedRoot: kp.root,
    computedRoot: computedRoot ?? (climb[climb.length - 1] as Uint8Array),
    valid,
    signatureBytes: signatureBytesForHeight(height),
    verifyChainSteps: steps,
    ms: t1 - t0,
  };
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}
