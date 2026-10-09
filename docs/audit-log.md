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

## Wave 2 — pending
Targets: scene event replay + empty stream + 67×16 link count, frame-time on the throttled
profile, allocation property tests (sum = 100 %, bag-split never increases share, holding
monotonicity), daughter mapping monotone/bounded, airdrop crash-and-resume, every user-facing
string in `/apps/web` vs `physics.md`, re-run of every wave-1 `FINDING` test after fixes.
