# @qsd/scene

The QSD launch sequence in glass and light: `<LaunchSequence />` plus three
reusable scenes (`<MeasurementScene />`, `<CollapseScene />`,
`<FieldScene />`). Three.js via react-three-fiber, drei, postprocessing.

**Core rule.** Every visual is driven by a real event from `@qsd/crypto`,
`@qsd/quantum` or the chain package. The component subscribes to their
observables and renders what arrives. If no event arrives, nothing moves.
There is no timeline-based animation: no `setTimeout`, no tween advances a
stage or spawns geometry.

```
pnpm --filter @qsd/scene test        # vitest: reducer, replay, codec, field, throughput, headless render
pnpm --filter @qsd/scene typecheck
pnpm --filter @qsd/scene fixtures    # records the real event-stream fixture (≈ 4 s, 11.7 MB, gitignored)
pnpm --filter @qsd/scene perf        # frame-time test, SwiftShader + 4× CPU throttle (lower bound)
PERF_GPU=1 pnpm --filter @qsd/scene perf   # the ≥ 55 fps median gate, on a real GPU
pnpm --filter @qsd/scene perf:dev    # open the perf page in a browser
```

---

## 1. Architecture: model / render split

```
src/model/     headless. No React, no three. Node-testable, Worker-safe.
  types.ts     SceneState, SceneEvent (CryptoEvent | QuantumEvent | ChainEvent |
               superposition | lineage | skipStage | reset), SuperpositionInput, LineageInput
  reducer.ts   sceneReducer(state, event) → state   ← the ONLY place stage and counts change
  store.ts     createSceneStore() (zustand vanilla), replayEvents(events)
  codec.ts     compact binary codec for recorded crypto streams (fixtures, Worker transfer)
  field.ts     vesselParams(coin) — pure, bounded mapping for the FieldScene
src/render/    R3F. Reads the store inside useFrame via getState(); no React render per event.
  LaunchSequence / MeasurementScene / CollapseScene / FieldScene
  ChainRing, MerkleTree, SuperpositionCloud, QuantumDraw, SignatureStructure, Anchor, Lineage,
  Chamber, CoinSphere, SeedStreams, Effects, CameraRig, SidePanel (HTML), quality.ts
src/sound/     synthesised Web Audio, off by default
```

Agent H can test the model without WebGL: `replayEvents(recordedStream)` returns
the final `SceneState`; `replayEvents([])` deep-equals `createInitialState()`.
`@react-three/test-renderer` renders the stage components without a GPU and
exposes the instanced meshes (see `test/render.test.tsx`).

### The reducer

`sceneReducer` is **O(1) per event**. Key generation is 274 432 `chainStep`
events (292 097 events in all) in ≈ 3.5 s; the reducer stores hashes in typed
arrays that are reused in place, allocates only a fresh top-level object and
the touched slice per event, and never scans. A `SceneState` is therefore a
view valid until the next event; `cloneSceneState()` takes an independent
snapshot. Measured: 2.1 M events/s pure, 1.4 M events/s inside the store with
a subscriber; the reducer is ≈ 7 % of the live keygen wall time
(`test/throughput.test.ts`, numbers printed on every run).

**Sequence discipline.** Each source (`crypto`, `quantum`, `chain`) has a
`seq` watermark. An event whose `seq` is not greater than the last accepted
one from that source is **rejected**: counted in `events.rejected`, reason in
`events.lastRejectedReason`, state otherwise untouched. Gaps are allowed
(other subscribers may exist). Events that begin a new operation
(`keygenStart`, `signStart`, `verifyStart`, `entropyRequested`,
`anchorSubmitted`) reset the watermark, because the app may use a fresh
observer per operation. Malformed events (index out of range, hash not 32
bytes, `anchored` without a signature) are rejected the same way.

**Stage progression** happens only here:

| enters | on |
| --- | --- |
| 2 KEY GENERATION | `keygenStart` (or the first `chainStep`) |
| 3 MERKLE | the 256th `leafFormed` (or the first `treeLevelFused`) |
| 4 SUPERPOSITION | `rootReady` **and** a `superposition` input — whichever comes second |
| 5 QUANTUM DRAW | `entropyRequested` |
| 6 SIGNING | `signStart` (or the first `signChainStop`) |
| 7 ANCHORING | `anchorSubmitted` or `anchored` |
| 8 LINEAGE | `anchored` **and** a `lineage` input — whichever comes second |

`skipStage` advances the label only (and records it in `state.skipped`); it
never fabricates a count, and events keep being counted after a skip. The
stage never goes backwards. `MeasurementScene` and `CollapseScene` start at
stage 5 / 4 through the same `skipStage`, so `skipped` is honest there too.

---

## 2. Event → visual mapping

Every row is a real event or input and exactly what it moves. Nothing in the
scene moves for any other reason except the ambient items in §3.

| event | from | what it moves |
| --- | --- | --- |
| `keygenStart{leaves,chains,links}` | crypto | stage → 2; the six seed streams appear |
| `chainStep{leaf,chainIdx,depth,hash}` | crypto | link `depth` of chain `chainIdx` lights (cyan) in the 67 × 16 ring; the newest link glows magenta-white; when `leaf` changes the ring starts again from dark; `hash` retained for hover; seed-stream brightness = grown links / 1072; coin brightness = keygen fraction; panel: leaf / chain / depth / hash / counts |
| `chainComplete{leaf,chainIdx}` | crypto | chains-complete counters (panel) |
| `leafFormed{leaf,hash}` | crypto | leaf `leaf` rises into the leaf ring of the tree (instance scale 0 → 1); 256th → stage 3; `hash` retained |
| `treeLevelFused{level,index,parent}` | crypto | fused node (`level`, `index`) appears at its parent position, lit; `fusedPerLevel[level]++`; `parent` retained; coin brightness = fused fraction |
| `rootReady{root}` | crypto | root sphere glows white; root hash in the panel; stage → 4 if ranges are present |
| `superposition{supplyMin,supplyMax,halfLifeSec,decayChannels}` | protocol (input) | the cloud: radius ∝ width = (max − min)/max; breathing amplitude = width; supply band thickness = width; half-life ring period = clamp(4·log10(halfLifeSec+1), 2, 40) s; one ghost path per channel, length and opacity = probability, labelled with the real percentage; panel rows |
| `entropyRequested{providerId,nBytes}` | quantum | stage → 5; the chamber dims; a beam leaves the vessel; cloud contracts to 0.8; proof badge → pending |
| `entropyArrived{bytes,attestation}` | quantum | one photon per byte enters the vessel, positioned by the byte's value (angle = byte/255·2π); cloud contracts to 0.55 and flickers; panel shows the raw hex, attestation kind, timestamps, key and signature at that exact moment |
| `commitmentComputed{hash}` | quantum | beam withdrawn; cloud 0.4; commitment hash in the panel |
| `outcomeResolved{value,label}` | quantum | the cloud collapses to a point; a flash and an expanding ring are triggered by the increment of `resolvedCount`; the coin sphere is replaced by the collapsed point (magenta on a collapse label, white otherwise); outcome in the panel; the collapse tone (sound) |
| `signStart{index,r,digest}` | crypto | stage → 6; signature slice reset; digest in the panel |
| `signChainStop{chainIdx,depth,hash}` | crypto | light runs down chain `chainIdx` from the tip and stops at `depth`; the block at `depth` glows active and lifts out to slot `chainIdx` of the signature helix; `hash` retained for hover |
| `authPathNode{level,hash}` | crypto | the sibling node at `level` of the signed leaf — `(index >> level) ^ 1`, what a verifier combines with — glows active; the path nodes `(index >> level)` are lit |
| `signatureReady{bytes}` | crypto | the signature structure glows white; size in bytes in the panel (2436) |
| `anchorSubmitted{txSignature?}` | chain | stage → 7; the signed state compacts into a bright packet at the lane top; the lane lights |
| `anchored{txSignature,slot?}` | chain | the packet travels down the lane and lands in the block; the lid closes and the core glows; the real tx signature beside the block and in the panel; stage → 8 if lineage is present |
| `lineage{ca,generation,mother?}` | app (input) | stage → 8 (with `anchored`): camera zooms out; the coin's node is labelled; if a mother exists, her node appears coloured by her real final state, labelled with the selected channel and measurements survived, and a line of light connects her to the coin |
| `skipStage` | user | the stage label (and camera pose) only |
| `verify*` | crypto | nothing (accepted for seq consistency) |

**Eased transitions.** When an event sets a new target (a node's position,
the packet's destination, the sweep's stop depth, the cloud's contraction) the
renderer eases toward it over a few hundred ms. The *target* is always the
event's data; easing is presentation. A transition cannot start without its
event and has nowhere to go without the event's values.

---

## 3. Ambient motion — what encodes no data

Listed exhaustively; everything else is in §2.

| item | motion | note |
| --- | --- | --- |
| chamber rings | three tori rotating at constant rates | stage 1 "suspended in void" |
| coin sphere, stage 1 only | ±6 % scale pulse | "not yet real"; from stage 2 its brightness is data |
| cloud breathing | sinusoidal in time | **amplitude = real superposition width**: a coin with no uncertainty does not breathe |
| supply band | slow rotation | its *thickness* is data |
| half-life ring | rotation | its *period* is data |
| lineage entanglement ring | slow rotation | |
| field vessel drift | vertical sinusoid | **amplitude = `drift`** from `vesselParams`: traded coins sit still |
| camera | eases to the pose of the current stage | pose is a function of `stage` |
| shader warm-up | 14 zero-scale sample objects drawn for one frame after first paint, then hidden | compiles/links every material variant so stage transitions do not stall; invisible, carries no state (§8.2) |

---

## 4. Hover hash policy

Hashes retained in state (all real, all from events):

| set | count | bytes |
| --- | --- | --- |
| every link of the **leaf in view** (the leaf of the latest `chainStep`) | 67 × 16 | 34 304 |
| the 256 leaf hashes (`leafFormed`) | 256 | 8 192 |
| the 255 fused parents (`treeLevelFused`) | 255 | 8 160 |
| the 67 signature elements (`signChainStop`) | 67 | 2 144 |
| the 8 auth-path siblings (`authPathNode`) | 8 | 256 |
| root, digest, randomiser, entropy, commitment | | |

Links of leaves no longer in view are **not** retained (hover shows "not
retained"). Memory is constant: ≈ 53 KB regardless of how many events arrive.
Hovering a block publishes `{chainIdx, depth}` and the panel shows the hash
via `HashDisplay` (full, copyable); a block that has not been computed shows
the unavailable state.

**Secret material.** Key-generation `chainStep` hashes at depth 0–14 are
one-time secret key material (see the `@qsd/crypto` README). The scene renders
them locally — the seed lives in the same browser — and **never sends them
anywhere**: no network code exists in this package, the store is in-memory
only, and nothing is written to storage. A recorded keygen stream is as
sensitive as the private key; the test fixture is recorded with
`recordEvents({ redact: true })` from a throwaway public seed.

---

## 5. Public API

```ts
import {
  LaunchSequence, MeasurementScene, CollapseScene, FieldScene,
  sceneReducer, createSceneStore, replayEvents, createInitialState, cloneSceneState,
  encodeCryptoEvents, decodeCryptoEvents, vesselParams, vesselPosition,
  createQualityController, createSoundEngine,
} from '@qsd/scene';
import type { SceneState, SceneEvent, SuperpositionInput, LineageInput, ChainEvent, ChainObserver, FieldCoin } from '@qsd/scene';
```

```tsx
<LaunchSequence
  sources={{
    crypto: cryptoObserver,            // CryptoObserver from @qsd/crypto (one observer for keygen + sign)
    quantum: quantumBus,               // QuantumEventBus from @qsd/quantum
    chain: chainObserver,              // { subscribe(listener) } emitting anchorSubmitted / anchored
    superposition: { supplyMin, supplyMax, halfLifeSec, decayChannels },   // from the protocol Coin
    lineage: { ca, generation, mother? },
  }}
  onStageChange={(stage, state) => …}
  onComplete={(state) => …}            // once, on reaching stage 8
  quality="auto"                       // or 'ultra' | 'high' | 'medium' | 'low'
  sound={false}
/>
<MeasurementScene sources={{ quantum, superposition? }} />
<CollapseScene sources={{ quantum, superposition, chain?, lineage? }} daughter={{ superposition?, projectedAllocation? }} />
<FieldScene coins={FieldCoin[]} liveMeasurements={observable<{ ca, at }>} />
```

`vesselParams(coin)` → `{ spread, brightness, drift, density, tint, settled }`,
every field used by the vessel: `spread` = cloud radius, `brightness` =
emissive level, `drift` = the only ambient amplitude, `density` (0.1..1,
from the coin's activity) scales the state tint (a sparse cloud is a dimmer
cloud), `tint` = state colour, `settled` = no cloud at all.

* `SuperpositionInput { supplyMin: bigint; supplyMax: bigint; halfLifeSec: number; decayChannels: { id, probability /* ppm */, label }[] }` — defined here so the scene does not depend on the protocol package's timing; the app maps `Coin` to it.
* `ChainEvent = { type:'anchorSubmitted'; seq; txSignature? } | { type:'anchored'; seq; txSignature; slot? }` — the chain package emits these through any `{ subscribe }`.
* `FieldCoin { ca; uncertainty 0..1; activity 0..1; decayProgress 0..1; state }` — computed by the app from live data; `coins=[]` renders an empty chamber with an `EmptyState`.
* All scenes accept `store` (inject a store, e.g. fed from a Worker), `qualityController`, `onFrame(dt)`, `panel`, `className`, `style`.
* Model: `sceneReducer`, `createSceneStore({ startStage? })` → `{ dispatch, dispatchMany, connect(observable), reset, getState, subscribe }`, `replayEvents(events, store?)`, selectors `chainLinkHash`, `leafHash`, `fusedHash`, `stopHash`, `authHash`, `keygenProgress`, `merkleProgress`.
* Codec: `encodeCryptoEvents` / `decodeCryptoEvents` / `iterateCryptoEvents` — 40 bytes per `chainStep`; use it to post keygen batches from a Worker as one `ArrayBuffer`.

### Side panel

HTML overlay (not in-canvas) built from `@qsd/ui-tokens` `Panel`, `DataRow`,
`HashDisplay`, `ProofBadge`: stage; hover hash; leaf / chain / depth / hash and
the three keygen counters; fused level, fused pairs, root; supply min / max,
width, half-life, every channel's percentage; provider, timestamps, byte
count, full entropy hex, attestation kind, keys and signature, the draw
binding (`inputsHash`, `nonce`) when the attestation carries it, commitment,
outcome; one-time key index, digest, stops, auth nodes, signature size; tx
signature, status, slot; lineage. Values that have not arrived render the
component's unavailable state — never a placeholder. Counter denominators
("links grown n / N", chains, leaves, fused pairs, chain stops, auth path
nodes) come from `keygenStart` via `announcedTotals(state)`; before it
arrives they read `0 / 0` — zero of zero announced — never the construction's
constants (the Merkle panel title "tree of height 8" is the one constant on
display). `links grown` counts distinct links: a re-delivered `chainStep`
(same leaf / chain / depth) is accepted (`keygen.chainSteps`, and counted in
`keygen.duplicateSteps`) but lights nothing and grows nothing. A half-life
that is not a finite positive number is stored as `0` and the row renders
unavailable (the ring does not turn). The proof badge is
`pending` until arrival, `unverified` for a witness/provider attestation
("verify the proof bundle" — the scene does not verify), `invalid` for
`UNSAFE_DEV_RANDOM`.

### Sound (off by default)

`sound` prop or the panel toggle. Synthesised with Web Audio, no files: a
55 Hz detuned-saw hum through a low-pass (ambient); a sine harmonic whose
pitch tracks real progress (keygen fraction in stage 2, fused fraction in
stage 3, stops/67 in stage 6) and is silent otherwise; one soft 880 → 440 Hz
tone when `draw.resolvedCount` increments, i.e. on the real `outcomeResolved`.

---

## 6. Materials and effects

Pure geometry and light: no textures, no skybox, no environment map.
`MeshPhysicalMaterial` with `transmission: 1`, `thickness`, `ior 1.45`,
`iridescence: 1`, `iridescenceIOR 1.3`, `iridescenceThicknessRange [100, 400]`
(three's built-in thin-film). Rim light: directional, probability green
`#5FBF6A`. Computation light: amber `#F2C46D` → white point light at the
centre, on while hashes arrive. Per-instance emission through a shader patch
(`aLit` attribute: 0 dark glass, 1 lit green, 2 active amber-white). `GOLD`
(`#F0A845`) and `ICE` (`#5B9BD5`) are exported from `materials.ts` for chamber
light and cool accents. The constants are still named `CYAN` and `MAGENTA`
for history; they resolve to the current tokens — one
material, one draw call per instanced mesh. Post: `Bloom` (threshold 0.55,
intensity 0.85), `DepthOfField` focused at the centre (periphery only),
`Vignette` (faint, radial).

Lights-only transmission has no environment to refract, so the glass reads
as refraction of the lit geometry behind it (the chains, the tree, the cloud)
— which is the point.

---

## 7. Quality ladder

`createQualityController({ mode: 'auto', targetFps: 55 })` samples frame time
every frame (via `CameraRig`), takes the median over windows of **1.5 s of
wall time** (at least 4 frames; `window: n` switches to a fixed frame count
for deterministic tests), and steps down one level when the median is below
target, back up after six comfortable windows. Time-based windows matter on
exactly the device the ladder exists for: at 5 fps, ultra → low takes ≈ 5 s,
not 270 frames (54 s). **Only post-processing and resolution degrade; geometry
counts never do**: every level draws the same 1072 links, 256 leaves, 255
nodes and N vessels.

| level | bloom | DOF | vignette | transmission | DPR cap |
| --- | --- | --- | --- | --- | --- |
| ultra | ✓ | ✓ | ✓ | ✓ | 2 |
| high | ✓ | – | ✓ | ✓ | 1.5 |
| medium | – | – | ✓ | ✓ | 1 |
| low | – | – | – | – (plain translucent glass) | 0.75 |

---

## 8. Performance — method and numbers

Two measurements, both reproducible with one command each.

### 8.1 Headless reducer throughput (`pnpm --filter @qsd/scene test`, `throughput.test.ts`)

Node 22, this container, single thread:

| measurement | result | gate |
| --- | --- | --- |
| pure reducer replaying the recorded 292 097-event keygen | 137 ms → **2.1 M events/s** | > 250 k events/s |
| live `createIdentity` with the store + a subscriber | wall 2 951 ms, reducer share 205 ms (**7 %**), 1.4 M events/s | reducer < 40 % of wall |
| per-event cost, 1st vs 200 000th chainStep | 1.3 µs vs 0.28 µs (JIT warm) | O(1) |

### 8.2 Frame-time test (`pnpm --filter @qsd/scene perf`, `scripts/perf.ts`)

Playwright drives the pre-installed Chromium at a 390 × 844 @2× phone
viewport with CDP `Emulation.setCPUThrottlingRate(4)`, loads `perf/main.tsx`,
which replays the **recorded real stream** (`test/fixtures/generated`,
`createIdentity` + `sign` redacted, plus a recorded `UNSAFE_DEV_RANDOM` draw)
through the full `<LaunchSequence />`: keygen paced at the recorded rate
(≈ 3.5 s), then superposition, draw, signing, anchor, lineage with short
dwells (≈ 25 s). Frame times are `requestAnimationFrame` deltas inside the
page (`onFrame`). **Every frame counts**: the median and p5 are taken over
all frames including stalls (a 9 s frame is a frame of the sequence, not an
outlier); stalls > 500 ms are listed separately with their phase (`stalls`,
`over500ms`, `worstMs`). The run fails if the final state does not reproduce
the full counts (274 432 / 256 / 255 / 67 / 8, stage 8) **and** the root the
recorded stream's `rootReady` carried. The GL renderer is labelled from the
page's `WEBGL_debug_renderer_info` string, never from the env flag; with
`PERF_GPU=1` on a machine that renders on software GL the gate is reported as
NOT RUN (exit 1). `PERF_GATE=<fps>` overrides the 55 fps gate (for
experiments only; the spec's gate is 55).

Measured in this container (no GPU; Chromium 141 via playwright-core,
ANGLE/Vulkan SwiftShader, CPU 4× throttled, 390 × 844 @1×; rAF tied to
presentation — `--disable-frame-rate-limit` is deliberately *not* used
because unthrottled rAF outruns software GL and reports fictitious frame
rates):

| profile | median fps | p5 fps | first frame | keygen phase | sequence | counts reproduced | stalls > 500 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `low` (no post, no transmission, dpr 0.75) | **14.8** | 4.5 | 1.50 s | 7.5 fps median | 34 s, stage 8 | yes | none |
| `medium` (transmission on, no post) | 3.3 | 1.0 | 1.58 s | 2.2 fps median | 63 s, stage 8 | yes | 46 (transmission pass) |
| `auto` (starts at ultra, @2×) | not re-measured after the time-based quality windows (§7) | | | | | | earlier run (before warm-up and the 1.5 s windows): > 10 min on software GL; the ladder now sheds bloom/DOF within ~5 s (`quality.test.ts`) |
| `low`, **empty stream** | 13.7 | 8.2 | 1.48 s | — | stage 1 throughout, all counts 0 | n/a | none |

The reducer is not in the top 25 self-time functions of a CPU profile of the
run (`PERF_PROFILE=1`): time goes to three's renderer and SwiftShader's
rasterisation. The headless numbers in §8.1 are the honest statement of the
model's cost; the browser numbers above are a **lower bound** from a CPU
rasteriser four times slower than the container's CPU.

Shader warm-up: after the first frame, `Warmup` compiles every material
variant in a private scene (`compileAsync`) and draws each once at zero
scale, so stage transitions do not stall on program linking (before this,
stage 4's first frame stalled for the link of the cloud's programs — found
with `PERF_PROFILE=1`, which prints the top self-time functions).

**The ≥ 55 fps median gate is measured against a real GPU** with
`PERF_GPU=1 pnpm --filter @qsd/scene perf` (same throttle, same stream); the
script exits 1 if the median is below the gate. This container has no GPU, so
the SwiftShader number above is reported as a lower bound and is **not** a
claim that the gate passes. Do not read it as 55 fps; it was not measured.

Progressive load: the first frame draws the chamber only (stage 1); chain,
tree, cloud, draw, signature, anchor and lineage geometry mount when their
stage is entered. First-frame time is reported by the harness (`firstFrameMs`).

---

## 9. Tests

`pnpm --filter @qsd/scene test` (vitest, node environment; the fixture is
recorded on first run, ≈ 4 s):

* **reducer** — empty stream: deep-equal to the initial state, stage 1 after 1000 ticks; recorded stream: 67 × 16 links for every one of the 256 leaves, 256 leaves, 255 fuses `[128,64,32,16,8,4,2,1]`, root equal to the stream's `rootReady`, 67 stop depths equal to the `signChainStop` events, 8 auth nodes, 2436-byte signature, stages entered in order 2→3→4→5→6→7→8 with none skipped; hover hashes of the leaf in view / leaves / fused nodes equal the events'; stage-4 gating; `skipStage` advances the label only; out-of-order and malformed events rejected and flagged; per-source watermarks; fresh observer on `signStart`
* **codec** — lossless round trip of all 292 174 recorded events
* **field** — `vesselParams` pure and bounded for 13³ × 6 inputs incl. NaN/±∞; spec semantics; `vesselPosition` distinct and ≥ 1.5 apart for 300
* **throughput** — the numbers in §8.1, with gates
* **render (headless)** — `@react-three/test-renderer`: stage 2 mounts exactly one chain ring with `count === 1072`, 256 leaves, 255 fused, and the lit attribute has exactly 1072 lit entries for a fully grown leaf; empty stream: scene graph identical after 60 frames, no instanced mesh exists; stage 6: 1072 + 67; field: one vessel + one cloud per coin for 320 coins, none for an empty list

---

## 10. Limits

* `CollapseScene` decides "collapse vs survive" from the resolver's outcome label (`isCollapse`, default `/collapse/i`); pass the protocol's own predicate.
* Links of leaves other than the one in view are not retained (by design, §4).
* `@react-three/drei` `Html` labels (channel percentages, tx, lineage) need a DOM; the headless render test covers stages 2 and 6 and the field, not those labels.
* Sound requires a user gesture to start an `AudioContext`; the panel toggle provides it.
* No GPU in the build container: the real-GPU gate must be run on a machine with one.
