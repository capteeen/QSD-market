# QSD security review — Agent H (verify)

Status: **WAVE 3 (final)** — consolidated over wave 1 (`@qsd/crypto`, `@qsd/quantum`, `@qsd/ui-tokens`,
`/docs/physics.md`), wave 2A (`@qsd/protocol`, `@qsd/solana`, `/docs/economics.md`), the scene instance
(`@qsd/scene`, formerly `tests/scene/FINDINGS.md`, folded in here and deleted) and wave 3 (`apps/web`).

Everything here is reproducible: `cd tests && npx vitest run` (wave 3 alone: `npx vitest run web`).
Tests whose name begins with `FINDING` fail **by design** while the finding is open; when the fix lands they
must pass unchanged. Tests named `LOW …` / `INFO …` document a finding and pass or fail as stated in §2.
Chronological detail, commands and raw outputs are in [`audit-log.md`](./audit-log.md).

## 0. Ship gate (SPEC §10 l.419-420, §11 l.435)

**Nothing ships with an open BLOCKING finding — and there is none.** Every BLOCKING and HIGH finding of
waves 1 and 2A (H-C1, H-C2, H-Q1, H-Q3, H-Q4, H-S1, H-S2, H-S3) is FIXED and re-verified by the unchanged
`FINDING` tests (crypto 112/112, quantum 112/112, protocol 57/57, solana 54/54, scene 61/61). Wave 3 opens
**one HIGH: H-W1 — the launch payment can be replayed** (`verifyPayment` checks the payment signature
against `Coin.launchTx`, which stores the *mint* transaction, so the same paid transaction launches any
number of coins: `tests/web/launch-stream.test.ts` runs the real `runLaunch` twice on the same payment and
gets two coins). It is a one-line fix (store `paymentTx` on the coin or the event log and check that
column) and **must land before mainnet**; on devnet it costs the operator only rent. Open MEDIUM: H-W2
(no `not-found.tsx` / `error.tsx` → the footer disclaimer is missing on 404 and error pages), H-W3 (the
MEASURE button promises a fee rebate that nothing pays), H-W6 (challenge nonce consumed non-atomically:
two concurrent requests both pass), H-W7 (a collapse whose queue job is lost is never reconciled). The §11
devnet items remain unverified from this sandbox (no egress to Solana hosts) and are the integrator's.

---

## 1. Threat model

| Asset | Who attacks it | What they want | Where it was tested |
|---|---|---|---|
| Launch identity (XMSS root, 256 one-time keys) | Stale state, crashed process, second process | Sign twice with one leaf | wave 1 (crypto), 2A (reserve), 3 (launch stream) |
| Secret material (seeds, KEK, creator keypair, API keys, webhook secret) | Log scrapers, error reporters, `JSON.stringify`/`inspect`, the SSE stream, the client bundle | Read secrets out of serialised objects or the browser | waves 1, 2A, 3 |
| Measurement randomness | The operator (holds the witness key, requests draws) | Grind draws, choose the outcome, choose *when* it "happened" | waves 1, 2A |
| Proof bundles | Anyone editing JSON; the page's own verifier options | Pass `verify()` with a different outcome; be labelled "verified" | waves 1, 3 |
| The daughter pool / the treasury | A holder (sybil), a crashed or duplicated worker | Receive more than the table says; receive or burn twice | wave 2A |
| The launch fee | A user with one paid transaction | Launch many coins for one payment | **wave 3 — H-W1** |
| Measurement authorisation | Anyone with a captured signed challenge | Measure as another wallet; replay | wave 3 |
| Trade ingestion | Anyone who can reach `/api/webhooks/helius`; Helius retries | Invent trades; count one trade twice (Zeno reset) | wave 3 |
| Mainnet | A mis-set config object | Hit mainnet without the integrator's flag | wave 2A |
| User-facing physics / economics copy; numbers on pages | Copywriting; a failed query | Claim more than the system does; show a `0` that is not a zero | waves 1, 3 |

Trust assumptions the code *currently* makes: one worker executes collapses and airdrops at a time
(leases exist for the reserve and, since the 2A fixes, the journals); the Helius webhook secret is the
only authentication of trade data; the operator's Redis is up when a collapse happens (H-W7); the
database serialises nothing beyond its unique indexes (H-W6).

---

## 2. Consolidated findings — every wave, final status

Severity: BLOCKING > HIGH > MEDIUM > LOW > INFO. Status: **OPEN** / **FIXED** (verified by the named test,
unchanged) / **ACCEPTED** (integrator decision recorded) / noted (INFO, no action expected).

### 2.1 Open at the end of wave 3

| id | sev | Scope | Finding (short) | Repro | Status |
|---|---|---|---|---|---|
| **H-W1** | **HIGH** | web `server/launch.ts:134-135, 270-272` | Launch payment replay: the "already used" check reads `Coin.launchTx`, which holds the mint tx | `web/launch-stream.test.ts` `FINDING H-W1` | **OPEN** |
| H-W2 | MEDIUM | web `src/app/` | No `not-found.tsx` / `error.tsx` / `global-error.tsx`: 404 and error pages carry no footer disclaimer (SPEC §8 l.371-374 "every page") | `web/footer.test.tsx` `FINDING H-W2` | **OPEN** |
| H-W3 | MEDIUM | web `copy.ts:359-360` | MEASURE promises "a fee rebate of N bps" on survive; no fee is charged, nothing pays a rebate (`surviveRebate` unreferenced in apps/web and @qsd/solana) | `web/copy-claims.test.ts` `FINDING H-W3` | **OPEN** |
| H-W6 | MEDIUM | web `server/auth.ts:29-43` | Challenge nonce consumption is `findUnique` → checks → `update`, not one conditional write: two concurrent requests with the same signed challenge both pass | `web/measure-auth.test.ts` `FINDING H-W6` | **OPEN** |
| H-W7 | MEDIUM | web `server/measure.ts:66`, `server/queues.ts:49-56`, `workers/index.ts` | A collapse outcome's daughter launch is only a queue job; `enqueue` swallows every failure (REDIS_URL unset → a warning) and nothing reconciles a collapsed mother without a daughter | `web/api-honesty.test.ts` `MEDIUM H-W7` (documents, passes) | **OPEN** |
| H-W4 | LOW | web `components/views/CoinView.tsx:244` | The browser verifier's `allowUnsafeDev` is derived from the bundle's own `kind` field (data under verification); today masked because the same call sets `requireInputBinding: true` and dev bundles carry no binding, so they render "invalid" | `web/coin-page.test.tsx` `LOW H-W4` (fails until the option is removed) | OPEN |
| H-W5 | LOW | web `copy.ts:267` | `LAUNCH.stageNote` "If no event arrives, nothing moves" vs the scene's documented ambient motion (README §3: ring rotation, stage-1 pulse) | `web/copy-claims.test.ts` `FINDING H-W5` | OPEN |
| H-W8 | LOW | web `server/stats.ts:10-20` | `nextBurnAt` is computed from env presence (`REDIS_URL` + `QSD_TOKEN_MINT`), not from a scheduled job; the home page counts down to a burn no worker may perform | `web/api-honesty.test.ts` `LOW H-W8` (documents, passes) | OPEN |
| H-W11 | LOW | web `server/launch.ts:294`, `app/api/launch/route.ts` | Every error reaches the SSE `error` frame as the raw `e.message`; web3.js fetch errors carry the RPC URL (which may hold `?api-key=`); `@qsd/solana`'s `redactSecrets` is not applied | `web/launch-stream.test.ts` `LOW H-W11` (fails until redacted) | OPEN |
| H-W13 | LOW | web `server/collapse.ts:41-57` | `executeCollapse` is called without `collapseSlot`, so the holder snapshot is taken at the worker's start slot (`collapseSlotSource: 'orchestration-start'`), not at the proof-anchor slot the package now accepts (the wave-2A H-S6 fix is unused); `/api/coin/[ca]/holders` passes `collapseSlot: 0` | `web/api-honesty.test.ts` `LOW H-W13` (documents, passes) | OPEN |
| H-Q8 | LOW | quantum | Provider message spliced into the UI error | wave 1 | OPEN (not re-examined) |
| H-C4 | LOW | crypto | `validateState` / `mergeStates` laxity | wave 1 (no test) | OPEN |
| H-W9 | INFO | web (JSX literals) | 30 user-facing strings live outside `copy.ts` although its header says every string is there; all reviewed (§3.1), pinned so additions are reviewed | `web/copy-claims.test.ts` `INFO H-W9` | noted |
| H-W10 | INFO | web `LineageView.tsx:29`, `api/me/route.ts` | The two `?? 0` defaults that can reach a page (`decimals` of an empty lineage; `tradedUiAmount` of a wallet with no trades) are real zeros in context | `web/placeholders.test.tsx` `INFO H-W10` | noted |
| H-W12 | INFO | web `.env.example` | Wires `QSD_GENESIS_CONFIG=./genesis.example.json` — operator configuration, not data (the file says so); an operator must still edit it | `web/secrets-livedata.test.ts` `INFO H-W12` | noted |
| H-E3, H-E4, H-S7 | INFO | protocol / solana | as recorded in wave 2A (defence-in-depth checks; `·5` base name; dev bundles unbound → rejected by `productionVerifyOptions`) | 2A tests (pass) | noted |
| H-SC11 … H-SC19 | INFO | scene (were H-S11…H-S19 in `tests/scene/FINDINGS.md`) | perf harness does not self-check the root; `PERF_GATE` undocumented; README 'auto' timing stale; `density` unused; "computing" badge stage-gated; Warmup objects undocumented; draw flash on mount with past events; watermark reset on stale `entropyRequested`; `skipStage` to the current stage counts | manual / documented | noted |
| H-Q7, H-C5, H-U3, KAT typo | INFO | wave 1 | as recorded | — | noted |

### 2.2 Fixed or accepted (all re-verified in the wave-3 full run — their `FINDING` tests pass unchanged)

| id | sev | Scope | Finding (short) | Verified by | Status |
|---|---|---|---|---|---|
| H-C1 | BLOCKING | crypto | stateless `sign`/`signWithIndex` reused a leaf with a stale state | `crypto/key-reuse.test.ts` | **FIXED** |
| H-C2 | BLOCKING | crypto | `Identity._sign` public | `crypto/key-reuse.test.ts` | **FIXED** |
| H-S1 | BLOCKING | solana | airdrop paid a batch twice (in-flight tx + transient error) | `solana/airdrop-crash-resume.test.ts` `FINDING H-S1a/b` | **FIXED** |
| H-Q1 | HIGH | quantum | default `verify()` trusted any key | `quantum/attestation-honesty.test.ts` | **FIXED** |
| H-Q3 | HIGH (design) | quantum + solana | grinding / draw reuse undetectable → `(inputsHash, nonce)` bound and pre-committed on-chain | `solana/measure-precommit.test.ts` | **FIXED** |
| H-Q4 | HIGH | quantum | production guard fail-open | `quantum/production-guard.test.ts` | **FIXED** |
| H-S2 | HIGH | solana | collapse steps with a send not idempotent inside the step (double burn / pay, stuck launch) | `solana/collapse-crash-resume.test.ts` `FINDING H-S2a/b/c` | **FIXED** |
| H-S3 | HIGH | solana | two workers resuming one airdrop journal both pay | `solana/airdrop-crash-resume.test.ts` `FINDING H-S3` | **FIXED** |
| H-Q0 | MEDIUM | quantum | no provider-signed attestation exists | integrator decision; UI labels the kind (H-U1/U2 fixed; wave 3 confirms the label on every collapse row and badge) | **ACCEPTED** |
| H-Q2 | MEDIUM | quantum | provider-signed attestations unbound | `quantum/attestation-honesty.test.ts` | **FIXED** |
| H-Q6 | MEDIUM | quantum | ANU API key via `JSON.stringify` | `quantum/secret-hygiene.test.ts` | **FIXED** |
| H-C3 | MEDIUM | crypto | keygen event stream unredacted by default | `crypto/secret-hygiene.test.ts` | **FIXED** |
| H-P1, H-P2 | MEDIUM | physics.md | trust claims | `docs/physics-claims.test.ts` | **FIXED** |
| H-S4 | MEDIUM | solana | secrets reachable through `JSON.stringify`/`inspect` (senders, config, chain) | `solana/keys-config-secrets.test.ts` `FINDING H-S4a/b` | **FIXED** |
| H-S5 | MEDIUM | solana | `createChain` not behind the mainnet flag | `solana/keys-config-secrets.test.ts` `FINDING H-S5` | **FIXED** |
| H-E2 | MEDIUM | protocol | measurement inputs did not bind `at` | `protocol/resolver-independent.test.ts` `FINDING H-E2` (`MeasurementInputs` now carries `at`, `lastActivityAt`, `halfLifeSec`) | **FIXED** |
| H-SC1 | MEDIUM | scene (was H-S1) | stage-5 events accepted in any phase / all `withStage(…,5)` | `scene/partial-malformed.test.ts` | **FIXED** |
| H-SC2 | MEDIUM | scene (was H-S2) | `depths[chainIdx]++` ignored `event.depth` | `scene/replay.test.ts`, `render-headless.test.tsx` | **FIXED** |
| H-SC3 | MEDIUM | scene (was H-S3) | leaf change did not clear hashes; link gated on count not arrival | `scene/partial-malformed.test.ts` | **FIXED** |
| H-SC9 | MEDIUM | scene (was H-S9) | perf harness dropped frames ≥ 2 s before the gating median | `scene/quality.test.ts` / `scripts/perf.ts` re-read | **FIXED** |
| H-E1 | LOW | economics.md | Zeno rounding sentence the wrong way round | `protocol/decay-zeno.test.ts` `FINDING H-E1` | **FIXED** |
| H-S6 | LOW | solana | collapse slot = orchestration start slot | package: `executeCollapse` takes an opt-in `collapseSlot` and reports `collapseSlotSource: 'proof-anchor'` (`collapse.ts:155-160`) | **FIXED in the package**; the app does not use it → H-W13 |
| H-SC4 … H-SC8, H-SC10 | LOW | scene (were H-S4…H-S8, H-S10) | `collapse` label vs `collapse:<id>`; string counters; frame-count quality windows; NaN half-life → `0 s`; 67 identity boxes at origin; `PERF_GPU` label from env | `scene/*.test.ts` (61/61) | **FIXED** |
| H-Q5, H-P3, H-P4, H-P5, H-U1, H-U2 | LOW | wave 1 | see `audit-log.md` | their `FINDING` tests | **FIXED** |

---

## 3. Wave 3 — `apps/web` — detail

### 3.1 Copy vs `/docs/physics.md` (SPEC §2 l.86-90, §10 l.413-414) — `tests/web/copy-claims.test.ts`

Corpus: every export of `src/copy.ts` (functions called with marker arguments), `layout.tsx` metadata, every
JSX text / string literal / template span under JSX in `src/` (TS compiler API extractor, `tests/web/jsx-strings.ts`),
`prisma/schema.prisma` comments and `README.md` copy. Every string containing a physics noun
(`quantum|collapse|superposition|measurement|decay|half-life|entangle|tunnel|wave|observer|Zeno|random|witness|
attest|proof|verif|anchor|entropy|probab|photon|state`) is in the review table `REVIEWED` with the physics.md
section it rests on and a verdict; the test fails if a new such string appears unreviewed or an entry goes stale.

| verdict | count | notes |
|---|---|---|
| ok | 114 | e.g. "inspired by quantum mechanics … not a quantum system" (§ *what QSD does NOT claim*, pinned verbatim); "collapse probability" (= decayProgress, §2); "witness-signed / unsafe-dev" labels on every badge and collapse row (physics.md *where the trust actually sits*; H-Q0 acceptance); "the random bytes come from a quantum device; the protocol does not and cannot prove that" (§ trust) |
| overclaims | 3 entries, 2 findings | **H-W3** `MEASURE_TEXT.reward` "…if it survives you receive a fee rebate of `<R>` bps" and the `MeasureQueueView` "fee rebate" row — economics.md §4 defines `surviveRebate` but no fee is charged anywhere in apps/web or @qsd/solana, so no rebate can be paid; **H-W5** `LAUNCH.stageNote` "If no event arrives, nothing moves" — the scene README §3 documents ambient motion |
| contradicts | 0 | — |

### 3.2 Footer (SPEC §8 l.371-374) — `tests/web/footer.test.tsx`
`FOOTER_DISCLAIMER` equals the SPEC sentence byte for byte (whitespace-normalised). The real `RootLayout`
renders it exactly once on every route (`/`, `/field`, `/coin/[ca]`, `/lineage/[id]`, `/launch`, `/measure`,
`/burns`, `/how`, `/me`; the route list is derived from `src/app/**/page.tsx` so a new page cannot escape).
**H-W2:** no `not-found.tsx`, `error.tsx` or `global-error.tsx` exists; Next's built-in 404 / error pages render
without the layout's footer.

### 3.3 No placeholder numbers (SPEC §2 l.96-97) — `tests/web/placeholders.test.tsx`, `api-honesty.test.ts`
Every page rendered with every API answering 503 `{unavailable:{reason}}`: zero `[data-unavailable="false"]`
cells, zero table rows, the reason text shown, no digit anywhere except the wallet address and step numbers;
partial outage (stats up, log down) shows real counters and an unavailable log. Every page rendered against
realistic **empty** payloads: six `0` counters (real zeros), empty-state sentences, `/launch` cost rows unavailable
with the server's reason and the submit button disabled, `/coin` and `/lineage` 404 states, `/me` gate and
no-trade sentences. `GET /api/stats` on a connection failure → 503 with only `unavailable` (never `0`); a
non-connection error → 500 `{error}` without a stack; the client turns non-JSON / network failures into
unavailable values. `?? 0` / `|| 0` grep: `format.ts` clean; the two that reach a page are real zeros (H-W10).
The `/` countdown is unavailable when `nextBurnAt` is null; **H-W8** records that `nextBurnAt` is env-derived.

### 3.4 `/how` verbatim (SPEC §8 l.360) — `tests/web/how-verbatim.test.tsx`
`readDocs()` returns both files byte-for-byte with their paths; `GET /api/how` serves them with `no-store`,
503 with the reason when the docs dir is missing. `HowView`'s article, heading by heading (every `#…######` of
each file, in order, same level) and as a whole (its `innerHTML` equals an independent `react-markdown` + GFM
render of the file, re-serialised by the same DOM), carries nothing but the source note. The view holds no
copy of the documents.

### 3.5 Live data only (SPEC §2, §11) — `tests/web/secrets-livedata.test.ts`
No `prisma.seed`, no seed script, no fixture import outside tests; no `mock|fake|sample|demo|placeholder|
lorem|dummy|stub` identifier in `src/` or `prisma/` (the `<input placeholder>` attribute excepted); no
base58 identifier of key length in `src/` other than the Solana program ids; `next.config.mjs` has no `env:`
block, no runtime config, no inlined `process.env` beyond `NODE_ENV`. **H-W12** (INFO): `.env.example` points
`QSD_GENESIS_CONFIG` at `genesis.example.json`, which calls itself configuration, not data.

### 3.6 Measurement API (SPEC §8 /coin MEASURE, §9 l.391-393) — `tests/web/measure-auth.test.ts`
Real `auth.ts` with a real Ed25519 key: the challenge message is `qsd.market\npurpose: …\nwallet: …\nsubject: …
\nnonce: …` (32-hex nonce, ≤ 5 min); the happy path consumes the nonce; replay → "already used"; expired →
"expired" with the nonce unconsumed; another key, another wallet, another coin, another purpose, an
un-issued nonce, a signature over a different nonce, a malformed / empty / short signature → all rejected
without consuming the nonce. `POST /api/measure`: 401 before anything else without or with bad auth; a valid
signature on an unknown coin → 409 with the nonce spent; provider unconfigured → 503 with the reason and no
chain access; a collapsed coin → `MeasureError` before the chain or provider is touched. `verifyOptions()`
with a real provider is exactly `productionVerifyOptions(env)` (`trustedWitnessKeys` + `requireInputBinding`,
no `allowUnsafeDev`); `UNSAFE_DEV_RANDOM` under `NODE_ENV=production` is not constructible, so the
`{allowUnsafeDev:true}` branch cannot exist in production. **H-W6:** the nonce check-then-set is not atomic.

### 3.7 Launch API (SPEC §8 /launch, §9) — `tests/web/launch-stream.test.ts`
The real `runLaunch` against Agent H's ledger, a real vault / reserve and the in-memory DB: seven failed-payment
variants (not found, failed on-chain, wrong payee, wrong payer, payer not a signer, one lamport short, dev buy
uncovered) each end in an `error` frame after exactly one `getTransaction` with **no vault write, no reserve
entry, no transaction sent, no coin, no log row**; unconfigured cost and an invalid form never read the chain.
On the happy path: payment verified before the mint keypair and the identity seed are vaulted; the reserve
registry and initial state are written at `sendCalls = 0` (before the precommit, proof and mint transactions);
the `crypto` frames decode (scene codec) to exactly `redact(regenerate-from-seed)`: 1072 × 256 keygen steps
with depth < 15 carrying `sha256(real value)` and depth 15 / leaves / fused nodes / root carrying the real
values; the signing stream has no `chainStep` and its `signChainStop` values equal the regenerated leaf-0 chain
at the stop depths; neither the seed, the KEK nor any unrevealed chain value appears in any frame; the coin
row, image, identity mirror (`nextIndex 1`) and launch log carry the real mint signature. **H-W1:** the same
payment launches a second coin. **H-W11:** chain errors reach the browser unredacted.

### 3.8 Webhook (SPEC §9 l.391-393) — `tests/web/webhook.test.ts`
Missing / empty / wrong / prefix / suffix / case-different / `Bearer`-prefixed header and an unset secret → 401
with nothing stored; `@qsd/solana` compares with `timingSafeEqual` (no `===` on the secret); malformed and
non-array bodies → 400; one delivery → one `Trade`, one `BalanceChange`, one log row, one Zeno reset; the same
delivery again → `stored 0`, rows unchanged, coin unchanged; two concurrent identical deliveries → one row;
a buy of an unknown coin is ignored, not invented. PASS.

### 3.9 Secrets (SPEC §9 l.393) — `tests/web/secrets-livedata.test.ts`
The only `NEXT_PUBLIC_` names anywhere in apps/web are `NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS`,
`NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_SOLANA_RPC_URL`; the server secret names appear only under
`src/server`, `src/workers`, `src/app/api`; `'use client'` files read no `process.env` and import none of
`@qsd/solana`, `@/server/*`, `@prisma/client`, `ioredis`, `bullmq`, `node:*`; every `src/server` module imports
`server-only`. PASS.

### 3.10 In-browser verification (SPEC §8 l.343-345) — `tests/web/coin-page.test.tsx`
A witness-signed, input-bound bundle made through the ANU provider with an injected fetch and Agent H's
witness key, applied by the protocol: with the key published to the build the page verifies it ("verified",
honesty caption, "ppb (matches)"); a flipped outcome → "invalid" with the resolver's reason; a bundle signed by
an unpublished key → "invalid" (never "self-consistent"); with no key published the page says so and offers only
the download. An `UNSAFE_DEV_RANDOM` bundle shows the kit's warning on the badge and renders "invalid" (no
draw binding). The MEASURE button states reward and risk from protocol constants and the live decay
("2,000 PHO (0.20 % of remaining supply)", "current collapse probability: N.N %"). **H-W4** (LOW) recorded.

---

## 4. Earlier waves — where the detail lives

The full text of every wave-1 and wave-2A finding (where / spec / repro / detail / fix) and of the scene
instance's findings, timer sweep and frame-time numbers is preserved in [`audit-log.md`](./audit-log.md)
(waves 1, 2A, and the "Scene instance" section folded in during wave 3). Their final statuses are in §2.

### 4.1 Scene — frame-time numbers (SPEC §7) as measured here, unchanged by the fixes
4 vCPU, **no GPU**, SwiftShader, CPU throttle 4×, 390×844 @2×: `PERF_QUALITY=low` median **14.0 fps**
(p5 4.3, first frame 1.39 s, stages 2→8 reproduced, root = manifest); default `auto` 3.4 fps over the frames the
old harness kept (H-SC9, fixed); `PERF_GPU=1 … low` 17.9 fps → `GATE FAILED … < 55`, exit 1 (the gate works).
**≥ 55 fps median on a mid-range GPU and first frame < 2 s on mobile remain UNVERIFIED** — no GPU, no device.

---

## 5. PASSED — what was attacked and held (summary across waves)

- **Crypto**: Agent H's RFC 8391 reference + Bouncy Castle KAT agree with `@qsd/crypto` on 16 + 13 signatures,
  roots, auth paths; one-time-key reuse refused through every public path incl. 12-way concurrency.
- **Quantum**: 84-variant tamper matrix never passes and never throws; production guard exact; secrets invisible
  to `JSON.stringify`/`inspect`; witness statement binds `(inputsHash, nonce)`.
- **Protocol / economics.md**: allocation sums exactly, non-negative, deterministic, sybil-split never gains;
  decay/Zeno exact at the documented points; resolver equals Agent H's own byte-rule implementation on 10k cases;
  all 26 constants and 4 worked examples match the document to the unit.
- **Solana**: airdrop and collapse crash-resume at every crash point incl. in-flight transactions and a second
  worker (after the 2A fixes); vault tamper matrix; mainnet flag at every entry; precommit before every draw;
  snapshot refuses to guess.
- **Scene**: the reducer reproduces Agent H's own recorded stream exactly (1072 links × 256 leaves, every hover
  hash); nothing moves or counts without an event (60 s of fake time, zero notifications); malformed and
  out-of-order events rejected with the watermark unchanged; headless render counts equal the state.
- **Web** (this wave): §3.3, §3.4, §3.5, §3.8, §3.9 fully; §3.6 and §3.7 except the open findings; H-U1/H-U2's
  attestation-kind label present on every badge and collapse row; every page honest under total and partial
  outage and under empty data; in-browser verification uses only the published witness keys.

---

## 6. Not verified (and why)

- **SPEC §11 devnet items** (a real launch end to end with proof panel = on-chain anchor; a real coin measured,
  collapsed, a daughter received in proportion): outbound CONNECT to `api.devnet.solana.com`, Helius,
  PumpPortal, Pinata and Jupiter is denied by the sandbox egress proxy. Everything chain-side ran against
  Agent H's ledger, which executes the real instructions but is not a validator (rent, compute, true
  signature-status timing). The integrator's checklist in `audit-log.md` marks these OPEN with what to look for.
- A real Postgres: the in-memory stand-in honours unique indexes and `P2002`, not transactions or isolation
  levels; H-W6 is argued from the code (two reads then an unconditional update) and shown with snapshot reads.
- A real Redis / BullMQ: queues were exercised only in their "unset" path (H-W7); the hourly burn cron, the
  auto-measurer and the collapse worker loop were read, not run.
- The Next.js production build and the real browser bundle (client/server boundary is checked at source level;
  `next build` was not run here).
- Prisma client generation (`@prisma/client` is aliased to the stand-in; the schema was read, not migrated).
- Frame rate on a GPU; first frame on a mobile device (§4.1).
- Wave-1 LOW items H-Q8 and H-C4 were not re-examined.
