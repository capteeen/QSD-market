/**
 * Observable progress events. Every event is produced by a real hash
 * operation and carries the real value that operation produced. The scene
 * package subscribes to these so that every visual maps to a real computation.
 *
 * `seq` is a monotonically increasing number assigned by the observer that
 * dispatched the event (0, 1, 2, …). Events from one operation are totally
 * ordered by `seq`.
 */
import { sha256 } from "@noble/hashes/sha256";
import { toHex } from "./bytes.js";

export type CryptoEvent =
  | {
      type: "keygenStart";
      seq: number;
      /** Number of one-time keys (leaves) that will be generated. */
      leaves: number;
      /** Chains per leaf (67). */
      chains: number;
      /** Positions per chain (16). */
      links: number;
    }
  | {
      type: "chainStep";
      seq: number;
      /** Leaf (one-time key) index 0..leaves-1. */
      leaf: number;
      /** Chain index 0..66. */
      chainIdx: number;
      /** Position in the chain 0..15. Depth 0 is the start value (the secret element); depth 15 is the chain tip. */
      depth: number;
      /** The value at this depth. SECRET for depth < 15 — see README "Event stream sensitivity". */
      hash: Uint8Array;
    }
  | {
      type: "chainComplete";
      seq: number;
      leaf: number;
      chainIdx: number;
      /** The chain tip = this chain's WOTS+ public key element (public). */
      hash: Uint8Array;
    }
  | {
      type: "leafFormed";
      seq: number;
      leaf: number;
      /** L-tree compression of the 67 chain tips (public). */
      hash: Uint8Array;
    }
  | {
      type: "treeLevelFused";
      seq: number;
      /** Height of the two children being fused (0 = leaves). The parent sits at level + 1. */
      level: number;
      /** Index of the parent node within level + 1. */
      index: number;
      left: Uint8Array;
      right: Uint8Array;
      parent: Uint8Array;
    }
  | {
      type: "rootReady";
      seq: number;
      root: Uint8Array;
    }
  | {
      type: "signStart";
      seq: number;
      /** One-time key index being consumed. */
      index: number;
      /** Randomizer r = PRF(SK_PRF, toByte(index, 32)) (public, part of the signature). */
      r: Uint8Array;
      /** The randomized message digest H_msg(r || root || toByte(index, 32), M) that the WOTS+ chains sign. */
      digest: Uint8Array;
    }
  | {
      type: "signChainStop";
      seq: number;
      chainIdx: number;
      /** Depth at which the chain stops = the base-w digit (0..15) being signed. */
      depth: number;
      /** The chain value at that depth = this signature element (public). */
      hash: Uint8Array;
    }
  | {
      type: "authPathNode";
      seq: number;
      /** Tree level of the sibling node, 0 = leaf level. */
      level: number;
      hash: Uint8Array;
    }
  | {
      type: "signatureReady";
      seq: number;
      index: number;
      /** The full encoded signature (SIGNATURE_BYTES bytes). */
      bytes: Uint8Array;
    }
  | {
      type: "verifyStart";
      seq: number;
      index: number;
      digest: Uint8Array;
    }
  | {
      type: "verifyChainStep";
      seq: number;
      chainIdx: number;
      /** Depth after this step (signature depth + 1 … 15). */
      depth: number;
      hash: Uint8Array;
    }
  | {
      type: "verifyLeafFormed";
      seq: number;
      index: number;
      hash: Uint8Array;
    }
  | {
      type: "verifyLevelFused";
      seq: number;
      level: number;
      left: Uint8Array;
      right: Uint8Array;
      parent: Uint8Array;
    }
  | {
      type: "verifyResult";
      seq: number;
      /** Root recomputed from the signature. */
      computedRoot: Uint8Array;
      expectedRoot: Uint8Array;
      valid: boolean;
    };

export type CryptoEventType = CryptoEvent["type"];

/** An event without its `seq`; the observer assigns the sequence number. */
export type CryptoEventInput = CryptoEvent extends infer E ? (E extends { seq: number } ? Omit<E, "seq"> : never) : never;

export type CryptoListener = (event: CryptoEvent) => void;

/**
 * A tiny typed event emitter. `subscribe` returns an unsubscribe function.
 * Listeners are invoked synchronously, in subscription order, as each hash
 * operation completes.
 */
export class CryptoObserver {
  private listeners: CryptoListener[] = [];
  private nextSeq = 0;

  subscribe(listener: CryptoListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Number of events emitted so far. */
  get seq(): number {
    return this.nextSeq;
  }

  get hasListeners(): boolean {
    return this.listeners.length > 0;
  }

  /** @internal Emit an event; assigns the next sequence number. */
  emit(event: CryptoEventInput): void {
    const full = { ...event, seq: this.nextSeq++ } as CryptoEvent;
    for (const l of this.listeners.slice()) l(full);
  }
}

export interface Recording {
  observer: CryptoObserver;
  /** All events received so far, in order. */
  events: CryptoEvent[];
  /** Stop recording. */
  stop: () => void;
}

/**
 * Create an observer that collects every event into `events`. Use the returned
 * `observer` as the `observer` option of createIdentity / sign / verify.
 *
 * With `redact: true` the recorded stream has secret chain values replaced by
 * their SHA-256 commitments (see `redactEvents`), so it can be stored or shared.
 */
export function recordEvents(opts: { observer?: CryptoObserver; redact?: boolean } = {}): Recording {
  const observer = opts.observer ?? new CryptoObserver();
  const events: CryptoEvent[] = [];
  const stop = observer.subscribe((e) => {
    events.push(opts.redact ? redactEvent(e) : e);
  });
  return { observer, events, stop };
}

/** Redacted secret marker: chainStep hashes with depth < 15 become SHA-256(value). */
export function redactEvent(e: CryptoEvent): CryptoEvent {
  if (e.type === "chainStep" && e.depth < 15) {
    return { ...e, hash: sha256(e.hash) };
  }
  return e;
}

/**
 * Replace every secret value in a key-generation event stream with its SHA-256
 * commitment. Key-generation `chainStep` events at depth 0..14 are one-time
 * secret key material (anyone holding them could forge a signature with that
 * leaf); all other events carry only public values.
 */
export function redactEvents(events: readonly CryptoEvent[]): CryptoEvent[] {
  return events.map(redactEvent);
}

/** Pretty-print an event for logs. Never prints seeds; chain secrets are shown truncated. */
export function describeEvent(e: CryptoEvent): string {
  const h = (b: Uint8Array) => toHex(b).slice(0, 16) + "…";
  switch (e.type) {
    case "keygenStart":
      return `#${e.seq} keygenStart leaves=${e.leaves} chains=${e.chains} links=${e.links}`;
    case "chainStep":
      return `#${e.seq} chainStep leaf=${e.leaf} chain=${e.chainIdx} depth=${e.depth} ${h(e.hash)}`;
    case "chainComplete":
      return `#${e.seq} chainComplete leaf=${e.leaf} chain=${e.chainIdx} ${h(e.hash)}`;
    case "leafFormed":
      return `#${e.seq} leafFormed leaf=${e.leaf} ${h(e.hash)}`;
    case "treeLevelFused":
      return `#${e.seq} treeLevelFused level=${e.level} index=${e.index} ${h(e.left)}+${h(e.right)}=>${h(e.parent)}`;
    case "rootReady":
      return `#${e.seq} rootReady ${toHex(e.root)}`;
    case "signStart":
      return `#${e.seq} signStart index=${e.index} r=${h(e.r)} digest=${h(e.digest)}`;
    case "signChainStop":
      return `#${e.seq} signChainStop chain=${e.chainIdx} depth=${e.depth} ${h(e.hash)}`;
    case "authPathNode":
      return `#${e.seq} authPathNode level=${e.level} ${h(e.hash)}`;
    case "signatureReady":
      return `#${e.seq} signatureReady index=${e.index} bytes=${e.bytes.length}`;
    case "verifyStart":
      return `#${e.seq} verifyStart index=${e.index} digest=${h(e.digest)}`;
    case "verifyChainStep":
      return `#${e.seq} verifyChainStep chain=${e.chainIdx} depth=${e.depth} ${h(e.hash)}`;
    case "verifyLeafFormed":
      return `#${e.seq} verifyLeafFormed index=${e.index} ${h(e.hash)}`;
    case "verifyLevelFused":
      return `#${e.seq} verifyLevelFused level=${e.level} => ${h(e.parent)}`;
    case "verifyResult":
      return `#${e.seq} verifyResult valid=${e.valid} computed=${h(e.computedRoot)} expected=${h(e.expectedRoot)}`;
  }
}
