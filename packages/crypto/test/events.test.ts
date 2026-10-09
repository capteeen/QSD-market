/**
 * Event ordering and counts. The scene renders exactly what these events say.
 */
import { describe, expect, it } from "vitest";
import {
  CHAIN_LINKS,
  CryptoObserver,
  LEAVES,
  LEN,
  SIGNATURE_BYTES,
  TREE_HEIGHT,
  createIdentity,
  describeEvent,
  randHash,
  recordEvents,
  redactEvents,
  hashTreeAddress,
  sha256,
  sign,
  signWithIndex,
  toHex,
  verify,
  type CryptoEvent,
} from "../src/index.js";

const seed = new Uint8Array(32).fill(3);

function count(events: CryptoEvent[], type: CryptoEvent["type"]): number {
  return events.filter((e) => e.type === type).length;
}

describe("key generation events", () => {
  const rec = recordEvents();
  const identity = createIdentity(seed, { observer: rec.observer });
  rec.stop();
  const ev = rec.events;

  it("seq is strictly increasing from 0 with no gaps", () => {
    ev.forEach((e, i) => expect(e.seq).toBe(i));
  });

  it("starts with keygenStart announcing 256 leaves x 67 chains x 16 links", () => {
    expect(ev[0]).toMatchObject({ type: "keygenStart", leaves: 256, chains: 67, links: 16 });
  });

  it("emits exactly 67 x 16 chainStep per leaf, depth 0..15, for all 256 leaves", () => {
    expect(count(ev, "chainStep")).toBe(LEAVES * LEN * CHAIN_LINKS);
    const perLeaf = new Map<number, Map<number, number[]>>();
    for (const e of ev) {
      if (e.type !== "chainStep") continue;
      let chains = perLeaf.get(e.leaf);
      if (!chains) perLeaf.set(e.leaf, (chains = new Map()));
      let depths = chains.get(e.chainIdx);
      if (!depths) chains.set(e.chainIdx, (depths = []));
      depths.push(e.depth);
      expect(e.hash.length).toBe(32);
    }
    expect(perLeaf.size).toBe(LEAVES);
    for (const chains of perLeaf.values()) {
      expect(chains.size).toBe(LEN);
      for (const depths of chains.values()) expect(depths).toEqual([...Array(16).keys()]);
    }
  });

  it("chainComplete carries the depth-15 value and follows the chain's steps", () => {
    let lastStep: CryptoEvent | undefined;
    let completes = 0;
    for (const e of ev) {
      if (e.type === "chainStep") lastStep = e;
      if (e.type === "chainComplete") {
        completes++;
        expect(lastStep?.type).toBe("chainStep");
        if (lastStep?.type === "chainStep") {
          expect(lastStep.depth).toBe(15);
          expect(lastStep.leaf).toBe(e.leaf);
          expect(lastStep.chainIdx).toBe(e.chainIdx);
          expect(toHex(lastStep.hash)).toBe(toHex(e.hash));
        }
      }
    }
    expect(completes).toBe(LEAVES * LEN);
  });

  it("emits 256 leafFormed, 255 treeLevelFused and exactly one rootReady, in that order", () => {
    expect(count(ev, "leafFormed")).toBe(256);
    expect(count(ev, "treeLevelFused")).toBe(255);
    expect(count(ev, "rootReady")).toBe(1);
    const lastLeaf = ev.map((e) => e.type).lastIndexOf("leafFormed");
    const firstFuse = ev.findIndex((e) => e.type === "treeLevelFused");
    const root = ev.findIndex((e) => e.type === "rootReady");
    expect(lastLeaf).toBeLessThan(firstFuse);
    expect(root).toBe(ev.length - 1);
    const levels = ev.filter((e) => e.type === "treeLevelFused").map((e) => (e.type === "treeLevelFused" ? e.level : -1));
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]!);
    const perLevel = [128, 64, 32, 16, 8, 4, 2, 1];
    perLevel.forEach((n, l) => expect(levels.filter((x) => x === l)).toHaveLength(n));
  });

  it("every treeLevelFused is a real RAND_HASH of its children and the last parent is the root", () => {
    const fused = ev.filter((e): e is Extract<CryptoEvent, { type: "treeLevelFused" }> => e.type === "treeLevelFused");
    const rootEv = ev.find((e): e is Extract<CryptoEvent, { type: "rootReady" }> => e.type === "rootReady")!;
    for (const f of fused) {
      const recomputed = randHash(f.left, f.right, identity.publicKey.pubSeed, hashTreeAddress(f.level, f.index));
      expect(toHex(recomputed)).toBe(toHex(f.parent));
    }
    expect(toHex(fused[fused.length - 1]!.parent)).toBe(toHex(rootEv.root));
    expect(toHex(rootEv.root)).toBe(identity.rootHex);
    // level-0 fuses consume the leafFormed values in order
    const leaves = ev.filter((e): e is Extract<CryptoEvent, { type: "leafFormed" }> => e.type === "leafFormed");
    const level0 = fused.filter((f) => f.level === 0);
    level0.forEach((f, i) => {
      expect(toHex(f.left)).toBe(toHex(leaves[2 * i]!.hash));
      expect(toHex(f.right)).toBe(toHex(leaves[2 * i + 1]!.hash));
    });
  });

  it("total event count is fixed", () => {
    expect(ev.length).toBe(1 + LEAVES * LEN * CHAIN_LINKS + LEAVES * LEN + LEAVES + (LEAVES - 1) + 1);
  });

  it("redactEvents replaces only depth < 15 chain values with commitments", () => {
    const red = redactEvents(ev);
    expect(red.length).toBe(ev.length);
    for (let i = 0; i < ev.length; i++) {
      const a = ev[i]!;
      const b = red[i]!;
      if (a.type === "chainStep" && b.type === "chainStep") {
        if (a.depth < 15) expect(toHex(b.hash)).toBe(toHex(sha256(a.hash)));
        else expect(toHex(b.hash)).toBe(toHex(a.hash));
      } else {
        expect(b).toBe(a);
      }
    }
  });

  it("describeEvent never throws for any event type", () => {
    for (const e of ev.slice(0, 100)) expect(typeof describeEvent(e)).toBe("string");
  });
});

describe("signing and verifying events", () => {
  const identity = createIdentity(seed);
  const message = new TextEncoder().encode("hello");

  it("emits signStart, 67 signChainStop, 8 authPathNode, 1 signatureReady, in order", () => {
    const rec = recordEvents();
    const { signature, index } = sign(identity, identity.initialState(), message, { observer: rec.observer });
    const ev = rec.events;
    ev.forEach((e, i) => expect(e.seq).toBe(i));
    expect(ev[0]).toMatchObject({ type: "signStart", index });
    expect(count(ev, "signChainStop")).toBe(67);
    expect(count(ev, "authPathNode")).toBe(TREE_HEIGHT);
    expect(count(ev, "signatureReady")).toBe(1);
    expect(ev.length).toBe(1 + 67 + 8 + 1);
    const types = ev.map((e) => e.type);
    expect(types.lastIndexOf("signChainStop")).toBeLessThan(types.indexOf("authPathNode"));
    expect(types.lastIndexOf("authPathNode")).toBeLessThan(types.indexOf("signatureReady"));
    const ready = ev[ev.length - 1]!;
    expect(ready.type).toBe("signatureReady");
    if (ready.type === "signatureReady") {
      expect(ready.bytes.length).toBe(SIGNATURE_BYTES);
      expect(toHex(ready.bytes)).toBe(toHex(signature));
    }
  });

  it("signChainStop depths are in 0..15, chains are 0..66 in order, and hashes are the signature elements", () => {
    const rec = recordEvents();
    const { signature } = sign(identity, identity.initialState(), message, { observer: rec.observer });
    const stops = rec.events.filter(
      (e): e is Extract<CryptoEvent, { type: "signChainStop" }> => e.type === "signChainStop",
    );
    stops.forEach((s, i) => {
      expect(s.chainIdx).toBe(i);
      expect(s.depth).toBeGreaterThanOrEqual(0);
      expect(s.depth).toBeLessThanOrEqual(15);
      expect(toHex(s.hash)).toBe(toHex(signature.slice(36 + i * 32, 36 + (i + 1) * 32)));
    });
    // checksum: sum of (15 - digit) over the 64 message digits equals the 3 checksum digits in base 16
    const csum = stops.slice(0, 64).reduce((a, s) => a + 15 - s.depth, 0);
    const [c0, c1, c2] = stops.slice(64).map((s) => s.depth);
    expect(c0! * 256 + c1! * 16 + c2!).toBe(csum);
  });

  it("authPathNode hashes equal the identity's sibling nodes and the signature's auth path", () => {
    const rec = recordEvents();
    const { signature, index } = sign(identity, identity.initialState(), message, { observer: rec.observer });
    const nodes = rec.events.filter((e): e is Extract<CryptoEvent, { type: "authPathNode" }> => e.type === "authPathNode");
    nodes.forEach((n, level) => {
      expect(n.level).toBe(level);
      expect(toHex(n.hash)).toBe(toHex(identity.node(level, (index >>> level) ^ 1)));
      const off = 4 + 32 + 67 * 32 + level * 32;
      expect(toHex(n.hash)).toBe(toHex(signature.slice(off, off + 32)));
    });
  });

  it("verify emits chain steps up to depth 15, a leaf, 8 fuses and a result", () => {
    const { signature } = sign(identity, identity.initialState(), message);
    const rec = recordEvents();
    expect(verify(identity.publicKey, message, signature, { observer: rec.observer })).toBe(true);
    const ev = rec.events;
    expect(ev[0]?.type).toBe("verifyStart");
    expect(count(ev, "verifyLeafFormed")).toBe(1);
    expect(count(ev, "verifyLevelFused")).toBe(8);
    const last = ev[ev.length - 1]!;
    expect(last.type).toBe("verifyResult");
    if (last.type === "verifyResult") {
      expect(last.valid).toBe(true);
      expect(toHex(last.computedRoot)).toBe(identity.rootHex);
    }
    // each chain's verify steps end at depth 15
    const steps = ev.filter((e): e is Extract<CryptoEvent, { type: "verifyChainStep" }> => e.type === "verifyChainStep");
    const lastDepth = new Map<number, number>();
    for (const s of steps) lastDepth.set(s.chainIdx, s.depth);
    for (const d of lastDepth.values()) expect(d).toBe(15);
  });

  it("observer.subscribe returns a working unsubscribe", () => {
    const obs = new CryptoObserver();
    let n = 0;
    const off = obs.subscribe(() => n++);
    sign(identity, identity.initialState(), message, { observer: obs });
    const after = n;
    off();
    sign(identity, identity.initialState(), message, { observer: obs });
    expect(n).toBe(after);
    expect(obs.seq).toBe(2 * after);
  });

  it("an empty observer produces no events and does not change results", () => {
    const rec = recordEvents();
    rec.stop();
    const a = sign(identity, identity.initialState(), message, { observer: rec.observer });
    expect(rec.events).toHaveLength(0);
    // the same index on a twin identity (same seed), observed, gives the identical signature
    const twin = createIdentity(seed);
    const rec2 = recordEvents();
    const b = signWithIndex(twin, twin.initialState(), a.index, message, { observer: rec2.observer });
    expect(rec2.events.length).toBeGreaterThan(0);
    expect(toHex(a.signature)).toBe(toHex(b.signature));
  });
});
