# QSD security review — Agent H (verify)

Status: **WAVE 1** (packages `@qsd/crypto`, `@qsd/quantum`, `@qsd/ui-tokens`, `/docs/physics.md`).
Protocol, scene, solana and the app are not yet reviewed; this file will be extended in wave 2.

Everything here is reproducible: `pnpm --filter @qsd/tests test` (from the repo root). Tests whose
name begins with `FINDING` fail **by design** while the finding is open; when the fix lands they
must pass unchanged. Chronological detail, including what passed, is in [`audit-log.md`](./audit-log.md).

**Ship gate (spec §10, §11): nothing ships with an open BLOCKING finding. Two are open (H-C1, H-C2).**

---

## 1. Threat model (wave 1 scope)

| Asset | Who attacks it | What they want |
|---|---|---|
| Launch identity (XMSS root, 256 one-time keys) | Anyone holding a stale `IdentityState`, a bug in a caller, a crashed-and-restored process, a second process | Make the identity sign twice with one leaf → forge further signatures for that leaf (WOTS+ breaks on reuse) |
| Identity secret material (`SK_SEED`, `SK_PRF`, chain secrets) | Log scrapers, error reporters, a shared event recording | Read secrets out of JSON / console / events |
| Measurement randomness | The QSD operator (the only party that holds the witness key and requests draws); an external forger of bundles | Choose the outcome: grind draws, fabricate bundles, substitute the dev PRNG in production |
| Proof bundles shown on every collapse | Anyone editing JSON before a third party verifies it | Make a tampered bundle pass `verify()` |
| Provider API key, witness seed | Logs, error messages, attestations, URLs, serialised objects | Exfiltrate credentials |
| User-facing physics / trust copy (`/how` renders `physics.md` verbatim) | Over-eager copywriting | Claim more than the system can prove |

Trust assumptions the code *currently* makes (these are what the HIGH findings are about):
the QSD operator is honest about which draw it published and when; verifiers pass the published
witness key; the deployment sets `NODE_ENV=production` exactly.

---

## 2. Findings

Severity: BLOCKING > HIGH > MEDIUM > LOW > INFO. "Spec" cites `SPEC.md` line numbers.

### BLOCKING

#### H-C1 — Stateless `sign()` / `signWithIndex()` reuse a one-time key with a stale state and do not throw
- **Where:** `packages/crypto/src/identity.ts:211-238` (`signWithIndex`, `sign`).
- **Spec:** §3 l.110-111 "a used leaf can NEVER be reused. Reuse attempts throw."; §10 l.405 "every public path. Must be impossible."
- **Repro:** `tests/crypto/key-reuse.test.ts` — `FINDING H-C1`, `FINDING H-C1 (variant)`, `a JSON round-tripped state with a used bit cleared …`.
- **Detail:** `sign(identity, s0, m1)` then `sign(identity, s0, m2)` returns two *valid* signatures with index 0. The pure function trusts whatever state it is handed; the `Identity` object, which is the only holder of the secret material, keeps no memory of what it has signed. A state file rolled back, a caller that forgets `state = r.state`, or a JSON copy with a cleared bit all reuse. The `Signer`+`StateStore` path is correct (see §3 PASSED), but it is optional.
- **Fix (minimal, closes H-C2 too):** give `Identity` a private `#used` bitmap. Every signing entry point (`sign`, `signWithIndex`, `Signer`, and the internal signer) ORs the supplied state into `#used`, refuses any index set in `#used`, and sets the bit *before* computing the signature. The functional API keeps returning a new state; it just cannot be fooled by an old one within a process. Cross-process safety stays with `StateStore`.
- **Status:** OPEN.

#### H-C2 — `Identity._sign(index, message)` is a public method with no reuse check
- **Where:** `packages/crypto/src/identity.ts:89-93`.
- **Spec:** §3 l.110-111; §10 l.405.
- **Repro:** `tests/crypto/key-reuse.test.ts` — `FINDING H-C2`.
- **Detail:** `@internal` is a comment; at runtime `_sign` is an ordinary method on an exported class. `identity._sign(0, a); identity._sign(0, b)` yields two valid index-0 signatures. No seed, no state needed — just the object.
- **Fix:** make it a `#private` method and expose it to `identity.ts`'s own functions via a module-scoped `WeakMap<Identity, signFn>` or a `Symbol` not exported from the package; or fold it into the H-C1 fix.
- **Status:** OPEN.

### HIGH

#### H-Q1 — `verify()` with default options accepts a bundle anyone can fabricate with any key
- **Where:** `packages/quantum/src/attestation.ts:171-176` (`trustedWitnessKeys` is optional; when omitted the key *inside the attestation* is trusted); `bundle.ts:96-159` passes `opts` through unchanged; `index.ts:84` exports this as `verify`.
- **Spec:** §4 l.143-146 "A verify() function that anyone can run on a bundle"; §0 l.23-24 "fair and verifiable".
- **Repro:** `tests/quantum/attestation-honesty.test.ts` — `FINDING H-Q1`.
- **Detail:** With no network and no QSD key, choose the bytes you want, sign a "witness" statement with a fresh Ed25519 key, and `verify(bundle, resolver)` returns `{ ok: true }`. The README documents passing `trustedWitnessKeys`, but the function the spec names, called the way the spec describes, is fail-open. The coin page ("each verifiable in-browser via Agent B's verify()") will inherit whatever default the app uses.
- **Fix:** fail closed. Ship the published QSD witness public key(s) as a constant in the package and make it the default trusted set; reject `witness-signed`/`provider-signed` attestations whose key is not in the set unless the caller passes an explicit `{ trustAnyKey: true }` (and then return a distinct result, e.g. `{ ok: true, trust: 'self-consistent-only' }`, so a UI cannot show "verified").
- **Status:** OPEN.

#### H-Q3 — Draw grinding / draw reuse is undetectable: nothing binds a draw to the inputs or proves it was the only draw
- **Where:** `packages/quantum/src/commitment.ts:14-29` (commitment = providerId ‖ requestedAt ‖ bytes ‖ attestation — no inputs hash); `providers/anu.ts:226-237` (witness statement has no inputs hash, no nonce); `bundle.ts` (verify cannot know about other draws).
- **Spec:** §0 l.23-26 "measurement uses a real quantum random number generator with on-chain proof"; §4 l.139-146; §10 l.408.
- **Repro:** `tests/quantum/attestation-honesty.test.ts` — `H-Q3 (HIGH, design)`; `tests/quantum/tamper-matrix.test.ts` — `replay: the SAME draw reused …`.
- **Detail:** The witness key holder *is* the operator. It can request N draws for one measurement, publish the favourable one, and every verifier says `ok`. It can also reuse one draw across coins. ANU gives no nonce and no signature, so nothing from outside QSD binds request ↔ inputs ↔ response. The README says the commitment is anchored "before the outcome is revealed to the UI", but grinding happens before anchoring. This is a protocol-level gap, not a bug in a line, and it is exactly the "fairness" the product sells.
- **Fix (for Agents B/E/G, integrator decision):** (1) include `inputsHash` (and a per-measurement nonce / coin id / measurement id) in the witness statement and in the commitment; (2) anchor `H(inputsHash ‖ nonce)` on-chain **before** the draw is requested, and anchor the commitment immediately after, so a late-published draw is at least detectable by timestamps and anchor ordering; (3) long term, use a provider with per-request signed nonces or a public randomness beacon (e.g. a signed beacon pulse committed to before the pulse time) so the operator cannot resample unobserved; (4) say all of this in `physics.md` (see H-P2).
- **Status:** OPEN (design).

#### H-Q4 — The production guard is fail-open: `NODE_ENV` unset or `process` absent ⇒ `UNSAFE_DEV_RANDOM` works
- **Where:** `packages/quantum/src/errors.ts:58-71` (`currentNodeEnv`, `isProduction`); `providers/unsafeDev.ts:32,42`; `providers/fromEnv.ts:45-53`.
- **Spec:** §4 l.139-142 "Deterministic fallback is FORBIDDEN in production … impossible to enable when NODE_ENV=production".
- **Repro:** `tests/quantum/production-guard.test.ts` — both `FINDING H-Q4` tests.
- **Detail:** The guard is "deny if `NODE_ENV === 'production'`", not "allow only if development/test". A worker started as `node worker.js` in a container that forgot `NODE_ENV`, with `QSD_QRNG_PROVIDER=UNSAFE_DEV_RANDOM` left in a copied `.env`, measures real coins with `crypto.getRandomValues`. In a browser production bundle there is no `process` at all (bundlers replace the literal token `process.env.NODE_ENV`, not `globalThis.process?.env?.NODE_ENV`), so the guard is inert client-side. `verify()`'s `allowUnsafeDev: false` default limits the damage to the producing side, but the spec's guarantee is on construction.
- **Fix:** require positive evidence: construct only when `NODE_ENV` is exactly `development` or `test` **and** `QSD_ALLOW_UNSAFE_DEV=1`; treat a missing `process` or missing `NODE_ENV` as production; keep the `draw()`-time re-check.
- **Status:** OPEN.

### MEDIUM

#### H-Q0 — Spec deviation: no provider-signed attestation exists; a self-signed "witness" attestation is substituted
- **Where:** `packages/quantum/src/providers/anu.ts:25-27, 226-237`; README "Provider chosen, and why".
- **Spec:** §4 l.133-138 "commercial quantum random number API that returns signed attestations … No draw is accepted without an attestation"; §1 l.66-68 (NotImplemented + report).
- **Detail:** Agent B's survey (README table) found no QRNG HTTP API that signs responses and chose ANU + a QSD-key witness signature. That is a reasonable engineering answer but it is not what §4 says, and it changes the trust model (H-Q1, H-Q3). The deviation is documented in the README and physics.md, which is the right behaviour; it still needs an explicit integrator decision and the UI must say "witness-signed", never "provider-signed" (H-U1, H-U2).
- **Fix:** integrator sign-off recorded here; or adopt a signed source (see H-Q3 fix (3)).
- **Status:** OPEN (decision).

#### H-Q2 — `provider-signed` attestations never bind `signedMessage` to the response or the bytes
- **Where:** `packages/quantum/src/attestation.ts:179-196`.
- **Spec:** §4 l.157-158 "attestation rejection on bad signature".
- **Repro:** `tests/quantum/attestation-honesty.test.ts` — `FINDING H-Q2`.
- **Detail:** A valid provider signature over `"hello world"` passes with `trustedProviderKeys`, attached to any bytes and any body. Latent today (no provider-signed provider exists) but the variant is exported and "verifiable", so the first integration would inherit a hole.
- **Fix:** require `signedMessage === hex(utf8(response.body))` (or that the decoded signed message contains `bytesSha256`), and document the binding rule per provider.
- **Status:** OPEN.

#### H-Q6 — `AnuQuantumNumbersProvider` exposes the API key through `JSON.stringify` / `console.log`
- **Where:** `packages/quantum/src/providers/anu.ts:124, 137` (`private readonly apiKey` — TypeScript-only privacy).
- **Spec:** §4 l.136 "the integrator will supply the API key via env"; §9 l.393 "no secrets in logs".
- **Repro:** `tests/quantum/secret-hygiene.test.ts` — `FINDING H-Q6`.
- **Detail:** `JSON.stringify(provider)` and `util.inspect(provider)` (what any logger prints) contain the key verbatim. Contrast `@qsd/crypto`'s `Identity`, which uses `#private` fields and is clean.
- **Fix:** `#apiKey` (ES private field) or hold the key in a closure; add `toJSON()` returning `{ id, endpoint, witnessPublicKey }`.
- **Status:** OPEN.

#### H-C3 — The default key-generation event stream contains every one-time secret key
- **Where:** `packages/crypto/src/wots.ts:107-112` (emits depth 0..14 values); `events.ts:616-623` (`recordEvents` is unredacted unless `redact: true`).
- **Spec:** §3 l.114 "seed is never logged"; §9 l.393 "no secrets in logs".
- **Repro:** `tests/crypto/secret-hygiene.test.ts` — `FINDING H-C3 (documented)` (passes; demonstrates the content).
- **Detail:** `chainStep{depth:0}` for leaf k chain i *is* `sk_k[i]`; depth d lets a holder forge any digit ≥ d. The README says so clearly ("as sensitive as the private key") and provides `redactEvents`, so this is a documented hazard rather than a bug — but the scene package (wave 2) will subscribe to exactly this stream and show hashes "on hover", and the app will be tempted to persist recordings for replay. Secure-by-default is cheap.
- **Fix:** make `recordEvents()` redact by default (`{ includeSecrets: true }` to opt out); emit redacted values to observers unless `createIdentity(seed, { emitSecrets: true })`; wave 2 will check that no recording leaves the browser.
- **Status:** OPEN (default), documented.

#### H-P1 — `physics.md` says verification needs "no trust in us", then says you must trust QSD's witness statement
- **Where:** `docs/physics.md:92-95` vs `:311-319`.
- **Spec:** §2 l.86-90; §8 l.360-361 (`/how` renders the file verbatim, so this is user-facing copy).
- **Repro:** `tests/docs/physics-claims.test.ts` — `FINDING H-P1`.
- **Fix:** "… with no account, trusting only the published QSD witness key (see *where the trust actually sits* below)."
- **Status:** OPEN.

#### H-P2 — `physics.md`'s "what you cannot verify" list omits draw selection and operator-asserted timestamps
- **Where:** `docs/physics.md:282-325`.
- **Spec:** §4 l.153-154 "exactly what QSD does NOT claim"; §2 l.86-90.
- **Repro:** `tests/docs/physics-claims.test.ts` — `FINDING H-P2`; evidence in `tests/quantum/attestation-honesty.test.ts` (`timestamps are operator-asserted …` passes, showing a 1999 timestamp verifies).
- **Fix:** add two bullets: a bundle does not show that the published draw was the *only* draw requested for those inputs (and what QSD does about it, per H-Q3), and `requestedAt`/`receivedAt` are asserted by the witness, not by the provider.
- **Status:** OPEN.

### LOW

| id | Where | Spec | Repro | Detail / fix | Status |
|---|---|---|---|---|---|
| H-Q5 | `quantum/src/errors.ts:70` | §4 l.141 | `production-guard.test.ts` `FINDING H-Q5` ×5 | `NODE_ENV` compared with `===`; `Production`, ` production`, `prod` are not production. Normalise (`trim().toLowerCase()`), and prefer the H-Q4 allow-list. | OPEN |
| H-Q8 | `quantum/src/providers/anu.ts:82-85` | §4 l.140-141 (UI says so) | `secret-hygiene.test.ts` `LOW H-Q8` (passes, documents) | The provider's `message` is spliced verbatim into an error the README calls "safe to show in the UI". Third-party string injection; truncate/escape or map to fixed copy. | OPEN |
| H-P3 | `docs/physics.md:259-266` | §2 l.86-90 | `physics-claims.test.ts` `FINDING H-P3` | "Nobody … could have predicted the bytes" / "There is no seed" is a device-independent claim. Real QRNGs mix quantum signal with classical detector noise and apply a deterministic extractor; unpredictability rests on the device's entropy model and calibration. Say so in one sentence. | OPEN |
| H-P4 | `docs/physics.md:33-34, 70-72` vs `:69-70` | §2 l.86-90 | `physics-claims.test.ts` `FINDING H-P4` | "no fact of the matter … the superposition is the complete description" and "not determined by anything that existed before" are Copenhagen-flavoured; Bohmian mechanics (deterministic, non-local) survives Bell tests. The doc later "takes no position on interpretation". Prefix with "In the standard account". | OPEN |
| H-P5 | `docs/physics.md:10-13` | §2 l.86-90 | `physics-claims.test.ts` `FINDING H-P5` | Headline bullet "every outcome ships with a proof bundle anyone can verify" lacks the qualifier the body gives ("our record of the provider's response — not the photons"). | OPEN |
| H-U1 | `ui-tokens/src/stories/ProofBadge.stories.tsx:10,19` | §6; physics.md:322-324 | `placeholders-and-claims.test.tsx` `LOW H-U1` | Story copy "awaiting provider attestation" — the live attestation is witness-signed. Rename to "awaiting witness attestation". | OPEN |
| H-U2 | `ui-tokens/src/components/ProofBadge.tsx` | physics.md:322 "The UI shows the attestation kind on every collapse" | `placeholders-and-claims.test.tsx` `LOW H-U2` | The kit has no component/prop for attestation kind, so the app cannot meet the promise with the kit alone. Add `attestationKind?: 'provider-signed' \| 'witness-signed' \| 'unsafe-dev'` to `ProofBadge` (rendered as a second word, e.g. "verified · witness-signed"). | OPEN |
| H-C4 | `crypto/src/identity.ts:119-133, 171-182` | §3 l.110-112 | — (no test; low value) | `validateState` checks only the *length* of `root`/`pubSeed`; `mergeStates` ignores a `pubSeed` mismatch and keeps `a.pubSeed`. Validate hex and require equal `pubSeed`. | OPEN |

### INFO

| id | Note |
|---|---|
| H-Q7 | `verify()` accepts unknown **top-level** bundle fields (`bundle.ts`); `bundleHash` changes so the on-chain anchor still catches it (`tamper-matrix.test.ts` `INFO H-Q7`). Consider rejecting unknown keys for strictness. |
| H-C5 | Two `Signer`s with two *different* stores for one identity reuse keys; README §7 documents "one identity ↔ one StateStore". Agent G must guarantee it (`key-reuse.test.ts` `INFO: two Signers …`). |
| H-U3 | `quantumStateColor` adds `decaying` and `dead`, which are not in the spec §5 `Coin.state` union. Harmless if the app never maps a coin to them. |
| KAT | Bouncy Castle's `XMSSTest.testSignSHA256CompleteEvenHeight2` has a typo (`case 0x0822` > 1023); the signature's own index field says `0x82`. Both implementations reproduce it at index 130. |
| ENV | `createProviderFromEnv` reads `QSD_QRNG_PROVIDER` with `trim()`; whitespace variants of the provider name are handled, `NODE_ENV` is not (H-Q5). |

---

## 3. PASSED (what was attacked and held)

- **Crypto correctness (spec §2 l.84-86, §3 l.107-109, §10 l.403-404):** Agent H's independent RFC 8391 implementation (`tests/reference/xmss-ref.ts`, node:crypto SHA-256, recursive `chain`, stack-based `treeHash`, Algorithm 13 verifier) and `@qsd/crypto` both reproduce, bit-for-bit, all 16 height-4 signatures, the height-10 root `73c3fc6d…0de3`, the height-10 index-0 auth path, and 13 height-10 signatures from Bouncy Castle's published KAT (independently fetched and parsed). Both verifiers accept every published signature and reject one-byte message changes. A package signature from a fixed seed verifies under Agent H's verifier with only `(root, pubSeed)`; Agent H's keygen from the package's HKDF output reproduces the package root and a byte-identical signature. Sizes: signature 2436, public key 64. **No mismatch.**
- **Tamper (crypto):** 13 signature/message/pubSeed variants, including walking a WOTS element one step forward, rejected by both verifiers.
- **Key reuse via the `Signer`/`StateStore` path:** restoring an older serialised state, mutating the returned state, JSON round-trip with a cleared bit put back into the store (CAS conflicts; unconditional put merges), 12 concurrent signers, 6 concurrent requests for the same index (exactly one wins), state from another identity, index 256/−1/1.5/NaN, exhaustion after 256 — all impossible.
- **Secret hygiene (crypto):** `JSON.stringify`, `util.inspect`, reflection and all error messages contain no seed / `SK_SEED` / `SK_PRF`; signing and verification event streams carry only public values.
- **Production guard, exact `NODE_ENV=production`:** constructor, `draw()` after the env flips, `createProviderFromEnv` (also with whitespace in the provider name), injected env claiming `test`, misconfiguration never falls back to the dev provider; a hand-rolled provider claiming the dev id produces bundles `verify()` rejects without `allowUnsafeDev`; a provider returning no attestation is refused by the client.
- **Proof-bundle tamper matrix:** 84 cases — every top-level, draw, attestation (unsafe-dev and witness-signed), inputs and outcome field changed, with and without recomputing dependent hashes/commitments, key substitution, signature swapped from a different statement, kind changes, extra/removed fields, replay into different inputs — all rejected; key reordering, whitespace, numeric edge cases (−0, 1e21, 2^53) and NFC/NFD strings behave correctly; `verify()` never throws on 14 kinds of garbage, a throwing Proxy, NaN/bigint/function inputs, or a throwing resolver.
- **ANU provider hygiene:** key only in the `x-api-key` header; absent from URL, attestation, commitment input, events, bundle and all five error paths; witness seed not recoverable from provider or signer; captured headers are exactly the allow-list (echoed `x-api-key`/`authorization` response headers are dropped); event order `entropyRequested → entropyArrived → commitmentComputed → outcomeResolved` with payloads equal to the bundle.
- **No local randomness** in `@qsd/quantum` outside `UnsafeDevRandomProvider` and the ephemeral signer it alone uses; no `console.*` in any of the three packages' `src`.
- **ui-tokens:** 16 empty/unavailable renders contain no digit; a real `DataRow` value renders exactly that value; component JSX text has no hard-coded numbers; stories label every example; tokens, fonts, motion (700 ms viscous, 120 ms collapse) and shape match spec §6 exactly.

---

## 4. Not verified in wave 1 (and why)

- Live ANU API behaviour (no `QSD_QRNG_API_KEY` available; the provider was exercised through a mocked `fetch` against the documented shape only).
- `physics.md` claims about the *protocol* ("anchored on-chain before the outcome is revealed", "never caches bytes") — protocol/chain packages do not exist yet (wave 2).
- `@qsd/crypto`'s WOTS+ secret derivation against RFC 8391 §4.1.11 / NIST SP 800-208 `PRF_keygen` — only the Bouncy Castle / xmss-reference derivation was checked (that is what the only published KAT uses); interoperability of *verification* is derivation-independent and was checked.
- Storybook visual output (static build present, not launched); frame-time, scene event replay, allocation properties, airdrop idempotency — wave 2 targets.
