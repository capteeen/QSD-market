# Audit log — Agent H (verify)

Chronological record of what was checked, how, and the result. Findings are
cross-referenced to [`security.md`](./security.md) by id. All commands run from
`/home/claude/qsd` unless noted. Toolchain: Node v22.22.0, pnpm 10.28.0, vitest 2.1.9.

## Wave 1 — 2026-10-09

### 08:00 Scope and ground rules
- Read `SPEC.md` in full (sections 0, 1, 2, 10 re-read). Scope for wave 1: `@qsd/crypto`,
  `@qsd/quantum`, `@qsd/ui-tokens`, `/docs/physics.md`. No package edited; `/tests` and
  `/docs/{security,audit-log}.md` owned by Agent H.
- Read every file under `packages/{crypto,quantum,ui-tokens}/src`, both READMEs, the packages'
  own tests (to know what they *claim* to cover, not to reuse), `docs/physics.md`.

### 08:01 Baseline: the packages' own suites
```
pnpm --filter @qsd/quantum test   → 5 files, 73 passed | 1 skipped (live ANU, no key), 1.34 s
pnpm --filter @qsd/ui-tokens test → 2 files, 54 passed, 1.34 s
pnpm --filter @qsd/crypto test    → 4 files, 60 passed, 20.9 s
```
Result: all green. (A green self-test is a claim, not evidence; everything below is independent.)

### 08:02 Independent KAT source
- Fetched `https://raw.githubusercontent.com/bcgit/bc-java/main/core/src/test/java/org/bouncycastle/pqc/crypto/test/XMSSTest.java`
  (219 147 bytes) into an isolated scratch directory with `curl --cacert /root/.ccr/ca-bundle.crt`.
- Wrote `tests/reference/extract_bc_kat.py`; ran `python3 -I extract_bc_kat.py <java> tests/fixtures/bc-xmss-sha256-kat.json`.
  Extracted: height-10 root/pubkey (`testGenKeyPairSHA256`), auth path for index 0 (`testAuthPath`),
  signatures 0,1,2 (`testSignSHA256`), 10 scattered height-10 signatures
  (`testSignSHA256CompleteEvenHeight2`), 16 height-4 signatures (`…Height1`).
- Observation: BC's `case 0x0822` label is out of range for height 10; the signature's embedded
  index is `0x82` = 130. Recorded as INFO; tests key on the embedded index.
- Compared only the *keys* of `packages/crypto/test/vectors/bc-xmss-sha256.json` to confirm it
  claims the same source; its contents were not used.

### 08:03 Secret / randomness greps
```
grep -rn -E "Math\.random|getRandomValues|randomBytes|randomUUID" packages/{crypto,quantum,ui-tokens}/src
  → quantum/src/providers/unsafeDev.ts:50 (dev provider), quantum/src/attestation.ts:49 (ephemeral signer; used only by dev provider)
grep -rn -E "console\.(log|error|warn|info|debug)" …/src → none (one comment)
grep for seed/apiKey/secret in throw strings → only field names, never values
```
Result: PASS (no local randomness outside the dev provider; no logging).

### 08:03 `@qsd/tests` package
- Created `tests/package.json` (`@qsd/tests`, private, workspace deps on the three packages,
  `fast-check`, `@noble/curves` for Ed25519 test keys, react/react-dom for server rendering),
  `tests/tsconfig.json` (extends `../tsconfig.base.json`), `tests/vitest.config.ts`.
- `pnpm install` → done (520 resolved, reused from store).

### 08:05 Reference implementation
- Wrote `tests/reference/xmss-ref.ts`: RFC 8391 F/H/H_msg/PRF with `toByte(0..3,32)`, ADRS
  (type-set zeroes words 4-7), recursive Algorithm 2 `chain`, `base_w`, checksum, `ltree`,
  `RAND_HASH`, stack-based Algorithm 9 `treeHash` with node recording, Algorithm 11 `buildAuth`,
  Algorithm 12/13/14. SHA-256 via `node:crypto` (not `@noble/hashes`). Secret derivation per
  Bouncy Castle / xmss-reference (documented in the file header).

### 08:06-08:13 Test authoring
| file | what it attacks | spec |
|---|---|---|
| `tests/crypto/reference-kat.test.ts` | reference vs KAT; package vs KAT; sizes 2436/64 | §3, §10 l.403 |
| `tests/crypto/cross-verify.test.ts` | package identity from fixed seed → Agent H verifier; derivation parity; 13 tamper variants | §10 l.403 |
| `tests/crypto/key-reuse.test.ts` | every public signing path, stores, concurrency, rollback, JSON edits, exhaustion | §3 l.110, §10 l.405 |
| `tests/crypto/secret-hygiene.test.ts` | JSON/inspect/reflection/errors/events | §3 l.114, §9 l.393 |
| `tests/quantum/production-guard.test.ts` | exact, case, whitespace, unset, no-`process`, injected env, defineProperty, hand-rolled provider | §4 l.139-142, §10 l.406 |
| `tests/quantum/tamper-matrix.test.ts` | 84 bundle variants, re-encodings, numeric/unicode edge cases, never-throws, replay | §4 l.157, §10 l.408 |
| `tests/quantum/attestation-honesty.test.ts` | forged witness, grinding, provider-signed binding, ANU mocked draw, timestamps | §4 l.133-146 |
| `tests/quantum/secret-hygiene.test.ts` | key in URL/errors/attestation/events/JSON; witness seed; env errors; message injection | §4 l.136, §9 l.393 |
| `tests/ui-tokens/placeholders-and-claims.test.tsx` | 16 empty-state renders, source scans, story labels, token values, trust-claim copy | §2 l.96-97, §6 l.249-250 |
| `tests/docs/physics-claims.test.ts` | honest sentences pinned; overclaims flagged | §2 l.86-90, §4 l.149-156, §8 l.360 |

### 08:14 First run — 26 failures; triage
- 22 by design (findings). 4 were bugs in Agent H's tests, fixed:
  scattered-index order (JS integer-key ordering); two tamper cases where the resolver
  legitimately reproduces the same outcome after an inputs change (replaced with a forced
  outcome flip plus a general "verify agrees with independent recomputation" test); digit
  heuristic false positives on "ISO-8601" and a JSX `{i > 0 ? (` fragment.

### 08:17 Final run
```
pnpm --filter @qsd/tests test
 ✓ crypto/cross-verify.test.ts            (17 tests)             2938ms
 ✓ crypto/reference-kat.test.ts           (68 tests)              805ms
 ✓ crypto/secret-hygiene.test.ts          (6 tests)               881ms
 ✓ quantum/tamper-matrix.test.ts          (84 tests)              349ms
 ❯ crypto/key-reuse.test.ts               (21 tests | 4 failed)  1372ms   H-C1 ×3, H-C2
 ❯ docs/physics-claims.test.ts            (12 tests | 5 failed)    16ms   H-P1..H-P5
 ❯ quantum/attestation-honesty.test.ts    (7 tests  | 2 failed)    89ms   H-Q1, H-Q2
 ❯ quantum/production-guard.test.ts       (15 tests | 7 failed)   130ms   H-Q4 ×2, H-Q5 ×5
 ❯ quantum/secret-hygiene.test.ts         (6 tests  | 1 failed)    79ms   H-Q6
 ❯ ui-tokens/placeholders-and-claims.test.tsx (26 tests | 2 failed) 68ms  H-U1, H-U2
 Test Files  6 failed | 4 passed (10)
      Tests  21 failed | 241 passed (262)
   Duration  23.70s
npx tsc -p tests/tsconfig.json --noEmit → exit 0
```
All 21 failures are `FINDING` tests that fail by design while the finding is open.

### Results by spec §10 item (wave 1 subset)

| §10 item | Method | Result |
|---|---|---|
| Crypto vs independent reference | Agent H's RFC 8391 implementation + BC KAT, both legs | **PASS, no mismatch** (16 + 13 signatures, root, auth path, sizes) |
| One-time-key reuse through every public path | 21 tests | **FAIL — BLOCKING** H-C1 (stateless API with stale state), H-C2 (`Identity._sign`). `Signer`/`StateStore` path: PASS (rollback, mutation, JSON, 12-way concurrency, same-index race, exhaustion) |
| Enable dev provider in production | 15 tests | PASS for exact `NODE_ENV=production` on all paths; **FAIL — HIGH** H-Q4 (unset / no `process`), LOW H-Q5 (case/whitespace) |
| Tamper with proof bundles | 84 variants + garbage | **PASS** (every semantically different variant rejected; never throws). INFO H-Q7 (extra top-level field accepted; anchor hash differs) |
| Attestation claims vs code | read `anu.ts`, README, physics.md; forged bundles | **FAIL — HIGH** H-Q1 (default verify trusts any key), H-Q3 (grinding undetectable, design); MEDIUM H-Q0 (spec deviation: no provider signature), H-Q2 (provider-signed unbound) |
| Physics doc honesty | read as a physicist; pinned sentences | MEDIUM H-P1, H-P2; LOW H-P3, H-P4, H-P5; the rest of the document is accurate and the "what QSD does NOT claim" sections are good |
| Placeholder numbers / UI copy | 16 renders + source scan | **PASS** for placeholders; LOW H-U1 (story says "provider attestation"), H-U2 (no attestation-kind affordance) |
| Secret hygiene | inspect/JSON/errors/events/URL | crypto **PASS**; quantum **FAIL — MEDIUM** H-Q6 (API key enumerable on provider object); MEDIUM H-C3 (unredacted keygen stream, documented) |

### Open at end of wave 1
BLOCKING: H-C1, H-C2. HIGH: H-Q1, H-Q3, H-Q4. MEDIUM: H-Q0, H-Q2, H-Q6, H-C3, H-P1, H-P2.
LOW: H-Q5, H-Q8, H-P3, H-P4, H-P5, H-U1, H-U2, H-C4. INFO: H-Q7, H-C5, H-U3, KAT typo.
Fixed: none yet (no package edits are made by Agent H).

### Not verified (wave 1)
Live ANU endpoint (no key); protocol-level claims in physics.md/README (anchoring order, no
cache); scene/protocol/solana/app items of §10; Storybook visual output; derivation vs
RFC 8391 §4.1.11 / SP 800-208 `PRF_keygen` (only BC-compatible derivation has a published KAT).

## Integrator notes received before wave 2A (recorded 2026-10-09)

1. `tests/crypto/key-reuse.test.ts` "FINDING H-C1 (variant)" asked `signWithIndex` to use index 3 on a
   shared identity whose earlier test had consumed 0-4 via `sign()`. A correct H-C1 fix must refuse that,
   so the integrator changed the test to index 40 and added an assertion that 3 is refused. Agent H
   agrees: the original test was wrong once the fix landed; the new form is what wave 1 meant.
2. H-C3 was fixed as redact-by-default in `recordEvents()`; the integrator updated
   `tests/crypto/secret-hygiene.test.ts` accordingly (`FINDING H-C3 (fixed)`; the raw stream needs
   `{ redact: false }`). Agent H re-read the test: it still proves the raw stream contains `sk_k[i]`
   and that the default recording does not. One `type CryptoEvent` import had been dropped in that
   edit (tsc error only; vitest does not typecheck) — restored by Agent H in 2A.
3. H-Q0 decision: witness-signed attestation accepted as the shipping design since no commercial QRNG
   signs responses; the UI must label the kind. Marked ACCEPTED in security.md §2.3.

## Wave 2A — 2026-10-09

Targets: `@qsd/protocol` (+ `docs/economics.md`), `@qsd/solana`. READMEs treated as claims. No package edited.

### 08:50 Baselines (a green self-test is a claim, not evidence)
```
cd tests && npx vitest run                 → 10 files, 262 passed (262), 26.8 s   (every wave-1 FINDING test now passes)
pnpm --filter @qsd/protocol test           → 6 files, 54 passed, 28.8 s
pnpm --filter @qsd/solana test             → 10 files, 45 passed | 1 skipped (network, no RPC), 10.0 s
```
Read in full: `packages/protocol/src/*` (8 files), `packages/solana/src/*` (18 files), both READMEs,
`docs/economics.md`, the relevant parts of `@qsd/quantum` (client `beforeDraw`/binding, `requireInputBinding`,
dev-provider guard) and `@qsd/crypto` (`buildHashTree`, `rootFromAuthPath`, `Address`), and the packages'
own test helpers only to learn the boundary shapes (not reused: `tests/solana/ledger.ts` is Agent H's own).

### 08:52 Greps
```
grep -rn -E "Math\.random|getRandomValues|randomBytes|randomUUID|console\." packages/{protocol,solana}/src
  → protocol: none.  solana: measure.ts nonce, keys.ts cipher nonce + tmp name, reserve.ts seed + lock jitter.  console: none
grep -rn -E "TODO|FIXME|placeholder|stub|mock" packages/{protocol,solana}/src → none
```

### 08:53 `@qsd/tests` package
Added workspace deps `@qsd/protocol`, `@qsd/solana` and dev deps `@solana/web3.js`, `@solana/spl-token`, `bs58`
(for Agent H's ledger) to `tests/package.json`; `pnpm install` (3.3 s).

### 08:55-09:40 Test authoring (all independent of the packages' own tests)
| file | what it attacks | spec |
|---|---|---|
| `tests/protocol/allocation-properties.test.ts` | own generators: sum/dust/non-negativity, determinism, k-way sybil split, duration / measurement / quiet monotonicity, independent weight formula, adversarial inputs (zero, duplicate, late/early acquisition, bad times, 10^60, 1 and 10 000 holders), **own Merkle tree** (own canonical JSON, node:crypto SHA-256, reference `RAND_HASH` + hash-tree ADRS) vs `merkleRoot`, proof tamper matrix | §5 l.199-216, §10 l.409-410 |
| `tests/protocol/decay-zeno.test.ts` | decay bounds / monotone / exact half-life points / e-folding identity / auto window; Zeno never increases decay, cap for any size, exact bps formula, doc examples; `FINDING H-E1` | §5 l.179-185, economics §1-3 |
| `tests/protocol/resolver-independent.test.ts` | own implementation of the economics §3 byte rules vs `measurementResolver` on 10k random + edge bytes, exact threshold, bad inputs; dev-provider distributions; forged outcome / label / bytes; collapsed coin; foreign ca / index / moment; `FINDING H-E2` | §5 l.187-198, l.218-222 |
| `tests/protocol/daughter-mapping.test.ts` | bounded + monotone properties with own generators, generation 1000 / 10 000 / 2^31, clamping, end points, names (U+00B7, suffix replaced) | §5 l.191-197 |
| `tests/protocol/economics-doc.test.ts` | own parser of the parameter table vs `PROTOCOL_PARAMS` (both directions), prose percentages, presets, rewards, worked examples 1 / 2 / sybil / §5 to the unit | §5 l.188-205, §8 l.360 |
| `tests/solana/ledger.ts` | Agent H's in-memory SPL ledger executing the real instructions; fault-injecting `TransactionSender`/`TransferSender`/`ChainReader`/`TokenAccountSource`; in-flight model (lands N queries later); `Crash` | — |
| `tests/solana/airdrop-crash-resume.test.ts` | 13 scenarios incl. own journal, hooks, expiry, failure, foreign journal, random fault property; `FINDING H-S1a/b`, `FINDING H-S3` | §9 l.386-388, §10 l.416 |
| `tests/solana/collapse-crash-resume.test.ts` | real dev-provider collapse; crash after each of 8 steps + inside the airdrop; foreign journals; `FINDING H-S2a/b/c` | §9 l.380-388 |
| `tests/solana/keys-config-secrets.test.ts` | vault tamper matrix, relabel attack, inspect/JSON hygiene (`FINDING H-S4a/b`), config errors, mainnet flag matrix, memory store on mainnet, `FINDING H-S5`, redaction, webhook auth | §9 l.391-394 |
| `tests/solana/measure-precommit.test.ts` | combined ChainObserver + quantum-bus timeline, memo contents vs own inputs hash, failed/dropped anchor ⇒ zero draws, rogue client, production verify options | §4 l.143-146, §9 l.389-390 |
| `tests/solana/snapshot-honesty.test.ts` | NotImplemented without history, stale slot refused, source fallback, exclusions, invalid facts refused | §2 l.96-97, §9 l.382-384 |
| `tests/solana/src-hygiene.test.ts` | console / randomness / clock / placeholder scans, param-name references, computed batch size | §1 l.66-68, §2 l.96-97, §9 l.393 |

### 09:41 First runs — triage
- protocol: 3 failures: `FINDING H-E1`, `FINDING H-E2` (by design) and one Agent H bug (a clamp
  test used generation 2, which carries a 5 % penalty) — fixed.
- solana: 16 failures. 7 by design (H-S2a/b/c, H-S3, H-S4b, H-S5). 9 harness bugs, fixed: a shared
  submit counter; a `Crash` thrown from `submit()` that the package legitimately swallows by checking
  the status (the "process crash after submit" is now modelled with the package's `afterSubmit` hook,
  and the swallowed case kept as its own PASS test); the ledger landed in-flight transactions on the
  first status query, which hid H-S1 — replaced by a "lands N queries later" model (what a cluster
  does), after which `FINDING H-S1a/b` fail as predicted; an invalid base58 ca; `JSON.stringify` of a
  circular `Connection` throws (inspect still leaks — H-S4a stands); two allow-list gaps in the
  hygiene scan; the random-fault property treated the worker's retry-budget exhaustion
  (`ChainUnavailableError` after four expired/rejected submits) as a failure — it is the documented
  "operator re-runs later" path and now resumes.
- `npx tsc -p tests/tsconfig.json --noEmit`: 7 errors, all in Agent H's files plus one dropped import in
  the integrator-edited `secret-hygiene.test.ts` — fixed; exit 0.

### 09:52 Final run
```
cd tests && npx vitest run
 ✓ protocol/allocation-properties.test.ts   (19 tests)             2904ms
 ✓ protocol/daughter-mapping.test.ts        (10 tests)              730ms
 ✓ protocol/economics-doc.test.ts           (9 tests)                31ms
 ❯ protocol/decay-zeno.test.ts              (10 tests | 1 failed)   424ms   H-E1
 ❯ protocol/resolver-independent.test.ts    (9 tests  | 1 failed)  6277ms   H-E2
 ❯ solana/airdrop-crash-resume.test.ts      (13 tests | 3 failed)   736ms   H-S1a, H-S1b, H-S3
 ❯ solana/collapse-crash-resume.test.ts     (14 tests | 3 failed) 36050ms   H-S2a, H-S2b, H-S2c
 ❯ solana/keys-config-secrets.test.ts       (11 tests | 3 failed)    43ms   H-S4a, H-S4b, H-S5
 ✓ solana/measure-precommit.test.ts         (4 tests)               267ms
 ✓ solana/snapshot-honesty.test.ts          (6 tests)               145ms
 ✓ solana/src-hygiene.test.ts               (6 tests)               257ms
 ✓ (wave 1: 10 files, 262 tests, all passing)
 Test Files  5 failed | 16 passed (21)
      Tests  11 failed | 362 passed (373)
   Duration  38.20s
npx tsc -p tests/tsconfig.json --noEmit → exit 0
```
All 11 failures are `FINDING` tests that fail by design while the finding is open.

### Results by requirement (wave 2A)

| Requirement | Method | Result |
|---|---|---|
| Allocation sums to 100 %, non-negative, deterministic (§5, §10) | own generators, 2 000+ runs | **PASS** |
| Splitting a bag never increases total (§5 l.209-211, §10) | k-way split property, 500 runs | **PASS** (loses ≤ k−1 units) |
| Longer holding never decreases share (§5, §10) | 1 200 runs across the three weight inputs | **PASS** |
| Merkle root of the table (§5 l.214-216) | own tree + proof tamper matrix | **PASS** |
| Decay bounds; half-life not timer; Zeno cap (§5) | 3 500 runs + exact points | **PASS**; LOW H-E1 (doc rounding sentence) |
| Resolver byte rules; channel / tunnel distribution (§5) | own implementation, 10k cases, 14k draws | **PASS** |
| Bundle must match coin / moment (README §4) | tamper + foreign bundles | PASS for ca / index / ppb / outcome / bytes; **MEDIUM H-E2** (`at` not bound) |
| Daughter mapping monotone and bounded (§5 l.193-195) | 5 000 runs, extreme generations | **PASS** |
| economics.md equals the exported constants; worked examples (§5) | own parser | **PASS** (26 constants, 4 examples to the unit) |
| Airdrop crash-and-resume, no double payment (§9, §10) | own ledger + journal, 13 scenarios + property | PASS for process crashes at every point; **FAIL — BLOCKING H-S1** (in-flight tx + transient error ⇒ double pay); **HIGH H-S3** (concurrent workers) |
| Daughter launch fully automatic, exactly once (§9) | crash after each of 8 steps | PASS between steps; **HIGH H-S2** (crash inside rewards / dust-burn / launch ⇒ double burn, double pay, stuck) |
| Keys encrypted at rest; tamper rejected (§9) | 11 variants + relabel | **PASS** |
| No secrets in logs (§9) | JSON / inspect of every key-holding object | vault PASS; **MEDIUM H-S4** (senders, config, chain) |
| Mainnet behind an explicit flag (§9) | env matrix + hand-built config | `loadChainConfig` PASS; **MEDIUM H-S5** (`createChain` not guarded) |
| Webhook auth constant-time, bad auth rejected (§9) | source + 8 cases | **PASS** |
| Precommit before draw; failed anchor ⇒ zero draws (H-Q3 fix) | combined timeline, provider call count | **PASS** |
| Snapshot honesty: NotImplemented without history, stale data refused (§2, §9) | 6 tests | **PASS**; LOW H-S6 (collapse slot = orchestration start) |
| No invented chain data / placeholders / Math.random (§2, §9) | source scans | **PASS** |

### Open at end of wave 2A
BLOCKING: **H-S1**. HIGH: H-S2, H-S3. MEDIUM: H-S4, H-S5, H-E2. LOW: H-E1, H-S6, H-Q8, H-C4.
INFO: H-E3, H-E4, H-S7, H-Q7, H-C5, H-U3, KAT typo.
Fixed and re-verified since wave 1: H-C1, H-C2, H-C3, H-Q1, H-Q2, H-Q3 (design implemented), H-Q4, H-Q5, H-Q6, H-P1-5, H-U1, H-U2. Accepted: H-Q0.

### Not verified (wave 2A)
Live devnet/mainnet (egress denied: `api.devnet.solana.com`, pumpportal.fun, jup.ag, helius); real
validator semantics behind the ledger (rent, compute, true signature-status / blockhash timing); Jupiter
buy-and-burn and pump.fun launch beyond their pure builders; file journals / reserve lock on a real
multi-process host; wave-1 LOW items H-Q8, H-C4 not re-examined; scene / app / `/how` — wave 2B.

---

## Scene instance — folded from `tests/scene/FINDINGS.md` during wave 3 (file deleted; statuses superseded by security.md §2)

Recorded as written by the scene instance of Agent H before the scene fixes landed. In the wave-3 full run all 61 scene tests pass, i.e. H-S1…H-S10 of this table are FIXED; H-S11…H-S19 are INFO. These ids are H-SC1…H-SC19 in security.md to keep them apart from the solana H-S ids.

### Agent H (scene instance) — verification of `@qsd/scene`

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

### 1. Findings table

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

### 2. Timer / frame-hook sweep (item 2)

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

### 3. Frame-time test (item 7) — numbers measured here

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

### 4. PASSED — what was attacked and held

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

### 5. Could not verify, and why

* **≥ 55 fps median on a mid-range GPU under 4× CPU throttle** — no GPU here; SwiftShader is a lower bound (14.0 fps `low`, 3.4 fps filtered `auto`). The spec gate is **unproven**.
* **First frame < 2 s on mobile** — not a mobile device; 1.2–1.7 s on a throttled desktop CPU with software GL and a localhost bundle.
* **Stages 4, 7, 8 and the `MeasurementScene`/`CollapseScene`/`LaunchSequence` shells headlessly** — drei `<Html/>` labels and the R3F `<Canvas>` need a DOM (README §10 limit); no jsdom in the tests package. Stage 5's draw was mounted as MeasurementScene does (without the cloud); the panel was rendered with `react-dom/server`.
* **Hover pointer interaction** — not exercised; the selectors behind it were.
* **The quality controller inside a real render loop** — tested headlessly against synthetic frame times; its `CameraRig.sample(dt)` wiring was read, not measured.


---

## Wave 2A findings — archived detail (moved out of security.md §2 in wave 3; all FIXED, see security.md §2.2)

- **H-S1 (BLOCKING) — airdrop paid a batch twice when the first transaction was in flight and the sender reported a transient error.** `airdrop.ts:333-347` reset `sent` entries to `pending` when `status()` said `pending`; `withRetry` re-entered with the same records and a new blockhash; `confirm()` timeouts were treated as a reason to rebuild. Modelled with an in-flight transaction that lands two status queries later. Fix asked for: never reset a `sent` entry while its status is pending; poll until confirmed/failed/expired; retry from the journal; reconcile `doc.signatures` before preparing. Verified fixed: `tests/solana/airdrop-crash-resume.test.ts` `FINDING H-S1a/b` pass unchanged.
- **H-S2 (HIGH) — `executeCollapse` steps with more than one send were not idempotent inside the step** (`rewards`, `dust-burn`, `daughter-launch`): a crash after the send and before the step record re-ran the send (double burn, double measurer payment, `initializeMint2` failing forever). Fix asked for: journal every signature before submitting; derive launch idempotency from the mint. Verified: `FINDING H-S2a/b/c` pass.
- **H-S3 (HIGH) — two workers resuming one airdrop journal both paid the pending batches** (`save()` unconditional replace, no lease). Fix asked for: CAS on `JournalStore.save()` + a lease. Verified: `FINDING H-S3` passes.
- **H-S4 (MEDIUM) — secrets reachable through `JSON.stringify`/`inspect`** (`Web3TransactionSender.payerKeypair`, `ChainConfig` secret fields, `Chain.config`). Verified: `FINDING H-S4a/b` pass.
- **H-S5 (MEDIUM) — `createChain` was not behind the mainnet flag** (only `loadChainConfig` enforced it). Verified: `FINDING H-S5` passes.
- **H-S6 (LOW) — the collapse slot was the orchestration start slot.** The package now takes an opt-in `collapseSlot` (`collapse.ts:155-160`, `collapseSlotSource`); the app does not pass it (wave-3 H-W13).
- **H-E2 (MEDIUM) — measurement inputs did not bind `at`.** `MeasurementInputs` now carries `at`, `lastActivityAt`, `halfLifeSec`; `FINDING H-E2` passes.
- **H-E1 (LOW) — economics.md §2 stated the Zeno rounding the wrong way round.** Sentence corrected; `FINDING H-E1` passes.
- INFO H-E3 (allocation accepts `firstAcquiredAt` outside `[bornAt, collapseAt]`; chain package validates), H-E4 (`baseName` of a name that is only `·5`), H-S7 (dev bundles carry no binding; `productionVerifyOptions` rejects them) — noted, unchanged.

---

## Wave 3 (final) — 2026-10-09 — `apps/web`, consolidation

Target: `apps/web` (Next 14 app router, Prisma, BullMQ, the @qsd packages). Read every file under
`apps/web/src`, `prisma/schema.prisma`, `README.md`, `.env.example`, `genesis.example.json`, `next.config.mjs`,
`apps/web/test/*` (the app's own tests, treated as claims), `docs/physics.md`, `docs/economics.md`, SPEC §0-2, 8-11.
No package or app file edited. Agent H's files: `tests/web/**`, `tests/package.json`, `tests/vitest.config.ts`,
`tests/tsconfig.json`, this log, `security.md`.

### 09:58 Record of what changed between waves (re-verified, not taken on trust)
```
cd tests && npx vitest run                 → 28 files, 434 passed (434), 40.0 s
   solana 54/54 (FINDING H-S1a/b, H-S2a/b/c, H-S3, H-S4a/b, H-S5 now pass unchanged)   → H-S1..H-S5 FIXED
   protocol 57/57 (FINDING H-E1, H-E2 pass unchanged)                                  → H-E1, H-E2 FIXED
   scene 61/61 (the 9 failing-by-design [H-S1..H-S10] tests of tests/scene/FINDINGS.md pass) → scene H-S1..H-S10 FIXED
   crypto 112/112, quantum 112/112, ui-tokens 26/26, docs 12/12
cd apps/web && npx vitest run              → 6 files, 30 passed
```
Integrator corrections to two wave-2A precondition assertions (H-E1/H-E2 tests) read and accepted: both
tests still prove what wave 2A meant. `tests/scene/FINDINGS.md` folded into this log (section above) and
`security.md` §2; the file is deleted.

### 10:00 Harness
`tests/package.json`: dev deps `jsdom`, `@testing-library/react`, `@testing-library/dom`, `next 14.2.33`,
`react-markdown`, `remark-gfm`, `@tanstack/react-query`, `@solana/wallet-adapter-react(-ui)`; dependency
`web: workspace:*`. `pnpm install` (peer warnings only). `tests/vitest.config.ts`: `esbuild.jsx = automatic`;
aliases `@` → `apps/web/src`, `server-only` → `tests/web/empty.ts`, `@prisma/client` → `tests/web/prisma-stub.ts`
(the Prisma client is not generated in this sandbox; the stand-in is Agent H's `tests/web/fakeDb.ts`: in-memory
tables with `where` equality / `in` / ranges / compound uniques, `include`, nested `create`, `P2002` on duplicates,
`$transaction`, `aggregate`, `groupBy`, a `down` switch that throws `PrismaClientInitializationError`), and
`scene-three` / `scene-rttr` → the scene package's own copies (see 10:35). `tests/tsconfig.json`: `paths` for the
same names. Client mocks (`tests/web/client-mocks.ts`): wallet adapter (controlled `walletState`), the scene
components (marker divs), `next/dynamic` (eager), `next/link`. Pages render through the real `RootLayout` /
route components with the real TanStack Query provider against a stubbed `fetch`.

### 10:05-10:30 Test authoring
| file | what it attacks | spec |
|---|---|---|
| `tests/web/copy-claims.test.ts` (+ `jsx-strings.ts`) | every string in `copy.ts`, JSX literals (TS compiler API), metadata, README/prisma copy vs physics.md; `FINDING H-W3`, `FINDING H-W5`, `INFO H-W9` | §2 l.86-90, §10 l.413-414 |
| `tests/web/footer.test.tsx` | the SPEC sentence byte-for-byte; real `RootLayout` on every route (route list derived from `src/app/**/page.tsx`); `FINDING H-W2` | §8 l.371-374, §11 |
| `tests/web/placeholders.test.tsx` | every page under all-503, partial outage, and realistic empty data; digits audited; `?? 0` scan; `INFO H-W10` | §2 l.96-97 |
| `tests/web/api-honesty.test.ts` | real route handlers on the stand-in: 503 never 0; 500 without stack; client unavailable values; `LOW H-W8`, `MEDIUM H-W7`, `LOW H-W13` | §2 l.96-97, §9 |
| `tests/web/how-verbatim.test.tsx` | `readDocs` = disk; `/api/how`; `HowView` heading-by-heading and whole-article equality vs an independent render | §8 l.360 |
| `tests/web/measure-auth.test.ts` | real Ed25519 challenge/response matrix (9 rejections), replay, expiry, route order, collapsed coin, `verifyOptions` vs `productionVerifyOptions`, production guard; `FINDING H-W6` | §8 MEASURE, §9 l.391-393 |
| `tests/web/launch-stream.test.ts` | real `runLaunch` on Agent H's ledger + real vault/reserve: 7 failed-payment variants create nothing; write ordering vs `sendCalls`; crypto frames = `redact(regenerate-from-seed)` byte for byte; no secret in any frame; persistence; `FINDING H-W1`; `LOW H-W11` | §8 /launch, §9 |
| `tests/web/webhook.test.ts` | auth matrix (8 cases), constant-time source, malformed bodies, one delivery → one row, duplicate and concurrent duplicate deliveries, unknown coin | §9 l.391-393 |
| `tests/web/secrets-livedata.test.ts` | `NEXT_PUBLIC_` inventory, secret names only server-side, client `process.env`, client imports, `server-only`, `next.config`, seeds/fixtures/mock identifiers, hardcoded base58, `INFO H-W12` | §9 l.393, §2, §11 |
| `tests/web/coin-page.test.tsx` | witness-signed input-bound bundle (ANU provider, injected fetch) verified / tampered / unpublished key / no key; dev bundle; measure button reward/risk; `LOW H-W4` | §8 l.343-345 |

### 10:31 Triage of Agent H's own harness bugs (fixed, not findings)
`React is not defined` → esbuild automatic JSX. Regex JSX-string extractor captured TypeScript generics →
TS compiler API. `vi.mock('server-only' | '@prisma/client')` not applied (resolved from `apps/web/node_modules`)
→ resolve aliases. RTL auto-cleanup absent without globals → explicit `cleanup()`. Digits in the all-503 render
came from Agent H's own reason string. `applyMeasurement` returns `{coin, measurement, outcome}`. The coin-page
"tampered" test first used a dev bundle, which the page rejects for the missing binding before the resolver
check — rewritten with a bound witness-signed bundle (and H-W4 downgraded from MEDIUM to LOW as a result: the
`allowUnsafeDev` option is masked by `requireInputBinding`). The first H-W6 race model let the second reader see
the first writer's in-place mutation; real reads are snapshots — modelled as such, after which both requests pass.
Webhook `Trade.tokenUnits` is `null` (the parser does not read `accountData.rawTokenAmount`; units are
recomputed from the ui amount) — assertion corrected, not a finding.

### 10:35 `npx tsc -p tests/tsconfig.json --noEmit`
Errors outside `tests/web` surfaced by the new dependencies and by package changes between waves, fixed in
Agent H's files only: `next`'s types make `process.env.NODE_ENV` read-only (quantum tests: `Object.assign` /
`Reflect.deleteProperty`); `MeasurementInputs` gained `at`/`lastActivityAt`/`halfLifeSec` (H-E2 fix; protocol
test inputs completed); the scene tests' deep `.js` imports of the scene package's `three` / test-renderer were
untyped (now `scene-three` / `scene-rttr` aliases in vitest + tsconfig `paths` to their `.d.ts`; the scene suite
re-run: 61/61). Exit 0.

### 10:40 Final runs
```
cd tests && npx vitest run web
   ❯ web/coin-page.test.tsx        (8 tests  | 1 failed)   LOW H-W4
   ❯ web/copy-claims.test.ts       (9 tests  | 2 failed)   FINDING H-W3, FINDING H-W5
   ❯ web/footer.test.tsx           (12 tests | 1 failed)   FINDING H-W2
   ❯ web/launch-stream.test.ts     (17 tests | 2 failed)   FINDING H-W1, LOW H-W11
   ❯ web/measure-auth.test.ts      (12 tests | 1 failed)   FINDING H-W6
   ✓ web/api-honesty.test.ts       (11 tests)   ✓ web/how-verbatim.test.tsx (7)   ✓ web/placeholders.test.tsx (22)
   ✓ web/secrets-livedata.test.ts  (10 tests)   ✓ web/webhook.test.ts (7)
   Test Files  5 failed | 5 passed (10);  Tests  7 failed | 108 passed (115)

cd tests && npx vitest run
   crypto 4 files 112 ✓ · quantum 4 files 112 ✓ · ui-tokens 26 ✓ · docs 12 ✓ · protocol 5 files 57 ✓
   solana 6 files 54 ✓ · scene 7 files 61 ✓ · web 10 files 115 (7 failing by design, above)
   Test Files  5 failed | 33 passed (38);  Tests  7 failed | 542 passed (549);  Duration ≈ 60 s
npx tsc -p tests/tsconfig.json --noEmit → exit 0
```
All 7 failures are wave-3 findings that fail by design while open: H-W1, H-W2, H-W3, H-W4, H-W5, H-W6, H-W11.
Every wave-1 / 2A / scene `FINDING` test passes unchanged.

### Results by requirement (wave 3)

| Requirement | Method | Result |
|---|---|---|
| Copy vs physics.md: every user-facing string (§2, §10) | 117 physics-noun strings reviewed with section + verdict; test fails on unreviewed additions | **114 ok**; **MEDIUM H-W3** (fee rebate promised, none paid); LOW H-W5 ("nothing moves"); 0 contradicts |
| Footer disclaimer verbatim on every page (§8 l.371-374) | SPEC regex vs `FOOTER_DISCLAIMER`; real layout on 9 routes | **PASS** on every route; **MEDIUM H-W2** (no not-found / error pages) |
| No placeholder numbers; 503 never 0 (§2 l.96-97) | every page × {all 503, partial, empty}; handlers on a down DB; `?? 0` scan | **PASS**; LOW H-W8; INFO H-W10 |
| `/how` verbatim (§8 l.360) | disk = API = article, heading by heading and whole | **PASS** |
| Live data only (§2, §11) | seeds, fixtures, identifiers, base58 literals, next.config | **PASS**; INFO H-W12 |
| Measurement auth: single-use, expiring, ed25519 over the exact challenge, replay (§8, §9) | real key, 9 rejection cases, replay, expiry, TOCTOU | PASS for every sequential case; **MEDIUM H-W6** (concurrent replay) |
| Non-measurable coin rejected; production verify options; no `allowUnsafeDev` outside NODE_ENV=test (§9) | `performMeasurement`, `verifyOptions`, guard | **PASS** |
| Launch: payment verified before identity/key storage; failed payment creates nothing (§8, §9) | 7 variants + ordering instrumentation | **PASS**; **HIGH H-W1** (payment replay) |
| Launch stream redacted: depth<15 = commitments, seed never leaves (§9) | frames vs regenerated identity | **PASS** (byte for byte) |
| Identity reserve persisted before the launch tx (§9) | registry/state writes at `sendCalls = 0` | **PASS** |
| Error frames carry no secrets (§9 l.393) | injected RPC URL with api-key | **LOW H-W11** |
| Webhook: constant-time auth, 401, duplicate idempotent (§9) | 8 auth cases + source; duplicate and concurrent duplicate | **PASS** |
| Secrets never `NEXT_PUBLIC_`; no client import of server modules (§9) | inventory + import scan | **PASS** |
| In-browser verification honest (§8 l.343-345) | bound witness bundle, 4 states; dev bundle | **PASS**; LOW H-W4 |
| Collapse follow-through (§9 l.380) | `enqueue` + worker source | **MEDIUM H-W7** (lost job never reconciled); LOW H-W13 (proof-anchor slot unused) |

### SPEC §11 integrator checklist — status with evidence

| §11 item | Status | Evidence / what remains |
|---|---|---|
| SPEC.md exists at root and matches this document | **not Agent H's to assert** | `SPEC.md` present at root (read in every wave); whether it "matches" is the integrator's statement |
| All eight agents reported done with passing tests | **partly verifiable** | package suites run by Agent H: `apps/web` 30/30; protocol 54/54 and solana 45/45 + 1 skipped (2A baseline); the other agents' reports are not in the repository |
| Agent H has no open blocking findings | **TRUE** | security.md §0: no BLOCKING open; 1 HIGH (H-W1), 4 MEDIUM (H-W2, H-W3, H-W6, H-W7) open |
| A real launch on devnet runs the full LaunchSequence end-to-end on real operations, and the proof panel values match the on-chain anchor | **OPEN — not verifiable here** | sandbox egress to `api.devnet.solana.com` / Helius denied. The same code path ran end to end on Agent H's ledger (`launch-stream.test.ts`): frame sequence, redaction, anchors, persistence all PASS. On devnet, check: `precommit` memo = `qsd:v1:precommit:<inputsHash>:<nonce>` of the launch bundle, `proof` memo = `bundleHash`, `Coin.launchTx` = the mint tx, scene stage 7 shows the real signatures |
| A real coin on devnet has been measured, collapsed, and produced a daughter that real test wallets received in the right proportions | **OPEN — not verifiable here** | collapse + airdrop proportions proved on the ledger (2A: `collapse-crash-resume`, `airdrop-crash-resume`, allocation properties). On devnet also confirm H-W7 does not bite (Redis up when the collapse is measured) and note H-W13 (snapshot at worker start slot) |
| No mock data, no placeholder numbers, no canned animations anywhere | **TRUE for apps/web, scene, ui-tokens** | `placeholders.test.tsx`, `secrets-livedata.test.ts`, scene stillness/hygiene suites; exception noted: H-W8 countdown is env-derived |
| /how renders the physics and economics docs verbatim | **TRUE** | `how-verbatim.test.tsx` |
| The footer disclaimer is on every page | **TRUE for every route; FALSE for 404 / error pages** | `footer.test.tsx`; H-W2 |

### Open at end of wave 3 (final)
BLOCKING: none. HIGH: **H-W1**. MEDIUM: H-W2, H-W3, H-W6, H-W7. LOW: H-W4, H-W5, H-W8, H-W11, H-W13, H-Q8, H-C4.
INFO: H-W9, H-W10, H-W12, H-E3, H-E4, H-S7, H-SC11…H-SC19, H-Q7, H-C5, H-U3, KAT typo.
Fixed and re-verified across all waves: H-C1, H-C2, H-C3, H-Q1-6, H-P1-5, H-U1, H-U2, H-S1-6 (H-S6 in the package), H-E1, H-E2, scene H-SC1-10. Accepted: H-Q0.

### Not verified (wave 3)
Devnet / mainnet items of §11 (no egress); a real Postgres (isolation, transactions) and a generated Prisma
client; a real Redis / BullMQ (cron, auto-measurer, collapse worker loop read only); `next build` and the real
client bundle; GPU frame rate and mobile first frame; wave-1 LOW H-Q8, H-C4.
