# Agent H (scene instance) — verification of `@qsd/scene`

Scope: SPEC §7 (VISUAL) and §10 scene items, against `/packages/scene` as found on
2026-10-09. The README was treated as a claim, not evidence. Everything below was
reproduced with Agent H's **own** recorded stream (`tests/scene/fixture.ts`:
different seed, message, inputs, and protocol-format outcome labels
`collapse:<channelId>`), never the package's fixture.

Run: `cd /home/claude/qsd/tests && npx vitest run scene`
Result: **61 tests, 52 pass, 9 fail — every failure is failing-by-design** and
tagged `[H-Sn]` in its name; each demonstrates one finding below.

Nothing in `/packages/scene` was edited. `tests/package.json` gained one line
(`"@qsd/scene": "workspace:*"`). `@react-three/test-renderer` and `three` are
reached via `tests/scene/deps.ts` through the scene package's own `node_modules`
links (same pnpm-store copies → one React instance).

Files: `fixture.ts` (generator), `deps.ts`, `replay.test.ts`, `stillness.test.ts`,
`partial-malformed.test.ts`, `render-headless.test.tsx`, `field.test.ts`,
`quality.test.ts`, `hygiene.test.ts`.

---

## 1. Findings table

| id | severity | where | SPEC line violated | repro test | status |
| --- | --- | --- | --- | --- | --- |
| H-S1 | **MEDIUM** | `src/model/reducer.ts:432-460` — `entropyArrived`, `commitmentComputed`, `outcomeResolved` all `withStage(…,5)`; `outcomeResolved` accepted in phase `idle` | §7 stage 5 "On entropyRequested a beam leaves… on entropyArrived raw photons enter… on outcomeResolved collapses… Raw entropy + attestation appear at that exact moment"; §2 "Every 3D visual maps to a real computed value". README §1 says stage 5 enters on `entropyRequested` only. A stray `outcomeResolved` sets `resolvedCount++` (the trigger of the flash, the collapsed point and the collapse tone) with `entropy === null`. | `partial-malformed.test.ts` › `[H-S1] outcomeResolved without entropyArrived…` and `[H-S1] entropyArrived / commitmentComputed alone must not enter stage 5` | OPEN |
| H-S2 | **MEDIUM** | `src/model/reducer.ts:304-307` (`depths[chainIdx]++` regardless of `event.depth`, hash stored at `event.depth`); `src/render/ChainRing.tsx:228` (`lit = d < grown`) | §7 stage 2 "each new block emitted by Agent A's chainStep event with its real hash shown on hover… Do not fake the count"; README §2 "link `depth` of chain `chainIdx` lights". A duplicated chainStep (fresh seq) lights a block never computed and hover on it returns 32 zero bytes as a hash; `chainStep{depth:15}` lights link 0. | `partial-malformed.test.ts` › `[H-S2] a duplicated chainStep with a fresh seq…` and `[H-S2] chainStep{depth:15} lights link 15, not link 0` | OPEN |
| H-S3 | **MEDIUM** | `src/model/reducer.ts:304` (`depths.fill(0)` on leaf change; `currentLeafHashes` not cleared) + `reducer.ts:527-533` (`chainLinkHash` gates on count, not arrival) | §7 "real hash shown on hover"; §2 "Nothing invented". Hover on leaf N serves leaf N-1's bytes labelled as leaf N. | `partial-malformed.test.ts` › `[H-S3] after a leaf change no stale hash…` | OPEN |
| H-S4 | LOW | `src/render/QuantumDraw.tsx:453` (`d.outcome?.label === 'collapse'`) vs `packages/protocol/src/resolver.ts:105-114` (`collapse:<channelId>`) and `CollapseScene.tsx:260` (`/collapse/i`) | §7 stage 5 / README §2 "magenta on a collapse label, white otherwise": a real protocol collapse renders white, indistinguishable from survive. The package fixture uses the bare label, which is why its tests pass. | `render-headless.test.tsx` › `[H-S4] a real protocol collapse label…` (actual `#ffffff`, expected `#e91e63`) | OPEN |
| H-S5 | LOW | `src/render/SidePanel.tsx:132-134, 141, 222-223` (counters passed as strings `"0 / 274432"` …) | §2 "No placeholder numbers, ever."; README §5 "Values that have not arrived render the component's unavailable state". Denominators are hardcoded constants shown before `keygenStart` (which carries `leaves/chains/links`; the state records them, the panel ignores them). | `hygiene.test.ts` › `[H-S5] counters whose totals the stream has not announced…` | OPEN |
| H-S6 | LOW | `src/render/quality.ts:525, 539` (window = 90 **frames**, one step per window) | §7 PERFORMANCE "Degrade bloom/DOF before degrading frame rate". Ultra→low needs 270 frames: 54 s at 5 fps, 135 s at 2 fps. The README's 'auto' SwiftShader run took 333 s here (stage 6 lasted 259 s) for this reason. | `quality.test.ts` › `[H-S6] from ultra at 5 fps…` (measured 54.0 s) | OPEN |
| H-S7 | LOW | `src/model/reducer.ts:269` (non-finite `halfLifeSec` → `0`) + `SidePanel.tsx:154` (renders `0 s`) | §2 "No placeholder numbers". NaN/negative half-life shows "half-life 0 s" instead of unavailable. | `hygiene.test.ts` › `the half-life row…` (passes, documents) | OPEN |
| H-S8 | LOW | `src/render/SignatureStructure.tsx:517` (`continue` before any matrix write when `lift===target===0`) | §7 CORE RULE: 67 identity-matrix boxes drawn at the origin with no `signChainStop` (occluded by the coin sphere). File header claims "scaled to zero". | `render-headless.test.tsx` › `[H-S8] stage 6 with NO signChainStop…` (all 67 at scale 1) | OPEN |
| H-S9 | **MEDIUM** | `scripts/perf.ts:41` (`frames.filter((d) => d > 0 && d < 2)`) | §7 PERFORMANCE "≥55fps median through the full sequence"; §2 "proves this with a frame-time test… not by assertion". Frames slower than 0.5 fps are dropped **before** the gating median. In the `auto` run 77 of 92 frames were dropped: "median 3.4 fps" describes 15 frames of a 333 s run with 82 stalls > 500 ms (worst 9.0 s). | manual, §3 below | OPEN |
| H-S10 | LOW | `scripts/perf.ts:169` (`gl: gpu ? 'real GPU' : …` from the env flag, not the detected renderer) | honesty of the perf proof. `PERF_GPU=1` on this GPU-less box reports `"gl":"real GPU"` while `renderer` says SwiftShader. The gate still fails (correct direction). | manual, §3 | OPEN |
| H-S11 | INFO | `scripts/perf.ts:191-197` | Harness asserts counts/stage, not `finalState.root === manifest.rootHex`. (I compared: equal, `5b2948f4…0260`.) | manual | OPEN |
| H-S12 | INFO | `scripts/perf.ts:33` | `PERF_GATE` env override of the 55 gate is undocumented in README. | — | OPEN |
| H-S13 | INFO | README §8.2 | Stale (conservative direction): 'auto' "not completed within 10 min" — completed in 333 s here, stage 8, counts reproduced. | — | OPEN |
| H-S14 | INFO | `src/model/field.ts:578` / `src/render/FieldScene.tsx:400` | `vesselParams.density` ("cloud point opacity") is computed and documented but never read by the renderer (opacity fixed 0.35). | `field.test.ts` bounds it | OPEN |
| H-S15 | INFO | `src/render/Chamber.tsx:663`, `SidePanel.tsx:96` | "computation light" / `computing` badge are **stage**-gated, not arrival-gated: a stalled stream in stage 2/3/6 keeps claiming "computing". | — | OPEN |
| H-S16 | INFO | `src/render/Warmup.tsx:141` | Adds 14 sample objects to the live graph for one frame with no event (invisible, hidden after). In README §8.2 but missing from §3's "exhaustive" ambient list. | `render-headless.test.tsx` › `empty store with <Warmup/>…` (pins it) | OPEN |
| H-S17 | INFO | `src/render/QuantumDraw.tsx:403, 437` | `lastResolved` starts at 0: mounting the draw into a store with `resolvedCount > 0` flashes once on mount (replay of a real past event). | — | OPEN |
| H-S18 | INFO | `src/model/reducer.ts:216` | Documented watermark reset: a stale replayed `entropyRequested{seq:0}` after resolution resets the draw to `requested` (entropy null) keeping `resolvedCount`. | `partial-malformed.test.ts` › `a second draw…` (documents) | OPEN |
| H-S19 | INFO | `src/model/reducer.ts:502`, `src/render/useSources.ts:405-410` | `skipStage` to the current stage counts as an accepted event; `useSources` re-dispatches `superposition`/`lineage` on every prop identity change (accounting noise only). | — | OPEN |

Severity rationale: nothing BLOCKING — with the canonical in-order streams
`@qsd/crypto` and `@qsd/quantum` actually emit, the scene reproduces the stream
exactly (§4). H-S1/2/3 are MEDIUM because the reducer *claims* to validate and
the spec forbids showing hashes/blocks/collapses the math did not produce; they
need non-canonical streams (duplicates, out-of-order, partial quantum). H-S9 is
MEDIUM because it weakens the one measurement the spec says must be a proof.

---

## 2. Timer / frame-hook sweep (item 2)

`grep -rn "setTimeout|setInterval|requestAnimationFrame|useFrame|clock\.|elapsedTime|performance\.now|Date\.now|tween|spring|gsap|framer|anime" packages/scene/src`
→ **no** `setTimeout`, `setInterval`, `Date.now`, `performance.now`,
`clock.elapsedTime`, or tween/spring library anywhere in `src`. Hits:

| file:line | hook | what it changes | verdict |
| --- | --- | --- | --- |
| `render/context.tsx:91` | `requestAnimationFrame` | coalesces store notifications to one React update per frame for the HTML panel; no state change | ALLOWED |
| `render/Warmup.tsx:64` | `useFrame` | shader warm-up: adds/hides invisible samples once; no stage/count/value | ALLOWED (H-S16 doc gap) |
| `render/CameraRig.tsx:32` | `useFrame` | eases camera to `CAMERA_BY_STAGE[stage]`; feeds dt to the quality controller | ALLOWED (README §3) |
| `render/ChainRing.tsx:71` | `useFrame` | keygen: pure mirror of `keygen.depths` (`version`-gated); signing: eased sweep toward the event's stop depth | ALLOWED (target = event); H-S2 |
| `render/MerkleTree.tsx:68` | `useFrame` | eased rise toward `leafFormed`/`fusedFlags` targets; lit from state; root from `merkle.root` | ALLOWED |
| `render/SignatureStructure.tsx:37` | `useFrame` | eased lift toward slot for chains with a stop | ALLOWED; H-S8 |
| `render/SuperpositionCloud.tsx:86` | `useFrame`, `t += dt` | breathing amplitude = real `width`; flicker only in `arrived`/`committed`; band rotation ambient; ring period = f(halfLife); contraction = f(draw.phase) | ALLOWED (README §2/§3) |
| `render/QuantumDraw.tsx:55` | `useFrame` | photons eased in after `entropyArrived`; flash timer starts at +∞ and resets only on `resolvedCount` increment | ALLOWED; H-S4, H-S17 |
| `render/CoinSphere.tsx:26` | `useFrame`, `t += dt` | stage-1 ±6 % pulse (documented ambient); from stage 2 brightness = progress | ALLOWED |
| `render/Chamber.tsx:26` | `useFrame` | ring rotation at constant rates (documented ambient); key light = f(stage, phase) | ALLOWED; H-S15 |
| `render/SeedStreams.tsx:33` | `useFrame` | opacity eased to Σdepths/1072 | ALLOWED |
| `render/Anchor.tsx:38` | `useFrame` | packet eases to the block when `anchored`; lid/core follow arrival | ALLOWED |
| `render/Lineage.tsx:36` | `useFrame` | reveal eased after stage 8; entanglement ring rotation (documented ambient) | ALLOWED |
| `render/CollapseScene.tsx:70` | `useFrame` | ghost eases to the point when `formed` (event-derived) | ALLOWED |
| `render/FieldScene.tsx:84` | `useFrame`, `t += dt` | drift amplitude = `vesselParams.drift`; flash decays only after a live measurement; culling/LOD | ALLOWED |
| `perf/main.tsx:292-293` | `setTimeout`, `requestAnimationFrame` | **harness pacing** of the recorded stream, not the scene | ALLOWED (harness) |
| `sound/engine.ts` | Web Audio `setTargetAtTime` | tone only on `resolvedCount` increment (verified: 60 s of updates, no tone) | ALLOWED |

Verdict: no hit changes stage, a geometry count, or an event-derived value
without an event. Every state transition lives in `sceneReducer`.

---

## 3. Frame-time test (item 7) — numbers measured here

Container: 4 vCPU, **no GPU**, Chromium 141 (`/opt/pw-browsers/chromium-1194`),
ANGLE/Vulkan SwiftShader, CDP `Emulation.setCPUThrottlingRate(4)`, 390×844 @2×,
recorded redacted stream replayed at the recorded keygen rate. Each run rebuilds
`perf/dist` with vite and drives a preview server.

| command | median fps (harness) | p5 | first frame | stages | counts | stalls > 500 ms | exit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PERF_QUALITY=low pnpm --filter @qsd/scene perf` | **14.0** (n=369) | 4.3 | **1 387 ms** | 2@2s … 8@32s | 274432/256/255/67/8, root = manifest | 0 | 0 |
| `PERF_QUALITY=low PERF_MODE=empty pnpm --filter @qsd/scene perf` | 14.5 (n=140) | 8.6 | 1 492 ms | stage 1 throughout | all 0, root null | 0 | 0 |
| `pnpm --filter @qsd/scene perf` (default `auto`, the documented command) | 3.4 **over 15 of 92 frames** (H-S9) | 0.54 | 1 690 ms | 2@7s 3@56s 4@57s 5@60s 6@65s 7@324s 8@327s (333 s) | reproduced | **82**, worst 8 983 ms | 0 |
| `PERF_GPU=1 PERF_QUALITY=low pnpm --filter @qsd/scene perf` | 17.9 (n=435) | 3.9 | 1 211 ms | 8 reached | reproduced | 0 | **1 — `GATE FAILED: median 17.9 fps < 55`** |

Per-phase medians (`low`, full): init 7.4, keygen 6.5, superposition 11.9,
draw 13.6, signing 6.6, anchor 20.5, lineage 19.8 fps.

* The harness really replays the recorded stream and asserts counts and stage
  at the end (`scripts/perf.ts:191-198`); I confirmed the final root equals
  `manifest.rootHex`. PASSED (H-S11: root not self-checked).
* It **does fail** below 55 fps with `PERF_GPU=1` (exit 1). PASSED.
* The README does **not** claim 55 fps was achieved (§8.2: "Do not read it as
  55 fps; it was not measured"). PASSED. My `low` numbers (14.0 / 4.3 / 1.39 s)
  match the README's (14.8 / 4.5 / 1.50 s).
* **≥ 55 fps median on a mid-range GPU: NOT VERIFIED and not verifiable here.**
* "First frame < 2 s on mobile": 1.2–1.7 s from `page.goto` to first rAF on a
  4×-throttled desktop CPU, software rasteriser, localhost bundle — not a mobile
  measurement. NOT VERIFIED.
* Quality ladder: ultra→high→medium→low drops DOF, then bloom, then
  vignette+transmission+dpr; profiles contain no count-like field; every level
  mounts the same 1072/256/255/67/N instances. Order PASSED; counts PASSED;
  timing of the degradation is frame-count based (H-S6).
* Harness drops frames ≥ 2 s before computing the gating median (H-S9).

---

## 4. PASSED — what was attacked and held

Reducer / model (`replay.test.ts`, `partial-malformed.test.ts`, `stillness.test.ts`):
* Own stream → exactly 67 × 16 links for the leaf in view, `linksPerLeaf[k] === 1072` for all 256 leaves (also recounted independently from the raw events: 256 × 67 chains × 16 distinct depths), 256 leaves, 255 fuses `[128,64,32,16,8,4,2,1]`, root byte-equal to the stream's `rootReady` **and** `identity.root`, 67 stop depths + hashes equal to my `signChainStop` events, 8 auth nodes equal to my `authPathNode` events, signed index, 2436-byte signature, tx + slot, lineage, stage 8, 0 rejected, `accepted === events.length`.
* Every hover hash of the leaf in view / 256 leaves / 255 fused nodes equals the recorded (redacted) bytes.
* Stage order strictly 1→…→8, each entered on exactly the documented event's first occurrence; stage 3 on the **256th** `leafFormed` (before the first `treeLevelFused`); stage 4 only when both `rootReady` and the superposition input exist (either order); stage 8 only when both `anchored` and lineage exist.
* Store path (`dispatch` × 292 k with a subscriber) ≡ `replayEvents`; one notification per event.
* Empty stream: `replayEvents([])` deep-equals `createInitialState()`; an un-dispatched store is the **same object** after 60 s of fake timers + drained rAF queue, 0 notifications, stage 1, version 0; silent observables connect/disconnect cleanly.
* Partial streams: first N chainSteps (N ∈ {0,1,2,15,16,17,100,511,1071,1072}) light exactly N links; every lit link returns its real hash; every unlit link returns `null`; no leaf/fuse/root/stop appears; leaf change resets the ring.
* Rejected with counts and watermark unchanged: older seq, duplicated seq, `chainIdx` 67/−1/1.5, `depth` 16/−1, `leaf` 256, 31- and 33-byte hashes, array/hex "hashes", negative/NaN/fractional seq; `leafFormed` 256; `treeLevelFused` level 8 / index out of range / short hash; `rootReady` short; `signChainStop` chain 67 / depth 16; `authPathNode` level 8; `signStart` index 256; `anchored` without/empty txSignature; `superposition` non-bigint; `lineage` without `ca`; unknown type. Duplicate `treeLevelFused`/`leafFormed` (fresh seq) do not inflate counts.
* Quantum stream alone, in order: stage 1→5 exactly on `entropyRequested`; keygen/merkle/signature untouched; not recorded as a skip.
* `skipStage`: counts identical before/after (`to: 8` and six single steps), `skipped = [2..7]` without duplicates, never backwards, rejects 0/9/−1/2.5/NaN/∞/'7', events keep counting after a skip, `createSceneStore({startStage})` records the skip.
* Sound engine: 60 s of updates, no event → no tone; one tone per `resolvedCount` increment; none on an unchanged count.

Headless render (`render-headless.test.tsx`, `@react-three/test-renderer`, `quality="low"`):
* Stage 2: exactly **one** `chain-ring` InstancedMesh, `count === 1072`, 1072 distinct instance positions, 1072 lit entries with exactly 1 active, 0 dark; `merkle-leaves` 256; `merkle-fused` 255.
* Partial leaf (N = 1, 37, 500): lit + active = N; all 256 Merkle leaf instances at scale 0.
* Empty store: no InstancedMesh; `toGraph()` identical and a full numeric snapshot (positions, rotations, scales, visibility, material opacity/emissive/uniforms, light intensities, instance matrices, lit attributes, point positions) **identical after 60 frames** except the two documented ambient items, which move only as documented (rings rotate in place; coin scale within ±6 %, fixed position). Store version stays 0.
* With `<Warmup/>`: the only graph change is the hidden zero-scale warm-up group.
* Stage-2 mirror: 120 frames with no event → ring snapshot unchanged; one more `chainStep` → exactly one more lit entry.
* Stage 6 with my stream: ring 1072 in `signing` mode; per chain links above the real stop lit, the stop active (67 active), below dark; all 67 signature blocks at scale 1 in their slots; tree 255. Without `signChainStop`: ring fully dark.
* Stage 5 (draw mounted as MeasurementScene does): before `outcomeResolved` the flash ring is invisible and the point at scale 0; photons `drawRange === entropy.length`; after `outcomeResolved` the ring becomes visible and the point reaches scale 1.

Field (`field.test.ts`, `render-headless.test.tsx`):
* `vesselParams` pure and total under fast-check (3000 runs incl. NaN/±∞): all outputs finite and in range; identical across calls and time.
* Monotone: activity ↑ → brightness ↑, spread ↓, drift ↓, density ↑; decayProgress ↑ → brightness ↓, spread ≥, drift ↑; uncertainty ↑ → spread ↑; traded `drift === 0`, untouched dying `drift === 1`; collapsed/dead `settled`; tints from the ui-tokens palette; unknown state falls back without inventing.
* `vesselPosition`: deterministic, inside the disc, 350 vessels pairwise ≥ 1.2 apart.
* 350 coins → exactly two InstancedMeshes of count 350, < 5 ordinary meshes, < 20 nodes, all matrices finite; `coins=[]` → no instanced mesh. Traded coin's y stays exactly 0 over 90 frames while the untouched near-collapse coin drifts; a live measurement brightens only the named `ca`; unknown `ca` changes nothing.

Secret hygiene (`hygiene.test.ts`):
* No network code in `src` (fetch/XHR/WebSocket/sendBeacon/EventSource ctor/navigator/dynamic https import/Worker); no persistence (localStorage/sessionStorage/indexedDB/cookies/caches/FS). `perf/main.tsx` fetches the redacted fixture from localhost — harness only.
* Retained hash bytes are a constant 53 024 B; no state array grows with the event count.
* The package's generator calls `recordEvents({ redact: true })`, never `redact: false`; the perf page/script never call `createIdentity`. Independently proved on my own seed that `recordEvents()` defaults to redaction: all 256·67·15 secret links replaced by `sha256(value)`, all 256·67 tips untouched.

Side panel (`hygiene.test.ts`, `renderToStaticMarkup`):
* No events: proof badge not "verified", no `2436`, every non-counter row unavailable with a reason; the only "available" values are the six `0 / N` counters (H-S5).
* After my stream: root (prefix…suffix, full in markup), tx, `274432 / 274432`, `256 / 256`, `255 / 255`, `67 / 67`, `8 / 8`, `2436`, slot, full entropy hex, outcome label, channel percentages; `UNSAFE_DEV_RANDOM — proves nothing` flagged **invalid**.
* Hover on uncomputed link/leaf/node/stop/auth → reason, no hash; out-of-range hover never throws.
* Skips shown as `skipped 1, 2, 3, 4`; rejected events shown with their reason.
* The only numeric copy in JSX text in `src/render` is `title="tree of height 8"`.

---

## 5. Could not verify, and why

* **≥ 55 fps median on a mid-range GPU under 4× CPU throttle** — no GPU here; SwiftShader is a lower bound (14.0 fps `low`, 3.4 fps filtered `auto`). The spec gate is **unproven**.
* **First frame < 2 s on mobile** — not a mobile device; 1.2–1.7 s on a throttled desktop CPU with software GL and a localhost bundle.
* **Stages 4, 7, 8 and the `MeasurementScene`/`CollapseScene`/`LaunchSequence` shells headlessly** — drei `<Html/>` labels and the R3F `<Canvas>` need a DOM (README §10 limit); no jsdom in the tests package. Stage 5's draw was mounted as MeasurementScene does (without the cloud); the panel was rendered with `react-dom/server`.
* **Hover pointer interaction** — not exercised; the selectors behind it were.
* **The quality controller inside a real render loop** — tested headlessly against synthetic frame times; its `CameraRig.sample(dt)` wiring was read, not measured.
