# @qsd/crypto

Hash-based launch identities for qsd.market: **WOTS+** one-time signatures
(RFC 8391 §3, SHA-256, w = 16) bound into a **height-8 Merkle tree** (256
one-time keys) with the **XMSS** construction of RFC 8391 §4. The Merkle root
is the identity. Every hash the package computes can be observed, in order,
with its real value, so the scene package renders real operations and nothing
else.

Browser and Node, `Uint8Array` only, no Node-specific APIs in the core.
Hashing is `@noble/hashes` (audited, pure JS).

```ts
import { createIdentity, sign, verify, recordEvents, MemoryStateStore, Signer } from "@qsd/crypto";

const rec = recordEvents();                                   // optional observer
const identity = createIdentity(seed32Bytes, { observer: rec.observer });
identity.rootHex;                                             // the identity
identity.publicKey;                                           // { root, pubSeed } — what verifiers need

let state = identity.initialState();                          // serialisable, no secrets
const r = sign(identity, state, message);                     // uses the lowest unused key
state = r.state;                                              // ALWAYS keep the returned state
verify(identity.publicKey, message, r.signature);             // true, needs no secret

// persistent, race-safe path (what the app should use):
const signer = new Signer(identity, new MemoryStateStore());  // /packages/solana supplies the durable store
await signer.sign(message);
```

---

## 1. The math in plain language

### Hash chains (WOTS+)

A one-time key is 67 secret 32-byte values. From each secret you walk a
**chain**: hash it, hash the result, and so on, 15 times. The 67 end points
(chain tips) are the public key. Each hash step is not a bare SHA-256 but the
keyed, masked step of RFC 8391:

```
KEY = PRF(SEED, ADRS·keyAndMask=0)
BM  = PRF(SEED, ADRS·keyAndMask=1)
next = F(KEY, current XOR BM)
```

`ADRS` is a 32-byte address that names *exactly which* link of which chain of
which leaf is being computed, so no two hash calls in the whole identity are
ever the same function. `SEED` is public (it is part of the public key).

To **sign** a 32-byte digest, split it into 64 hex digits (base-16, "base_w").
For digit `d` in chain `i`, reveal the value that sits `d` steps along chain
`i`. A verifier walks the remaining `15 − d` steps and must land on the public
chain tip. Because a forger could walk *forward* (hash more) but never
backward, they could only change digits upward; the 3 extra **checksum
chains** encode `Σ(15 − d)`, which would have to go *down* at the same time.
That is why there are 64 + 3 = 67 chains.

Revealing a chain value is irreversible: it is the secret for every digit at
or above it. That is why each one-time key must be used **once**.

### Leaves (L-tree)

The 67 chain tips are compressed into one 32-byte **leaf** by pairing them up
with `RAND_HASH` (a keyed, masked two-input hash) until one value is left
(RFC 8391 Algorithm 8).

### Merkle tree and identity

256 leaves are paired with `RAND_HASH` level by level: 256 → 128 → 64 → 32 →
16 → 8 → 4 → 2 → 1. The last value is the **root** — the identity. A
signature carries the 8 sibling hashes on the way from its leaf to the root
(the **authentication path**), so a verifier can rebuild the root from the
signature alone and compare it to the identity.

### Randomised message hash

The signed digest is `H_msg(r ‖ root ‖ toByte(idx,32), M)` where
`r = PRF(SK_PRF, toByte(idx,32))`; `r` is included in the signature. This is
the RFC 8391 §4.1.9 construction.

### Keys from a seed

`createIdentity(seed)` runs HKDF-SHA256 over the seed (salt
`"qsd.market/identity/v1"`) to derive three 32-byte values:

| name | secret? | role |
| --- | --- | --- |
| `SK_SEED` | yes | seeds every one-time secret: `S_ots = PRF(SK_SEED, ADRS·ots=i)`, `sk[j] = PRF(S_ots, toByte(j,32))` |
| `SK_PRF` | yes | keys the per-signature randomiser `r` |
| `SEED` (`pubSeed`) | no | keys and bitmasks of every F / H step; part of the public key |

The seed is never stored on the `Identity`, never logged, never put in an
event or error. `Identity` keeps its secrets in `#private` fields so
`JSON.stringify`/`console.log` show only `{ root, pubSeed, height }`.

### The public key is root **and** pubSeed

Verification needs `SEED`, so `IdentityPublicKey = { root, pubSeed }`
(64 bytes encoded: `root ‖ pubSeed`). Store both on-chain. `verify()` accepts
`{ root, pubSeed }`, the 64-byte encoding, or an `IdentityState` (which carries
both as hex). The **identity** displayed to users is the root alone.

---

## 2. Exact sizes

| item | bytes |
| --- | --- |
| hash / chain value / node | 32 |
| WOTS+ signature (67 × 32) | 2144 |
| authentication path (8 × 32) | 256 |
| **signature** = index (4) + r (32) + 2144 + 256 | **2436** (`SIGNATURE_BYTES`) |
| public key (`root ‖ pubSeed`) | 64 (`PUBLIC_KEY_BYTES`) |
| `IdentityState.used` bitmap | 32 bytes (256 bits), hex in JSON |

Signature layout, from RFC 8391 §4.1.8: `toByte(idx, 4) ‖ r ‖ sig_ots[0..66] ‖ auth[0..7]`
(`auth[0]` is the leaf-level sibling).

---

## 3. Events — what the scene renders

Pass a `CryptoObserver` (or `recordEvents().observer`) as `observer` to
`createIdentity`, `sign`, `signWithIndex`, `Signer.sign`, `verify`. Listeners
run synchronously as each hash completes. Every event has a monotonic `seq`
(0, 1, 2, … per observer). Every hash value is the real output of the
operation described.

### Key generation (`createIdentity`) — 292 097 events

| event | fields | count | meaning |
| --- | --- | --- | --- |
| `keygenStart` | `leaves=256, chains=67, links=16` | 1 | what is about to happen |
| `chainStep` | `leaf, chainIdx (0..66), depth (0..15), hash` | 256 × 67 × 16 = 274 432 | the value at `depth` in that chain. **`depth 0` is the start value (the secret element), `depth 15` is the chain tip.** 16 events per chain = 16 blocks to render. 15 of them are preceded by a real F call; depth 0 is the PRF output the chain starts from. |
| `chainComplete` | `leaf, chainIdx, hash` | 256 × 67 = 17 152 | the chain tip (= `chainStep` depth 15) — a public key element |
| `leafFormed` | `leaf, hash` | 256 | the L-tree compressed the 67 tips of `leaf` into one node |
| `treeLevelFused` | `level, index, left, right, parent` | 255 (128+64+32+16+8+4+2+1) | `parent = RAND_HASH(left, right)`; `level` is the children's level (0 = leaves), `index` the parent's position in level+1 |
| `rootReady` | `root` | 1 | the identity; always the last keygen event |

Order: `keygenStart`, then for each leaf 0..255: for each chain 0..66 its 16
`chainStep`s then `chainComplete`, then `leafFormed`; then all
`treeLevelFused` by level ascending; then `rootReady`.

### Signing (`sign` / `signWithIndex`) — 77 events

| event | fields | count | meaning |
| --- | --- | --- | --- |
| `signStart` | `index, r, digest` | 1 | leaf consumed, randomiser, the digest the chains sign |
| `signChainStop` | `chainIdx, depth, hash` | 67 | light runs down chain `chainIdx` and stops at `depth` (= the base-16 digit); `hash` is that signature element |
| `authPathNode` | `level, hash` | 8 | the sibling node at `level` (0 = leaf level), in signature order |
| `signatureReady` | `index, bytes` | 1 | the full 2436-byte signature |

### Verifying (`verify`)

`verifyStart`, then `verifyChainStep (chainIdx, depth, hash)` for every step
from `depth+1` to 15 of every chain (count depends on the digits),
`verifyLeafFormed`, 8 × `verifyLevelFused`, then `verifyResult (computedRoot,
expectedRoot, valid)`.

### Event stream sensitivity — read this

Key-generation `chainStep` events at **depth 0..14 are secret key material**.
Anyone holding the value at depth `d` of chain `i` of leaf `k` can sign any
digest whose digit `i` is ≥ `d` with leaf `k`. The scene may render them
locally (the seed lives in the same browser), but a recorded key-generation
stream is as sensitive as the private key. To store or share a stream use
`recordEvents({ redact: true })` or `redactEvents(events)`: depth < 15 chain
values are replaced by `SHA-256(value)` (still a real, verifiable commitment);
everything else is public and left unchanged. Signing and verification
streams contain only public values.

### Replaying

`recordEvents()` returns `{ observer, events, stop }`. The `events` array is a
complete, ordered stream the scene can replay without recomputation; an
empty array must render nothing.

---

## 4. State and reuse

```ts
interface IdentityState {
  version: 1;
  root: string;      // hex
  pubSeed: string;   // hex
  nextIndex: number; // lowest never-used index (hint)
  used: string;      // hex bitmap, 256 bits; bit i set = key i dead forever
}
```

Two layers of memory keep a leaf from being used twice:

1. **The `IdentityState` you pass around** (serialisable, the thing a store
   persists).
2. **The `Identity` object's own private memory** of every index it has ever
   signed with, through any path, in this process. It is held in a
   module-private `WeakMap`, is not a property, and cannot be cleared.

Every signing call ORs the supplied state with that memory, refuses any index
set in the union, sets the bit **before** computing the signature, and returns
a state that reflects the union. A stale, rolled-back or JSON-edited state
therefore cannot reissue a key within a process; cross-process safety is the
`StateStore`'s job (below).

* `sign(identity, state, message)` → `{ signature, index, state }`. Uses the
  lowest index unused in *both* `state` and the identity's memory (so a stale
  state with cleared bits simply gets the next free key, never a used one).
  Passing the **same state object** to `sign()` twice asks for the same key
  twice and throws `KeyReuseError`. The input state is never mutated; always
  continue from the returned state.
* `signWithIndex(identity, state, index, message)` – explicit index; throws
  `KeyReuseError` if marked in `state` *or* remembered by the identity.
* `identity.usedIndices()` / `identity.memoryState()` – read the memory.
* `markUsed`, `isIndexUsed`, `mergeStates`, `remainingIndices`,
  `remainingCount`, `validateState` – pure helpers. `mergeStates` is a union:
  an index used in either input is used in the result; root **and** pubSeed
  must match. `validateState` checks that `root`, `pubSeed` and `used` are
  well-formed hex of the right length.
* `KeysExhaustedError` once all 256 are gone. The identity is then finished;
  make a new one.
* There is no method on `Identity` that produces a signature; the only
  signing path is module-internal and always goes through the memory check.

### `StateStore` and `Signer` (the mandatory path for anything persistent)

```ts
interface StateStore {
  get(rootHex): Promise<IdentityState | undefined>;
  put(rootHex, state, expected?: IdentityState | null): Promise<void>;
}
```

`put` with `expected` is a compare-and-swap: `null` = nothing may be stored
yet; a state = the stored `used` bitmap must still equal `expected.used`;
otherwise throw `StateConflictError` and write nothing. A store must never
clear a used bit (merge, don't overwrite). `MemoryStateStore` implements this
in memory; **`/packages/solana` supplies the persistent implementation**
(the per-coin identity reserve).

`new Signer(identity, store)`:

1. reads the latest state (merged with any caller-supplied, possibly restored
   state — rolling back a backup cannot resurrect an index the store knows),
2. reserves the index with a compare-and-swap `put` (retries on conflict),
3. only then computes and returns the signature.

The store is the Signer's authority: indices it issues are recorded in the
identity's memory (so the stateless API can never reissue them), but the
Signer does not consult that memory when choosing an index. Consequently
**one identity must be bound to exactly one store**; two Signers over two
different stores for the same identity *will* reuse keys (§7). The app's
identity reserve (`/packages/solana`) must guarantee the one-store rule.

Tests cover: double sign, sign after restoring an old state, concurrent
signers on one store, and rollback writes to the store.

---

## 5. Correctness: vectors matched

* **SHA-256**: FIPS 180-4 vectors (`""`, `"abc"`, two-block message).
* **XMSS-SHA2 / WOTS+ (RFC 8391)**: Bouncy Castle's published known-answer
  tests, `test/vectors/bc-xmss-sha256.json`, fetched from
  <https://github.com/bcgit/bc-java/blob/main/core/src/test/java/org/bouncycastle/pqc/crypto/test/XMSSTest.java>
  (all seeds = 32 zero bytes, message = 1024 zero bytes):
  * height 4: all 16 signatures reproduced bit-for-bit (2308 bytes each) and
    verified;
  * height 10 (XMSS-SHA2_10_256, the RFC's standard parameter set): public
    root `73c3fc6d…0de3`, signatures for indices 0, 1, 2 and ten scattered
    indices up to 1023 reproduced bit-for-bit (2500 bytes each), the published
    auth path for index 0 reproduced, every published signature verified.

  These vectors exercise every algorithm of the construction end to end: a
  single wrong byte in F, H, PRF, ADRS, base_w, the checksum, the L-tree, the
  tree addressing, `r`, `H_msg` or the encoding changes every signature.

RFC 8391 has no vectors of its own; the Bouncy Castle set is derived from the
RFC's reference implementation (`XMSS/xmss-reference`, pre-2018). One
implementation detail to know when cross-checking with other code:

* **WOTS+ secret derivation.** We use `S_ots = PRF(SK_SEED, ADRS{type=OTS,
  ots=i})` then `sk[j] = PRF(S_ots, toByte(j,32))`, exactly like Bouncy Castle
  and the RFC-era reference. RFC 8391 §4.1.11 *describes* (informatively)
  `S_ots = PRF(S, toByte(i,32))` instead, and the current `xmss-reference`
  master and NIST SP 800-208 use `PRF_keygen` (padding 4). Secret derivation
  does not affect interoperability — verification uses only public values —
  but a cross-check that regenerates *our* keys from *our* `SK_SEED` must use
  the same derivation. Verification of our signatures by any RFC 8391
  verifier (given `root`, `pubSeed`, height 8) is derivation-independent.
* Tree height 8 is not one of the RFC's registered OIDs (10/16/20); the
  algorithm is identical, only `h` differs, and the height-4 vectors show the
  code is height-generic.

---

## 6. Performance (Node 22, this container, single thread)

| operation | hashes | wall time |
| --- | --- | --- |
| `createIdentity` (256 leaves, height 8), no observer | ≈ 840 000 SHA-256 | **≈ 3.1–3.6 s** |
| same, with a recording observer (292 097 events) | | ≈ 3.1–3.6 s |
| `sign` | ≈ 67 × ≤15 × 3 | ≈ 5–10 ms |
| `verify` | | ≈ 5–10 ms |
| height-10 keygen (KAT only) | ≈ 3.4 M | ≈ 11 s |

This is above 3 s. The cost is intrinsic (256 × 67 × 15 keyed steps, three
SHA-256 each, ≈ 2 µs per SHA-256 in pure JS; Node's native SHA-256 is only
≈ 25 % faster). The scene should stream key generation — `xmssLeaf()` is
exported so a host can compute leaves incrementally and yield between them.
Workers are not used inside the package so it stays environment-agnostic.

---

## 7. Limits

* 256 signatures per identity, ever. No multi-tree (XMSS^MT), no key
  rollover. The product must create a new identity when the tree is spent.
* State is the only reuse defence: if two copies of an identity sign from
  separate stores, they *will* reuse keys. One identity ↔ one `StateStore`.
* Secret material (`SK_SEED`, `SK_PRF`, the tree) lives in memory in the
  `Identity` object; the package does no encryption at rest — that belongs
  to `/packages/solana` (keys encrypted at rest, per spec §9).
* Keygen is synchronous; `createIdentity` blocks for ≈ 3 s. Use `xmssLeaf` +
  `buildHashTree` or a worker to keep a UI responsive.
* No side-channel hardening beyond constant-time comparison of the root.
* Not an XMSS OID-registered parameter set (height 8).

---

## 8. API surface

Identity: `createIdentity`, `Identity` (`root`, `rootHex`, `publicKey`,
`height`, `leaves`, `keygenMs`, `initialState()`, `node(level, index)`),
`sign`, `signWithIndex`, `verify`, `signatureIndex`, `encodePublicKey`,
`decodePublicKey`, `publicKeysEqual`.

State: `IdentityState`, `validateState`, `isIndexUsed`, `markUsed`,
`mergeStates`, `remainingIndices`, `remainingCount`, `StateStore`,
`MemoryStateStore`, `Signer`, `StateConflictError`.

Errors: `KeyReuseError` (`.index`, `.rootHex`), `KeysExhaustedError`,
`CryptoInputError`, `NotImplementedError`.

Events: `CryptoObserver` (`subscribe(listener) => unsubscribe`, `seq`),
`CryptoEvent` (discriminated union), `recordEvents`, `redactEvents`,
`redactEvent`, `describeEvent`.

Constants: `N`, `W`, `LEN`, `LEN_1`, `LEN_2`, `CHAIN_LINKS` (16),
`CHAIN_STEPS` (15), `TREE_HEIGHT` (8), `LEAVES` (256), `INDEX_BYTES`,
`WOTS_SIG_BYTES`, `SIGNATURE_BYTES` (2436), `PUBLIC_KEY_BYTES` (64),
`signatureBytesForHeight`.

Building blocks (for Agent H and the scene): `deriveKeyMaterial`, `Address`,
`sha256`, `F`, `H`, `hMsg`, `prf`, `randHash`, `thashF`, `baseW`,
`chainLengths`, `chain`, `wotsSecretSeed`, `wotsExpandSecretKey`,
`wotsPublicKey`, `wotsSign`, `wotsPublicKeyFromSignature`, `ltree`,
`buildHashTree`, `authPath`, `rootFromAuthPath`, `hashTreeAddress`,
`xmssKeyGen`, `xmssLeaf`, `xmssSign`, `xmssVerify`, `xmssRootFromSig`,
`messageDigest`, `encodeSignature`, `decodeSignature`, `toHex`, `fromHex`,
`concat`, `toByte`, `equalBytes`.

Scripts: `pnpm --filter @qsd/crypto test` (vitest, ≈ 25 s because of the
height-10 KAT), `typecheck`, `build` (tsc → `dist/`).
