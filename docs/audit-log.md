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
