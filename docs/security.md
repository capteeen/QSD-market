# QSD security review — Agent H (verify)

Status: **WAVE 2A** (adds `@qsd/protocol`, `@qsd/solana`, `/docs/economics.md` to the wave-1 scope of
`@qsd/crypto`, `@qsd/quantum`, `@qsd/ui-tokens`, `/docs/physics.md`). Scene and the app are not yet reviewed (wave 2B).

Everything here is reproducible: `cd tests && npx vitest run` (wave 2A alone: `npx vitest run protocol solana`).
Tests whose name begins with `FINDING` fail **by design** while the finding is open; when the fix lands they
must pass unchanged. Chronological detail, including what passed, is in [`audit-log.md`](./audit-log.md).

**Ship gate (spec §10 l.419-420, §11): nothing ships with an open BLOCKING finding.
Wave 1's two BLOCKING findings (H-C1, H-C2) are fixed and re-verified. Wave 2A opens one: H-S1 (airdrop double payment).**

---

## 1. Threat model

| Asset | Who attacks it | What they want |
|---|---|---|
| Launch identity (XMSS root, 256 one-time keys) | Stale state, crashed process, second process | Sign twice with one leaf |
| Secret material (seeds, KEK, creator keypair, API keys) | Log scrapers, error reporters, `JSON.stringify`/`inspect` in a logger | Read secrets out of serialised objects |
| Measurement randomness | The operator (holds the witness key, requests draws) | Grind draws, choose the outcome, choose *when* the measurement "happened" |
| Proof bundles | Anyone editing JSON | Pass `verify()` with a different outcome |
| **The daughter pool (wave 2A)** | A holder (sybil), the operator, a crashed/duplicated worker | Receive more than the table says; receive twice; burn twice |
| **The treasury (wave 2A)** | A crashed worker | Re-run a step that already moved tokens |
| Mainnet | A mis-set config object | Hit mainnet without the integrator's flag |
| User-facing physics / economics copy | Copywriting | Claim more than the system does |

Trust assumptions the code *currently* makes: the operator chooses the `at` of every measurement (H-E2); the
holding history comes from the app's trade DB (the chain package refuses to guess it — PASS); one airdrop
worker runs at a time (H-S3); the RPC never accepts a transaction and then reports a transient error (H-S1).

---

## 2. Findings

Severity: BLOCKING > HIGH > MEDIUM > LOW > INFO. "Spec" cites `SPEC.md` line numbers. Status: OPEN / FIXED (verified by the named test) / ACCEPTED (integrator decision recorded).

### 2.1 Wave 2A — `@qsd/solana`

#### H-S1 — The airdrop pays a batch twice when the first transaction is in flight and the sender reports a transient error (BLOCKING)
- **Where:** `packages/solana/src/airdrop.ts:333-347` (submit failed → `status()` says `pending` → entries reset to `pending`, `txSignature` deleted, error rethrown); `airdrop.ts:321-331, 377` (`withRetry` re-enters the closure with the **same** records and builds a **new** transaction with a new blockhash; `retryIf` matches transient errors and `/expired/`); `airdrop.ts:351` + `sender.ts:143-151` (`confirm()` throws `TransientChainError` on timeout while the batch is still in flight; the retry re-prepares the records that are journalled `sent`).
- **Spec:** §9 l.386-388 "Idempotent: a crashed airdrop resumes without double-paying. Agent H tests this."; §10 l.416.
- **Repro:** `tests/solana/airdrop-crash-resume.test.ts` — `FINDING H-S1a`, `FINDING H-S1b`.
- **Detail:** The crash-resume path (journal `sent` before submit, reconcile by signature on resume) is correct and holds under every crash point Agent H tried (12 scenarios + a 40-run random fault property). The hole is the *in-process* retry: (a) `sendRawTransaction` times out or the connection resets **after** the RPC forwarded the transaction; `getSignatureStatuses` says `null` (not processed yet) → the code assumes "cannot have landed", resets the entries to `pending` and the retry sends a second transaction to the same wallets with a fresh blockhash. Both land. (b) `confirm()` gives up after `maxWaitMs` with a `TransientChainError`; the records are still `sent` but the retry closure overwrites them with a new signature and sends again. The journal ends consistent with itself (`confirmedUnits == allocatedUnits`) while the ledger shows every wallet in the batch credited twice; the first signature survives only in `doc.signatures`. Modelled with an in-flight transaction that lands two status queries later, which is what a real cluster does.
- **Fix:** never reset a `sent` entry to `pending` while its status is `pending`: on any failure after the journal says `sent`, poll `status()` until `confirmed`/`failed`/`expired` (the blockhash bounds the wait at ~60-90 s) and only then decide; make the retry loop start from the journal (re-read entry statuses) instead of re-preparing captured records; treat a `confirm()` timeout as "still pending", not as a reason to rebuild. A defensive second line: before preparing any batch, reconcile every signature in `doc.signatures` that is not attached to a `confirmed` entry.
- **Status:** OPEN — BLOCKING.

#### H-S2 — `executeCollapse` steps that send more than one transaction are not idempotent inside the step: a crash after a send and before the step record re-runs the send (HIGH)
- **Where:** `packages/solana/src/collapse.ts:184-209` (`rewards`: burn + measurer transfer journalled as one step, no per-signature journal); `:287-296` (`dust-burn`); `:230-244` + `launch.ts:545-565` (`daughter-launch`: a second run re-sends `initializeMint2` for the same mint, which fails on-chain forever); README §7 l.14-16 claims "a step that crashed mid-way is … re-checked by signature (burns, launch)" — it is not.
- **Spec:** §9 l.380-381 (fully automatic daughter launch), l.386-388 (idempotency), §1 l.72-74 (README as a claim).
- **Repro:** `tests/solana/collapse-crash-resume.test.ts` — `FINDING H-S2a` (mother burned 2 × `burnedUnits`, measurer paid twice), `FINDING H-S2b` (dust burned twice), `FINDING H-S2c` (collapse stuck: every resume throws "mint already initialized").
- **Detail:** Crashes *between* steps are handled correctly for all 8 step boundaries (the step wrapper journals after `save()`), and a crash inside the airdrop step is handled by the airdrop journal. But `rewards`, `dust-burn` and `daughter-launch` each call `sender.send()` and only journal when the whole step returns. A process killed while `confirm()` is polling (the common case: deploys, OOM) re-runs the send. For `rewards` that is a second 1 % burn from the treasury and a second measurer payment; for `dust-burn` a second dust burn; for `daughter-launch` a permanently stuck collapse (the daughter *was* launched, the journal does not know).
- **Fix:** journal every signature before submitting it (as the airdrop does): write `{ step, signature, lastValidBlockHeight }` sub-records, and on resume reconcile each by `status()` before deciding to resend. For the launch, derive idempotency from the mint: if `getTokenSupply(mint)` succeeds the launch happened. Fix the README claim or make it true.
- **Status:** OPEN.

#### H-S3 — Two workers resuming the same airdrop journal both pay the pending batches (HIGH)
- **Where:** `packages/solana/src/airdrop.ts:251-265` (load → act; no lease, no version/CAS); `journal.ts:420-458` (`save()` is an unconditional replace); `chain.ts:229-232`.
- **Spec:** §9 l.386-388; README §7 "Airdrop crash-resume guarantee".
- **Repro:** `tests/solana/airdrop-crash-resume.test.ts` — `FINDING H-S3`.
- **Detail:** Nothing prevents a second process (a cron overlap, a re-deployed worker next to a hung one, an operator's manual re-run) from loading the same journal with pending entries and sending them too. Both observe `pending`, both prepare distinct transactions, both land. The identity reserve got a lock file for exactly this reason (`reserve.ts:108-147`); the journals did not.
- **Fix:** give `JournalStore.save()` compare-and-swap semantics (version counter, as `ReserveBackend.writeState` has) and take a lease (lock file with heartbeat) for the duration of a run; refuse to run when the lease is held.
- **Status:** OPEN.

#### H-S4 — Secret material is reachable through `JSON.stringify` / `util.inspect` (MEDIUM)
- **Where:** (a) `packages/solana/src/sender.ts:66` (`private readonly payerKeypair: Keypair` — TypeScript privacy only; `inspect` prints `secretKey: Uint8Array(64)`), transitively `airdrop.ts:97` (`Web3TransferSender` holds the sender); (b) `config.ts:32-52` (`ChainConfig.keyEncryptionKey`, `heliusApiKey`, `pinataJwt`, `jupiterApiKey`, `webhookSecret` are plain fields), `chain.ts:209` (`Chain.config`).
- **Spec:** §9 l.393 "no secrets in logs".
- **Repro:** `tests/solana/keys-config-secrets.test.ts` — `FINDING H-S4a`, `FINDING H-S4b`.
- **Detail:** Same class as wave 1's H-Q6 (fixed in quantum with `#private`). `describeConfig()` exists and is clean, but any `logger.info({ chain })`, any error reporter that serialises context, or a `console.dir(sender)` prints the creator's 64-byte secret key or the KEK bytes. `JSON.stringify(sender)` happens to throw (the `Connection` is circular) — `inspect` does not. `KeyVault` is clean (`#kek`, `toJSON`).
- **Fix:** `#payerKeypair` with a `toJSON()`/`[inspect.custom]` on the senders; keep secrets out of `ChainConfig` (hold them in a `#secrets` holder with accessor methods, or at least define `toJSON()` on the config object returned by `loadChainConfig` returning `describeConfig(this)`).
- **Status:** OPEN.

#### H-S5 — `createChain` is not behind the mainnet flag; the config object does not carry it (MEDIUM)
- **Where:** `packages/solana/src/chain.ts:187-202` (only `keystorePath` is checked on mainnet; `cluster`/`isMainnet` are trusted as given); `config.ts:32-52` (no `mainnetEnabled` field).
- **Spec:** §9 l.394 "Mainnet behind an explicit flag the integrator sets."
- **Repro:** `tests/solana/keys-config-secrets.test.ts` — `FINDING H-S5`.
- **Detail:** `loadChainConfig` enforces the flag correctly for every non-exact value (PASS). But the guard lives only there: a `ChainConfig` built or edited in code (`{ ...devCfg, cluster: 'mainnet-beta', isMainnet: false }`, a test fixture promoted to prod, an app that assembles the config from its own settings) reaches `createChain` and a mainnet RPC with no flag anywhere. The task's requirement is "throws from every entry point".
- **Fix:** record the flag in the config (`mainnetEnabled: true` only when the env said so) and have `createChain` throw unless `cluster !== 'mainnet-beta' || (isMainnet && mainnetEnabled)`; also reject `cluster`/`isMainnet` disagreement.
- **Status:** OPEN.

#### H-S6 — The "collapse slot" is the orchestration start slot, not the slot of the collapse measurement (LOW)
- **Where:** `packages/solana/src/collapse.ts:144` (`collapseSlot: await deps.reader.getSlot()` when `executeCollapse` first runs); `snapshot.ts:210-214` only refuses data *older* than that slot.
- **Spec:** §5 l.200 "snapshot of mother holders at collapse block"; §9 l.382-383.
- **Repro:** none (design observation; documented in README §9 as a limitation of DAS/gPA).
- **Detail:** The pump.fun token keeps trading after the collapse measurement. Everyone who buys between the proof anchor and the worker's first run is in the snapshot; anyone who sells is out. With a prompt worker the window is seconds; with a backlog it is not. Since the proof anchor's slot is known (`measurement` journal), the honest value is that slot, and the snapshot should state how far after it the data was observed.
- **Fix:** take `collapseSlot` from the proof-anchor transaction's slot and surface `observedSlot − collapseSlot` to the UI; longer term, use a slot-pinned source (Helius DAS does not offer one today).
- **Status:** OPEN.

### 2.2 Wave 2A — `@qsd/protocol` and `economics.md`

#### H-E2 — Measurement inputs do not bind the measurement time (MEDIUM)
- **Where:** `packages/protocol/src/measurement.ts:32-44` (`MeasurementInputs` = ca, ppb, channels, tunnel ppm, index — no `at`), `:97-102` (`applyMeasurement` accepts any `at` whose inputs match).
- **Spec:** §5 l.187-189; §4 l.143-146 (verifiable); §0 l.23-26.
- **Repro:** `tests/protocol/resolver-independent.test.ts` — `FINDING H-E2`.
- **Detail:** `at` is operator-supplied and appears only in the `Measurement` record. Whenever two instants give the same `decayProgressPpb` (always once `2^(−t/T)` is below float resolution — ≈ 54 half-lives — and in adjacent seconds from ≈ 17.5 half-lives on, i.e. whenever the auto-measurer was down for a while) one bundle is valid for both, so the recorded `collapsedAt` — which sets the daughter's lifetime score and every holder's `fD` — is not something a verifier can check from the bundle. Same family as wave-1 H-Q3's "operator-asserted timestamps". Not exploitable to change *outcomes* (the ppb is bound), only *when*.
- **Fix:** add `at` to `MeasurementInputs` (it is hashed into the bundle and anchored in the precommit for free) and have `applyMeasurement` require `bundle.inputs.value.at === opts.at`.
- **Status:** OPEN.

#### H-E1 — `economics.md` §2 states the Zeno rounding the wrong way round (LOW)
- **Where:** `docs/economics.md:87` ("quietTimeAfter = quietTimeBefore × (1 − fractionRemoved) (rounded down to whole seconds)") vs `packages/protocol/src/decay.ts:109-110` (the *removed* time is floored, so the remaining quiet time rounds **up**).
- **Spec:** §5 l.183-185 (documented mechanic), §8 l.360 (`/how` renders the file verbatim).
- **Repro:** `tests/protocol/decay-zeno.test.ts` — `FINDING H-E1` (7 s quiet, 50 % buy: doc says 3 s left, code leaves 4 s).
- **Fix:** "(the removed time is rounded down to whole seconds)".
- **Status:** OPEN.

| id | sev | Where | Spec | Repro | Detail / fix | Status |
|---|---|---|---|---|---|---|
| H-E3 | INFO | `protocol/src/allocation.ts:59-64, 108-122` | §5 l.200 | `allocation-properties.test.ts` `INFO H-E3` (passes, documents) | A `firstAcquiredAt` after `collapseAt` (impossible for a wallet in the collapse snapshot) is accepted with `fD = 0`; before `bornAt` is accepted with `fD = 1`. The chain package validates the former (`snapshot.ts:220`), so this is defence in depth: refuse both in `validateSnapshot`. | OPEN |
| H-E4 | INFO | `protocol/src/daughter.ts:228-232` | §5 l.196 | `daughter-mapping.test.ts` `INFO H-E4` | `baseName` requires the dot at index > 0, so a name that is only `·5` becomes `·5·2`. Harmless; pump.fun names are non-empty. | OPEN |
| H-S7 | INFO | `solana/src/measure.ts`, quantum `unsafeDev.ts` | §9 l.389 | `measure-precommit.test.ts` (documents) | Bundles from `UNSAFE_DEV_RANDOM` carry no `(inputsHash, nonce)` binding, so on devnet the bundle ↔ precommit link rests on the measurement journal; `productionVerifyOptions()` requires the binding and rejects such bundles (PASS). | noted |

### 2.3 Wave 1 — status after the fixes (all `FINDING` tests re-run in wave 2A: 262/262 pass)

| id | sev | Finding (short) | Status |
|---|---|---|---|
| H-C1 | BLOCKING | stateless `sign`/`signWithIndex` reused a leaf with a stale state | **FIXED** — `tests/crypto/key-reuse.test.ts`. Integrator note: the wave-1 "variant" test asked `signWithIndex` for index 3 on an identity whose earlier test had consumed 0-4 via `sign()`; a correct fix must refuse that, so the test now uses index 40 and asserts that 3 is refused. |
| H-C2 | BLOCKING | `Identity._sign` public | **FIXED** — `key-reuse.test.ts` |
| H-Q1 | HIGH | default `verify()` trusted any key | **FIXED** — `attestation-honesty.test.ts` |
| H-Q3 | HIGH (design) | grinding / draw reuse undetectable | **FIXED (design implemented)** — quantum binds `(inputsHash, nonce)` into the witness statement and commitment; solana anchors `qsd:v1:precommit:<inputsHash>:<nonce>` inside `beforeDraw` so no anchor ⇒ no draw; verified on the combined ChainObserver + quantum-bus timeline in `tests/solana/measure-precommit.test.ts`. Residual: the operator still chooses `at` (H-E2) and can still *fail* to publish an unfavourable draw after precommitting — but that is now visible on-chain as a precommit without a proof. |
| H-Q4 | HIGH | production guard fail-open | **FIXED** — `production-guard.test.ts` (allow-list: `NODE_ENV=test`, or `development` + `QSD_ALLOW_UNSAFE_DEV=1`) |
| H-Q0 | MEDIUM | no provider-signed attestation exists | **ACCEPTED** — integrator decision: witness-signed attestation is the shipping design since no commercial QRNG signs responses; the UI must label the attestation kind (see H-U1/H-U2, fixed). |
| H-Q2 | MEDIUM | provider-signed attestations unbound | **FIXED** — `attestation-honesty.test.ts` |
| H-Q6 | MEDIUM | ANU API key via `JSON.stringify` | **FIXED** — `quantum/secret-hygiene.test.ts` |
| H-C3 | MEDIUM | keygen event stream unredacted by default | **FIXED** — `recordEvents()` redacts by default; the raw stream is opt-in (`{ redact: false }`). Integrator note: the secret-hygiene test was updated accordingly (`FINDING H-C3 (fixed)`). |
| H-P1, H-P2 | MEDIUM | physics.md trust claims | **FIXED** — `docs/physics-claims.test.ts` |
| H-Q5, H-P3, H-P4, H-P5, H-U1, H-U2 | LOW | see wave-1 text in `audit-log.md` | **FIXED** — their `FINDING` tests pass |
| H-Q8 | LOW | provider message spliced into UI error | OPEN (not re-verified in 2A) |
| H-C4 | LOW | `validateState`/`mergeStates` laxity | OPEN (no test) |
| H-Q7, H-C5, H-U3, KAT, ENV | INFO | — | as recorded in wave 1 |

---

## 3. PASSED in wave 2A (what was attacked and held)

**Allocation (spec §5 l.199-216, §10 l.409-410)** — with Agent H's own generators (balances 0 / 2^40 / 2^90, timings across the lifetime, random held-through sets, quiet flags): Σ units + dust == total exactly, every unit ≥ 0, dust < wallets, weights in [10000, 15000] (600 runs); deterministic under shuffled input and reversed id lists (300); k-way bag split with identical timing never increases the total and loses at most k−1 units while nobody else moves (500); longer holding, more survived measurements held through, and the quiet flag never decrease units (1200); non-survived / unknown / duplicate measurement ids count for nothing; the weight formula reproduced independently (500). Adversarial: zero balances kept at 0 units, all-zero refused, duplicates / negative / non-bigint refused, quiet-flag-after-quiet-start refused, bad times refused, 10^60 balances exact, one holder gets the whole pool, 10 000 holders in < 1 s with leafCount 16384. **Merkle:** `table.merkleRoot` equals Agent H's own tree (own canonical JSON, node:crypto SHA-256, RFC 8391 `RAND_HASH` from `tests/reference/xmss-ref.ts` with hash-tree ADRS type 2) over wallet-sorted leaves padded with the documented empty leaf (200 runs + 10k case); every proof verifies; modified units (±1, +random), modified wallet, flipped index, reversed or truncated path, out-of-range index, another wallet's row, garbage root — all rejected, never throws; the padding leaf has no claimable preimage.

**Decay / Zeno (§5 l.179-185)** — `decayProgress` ∈ [0,1], 0 at or before `lastActivityAt`, monotone in quiet time, ppb = floor (2000 runs); exactly 0.5 / 0.75 / 0.875 at 1 / 2 / 3 half-lives for every preset, continuous through t = T, 1 only when collapsed; matches `1 − e^(−t ln2 / T)` to 1e-12; `nextAutoMeasureAt == lastActivityAt + 2T` for all three measurable states and `null` when collapsed; non-integer / negative times and half-lives refused. `applyBuy` never increases decay, never moves the origin past `now`, removes at most ⌊quiet/2⌋ for any buy size (cap exact at 12.5 % of market cap and beyond), monotone in buy size, pure (1500 runs); `zenoResetBps` equals the exact bigint formula (500); the `economics.md` §2 worked numbers (0.75 → 1 h 36 min, 0.67) reproduce.

**Resolver (§5 l.187-198, l.218-221)** — Agent H's own implementation of the economics.md §3 byte rules agrees with `measurementResolver.resolve` on 10 000 random (bytes, inputs) including all-0x00 / all-0xFF words and ppb ∈ {0, 1, 1e9−1, 1e9}; exact strict-`<` threshold checked at `u0 = ppb·2^64/1e9`; short draws, tables not summing to 1e6, duplicate ids, out-of-range ppb/ppm/index refused. Dev provider, 8 000 draws at decayProgress 1: tunnel 2.5 % ± 0.8 %, channels 50/30/20 % ± 3 %; survive/collapse frequency at 0.25 and 0.9 ± 2.5 % over 6 000 OS-random draws. `applyMeasurement`: a flipped outcome, a wrong label, a flipped draw byte are rejected by quantum `verify()` and by the pure checks; a collapsed coin cannot be measured; bundles for another ca, another index, a different decay moment, a different resolver id, an empty `by` are refused; the input coin is never mutated.

**Daughter (§5 l.191-197)** — longevity ∈ [0, 10000]; half-life clamped to [1 h, 7 d] and integer; band inside the channel's pool range; generation = mother + 1 (1500 runs); monotone: longer life / more survives / more supply ⇒ longevity, half-life non-decreasing and band non-widening (1500); later generation never longer (800); half-life non-decreasing and band non-increasing in longevity with the documented end points (channel min / full range; channel max / 20 % centred); generation 1000, 10 000 and 2^31: penalty capped at 50 %, no overflow; channel ranges outside the bounds clamped; the §5 example gives exactly 0.47. Names: U+00B7, existing suffix replaced not stacked (300 runs), generation 1 is the bare name.

**economics.md vs `PROTOCOL_PARAMS`** — the parameter table parsed independently: all 26 constants present with equal values and nothing undocumented; every percentage in the prose equals its constant; preset table; collapse rewards exact for 6 supplies; worked example 1 (weights 1.5000 / 1.3000 / 1.0250, units 646 319 569 / 280 071 813 / 73 608 617, dust 1), example 2 (858 657 243 / 141 342 756), the sybil split example (430 879 712 + 215 439 856), pool resolution, resolver id and Merkle strings — all reproduce to the unit.

**Airdrop crash/resume (§9 l.386-388)** — on Agent H's own ledger executing the package's real SPL instructions: no-fault run; re-run is a no-op; crash after journal-`sent` before submit (re-sent once after expiry; also with the block height already past); crash after submit before the confirmation is journalled (resume finds it confirmed, no re-send); mid-batch crash while confirming batch 2 of 3; dropped transactions expire and are re-sent; rejected submits retried; a submit that throws a *non-transient* error although it landed is reconciled by status, not re-sent; an on-chain failure is thrown, not blindly retried, and a later resume re-sends only that batch; a journal for another root / another mint / edited units is refused; 40 random sequences of recoverable faults (incl. retry-budget exhaustion and operator re-run) — in every case Σ transferred == `allocatedUnits`, every wallet credited exactly once, treasury debited exactly, root anchored exactly once.

**Collapse crash/resume (§9 l.380-388)** — a real collapse (dev-provider bundle applied through `applyMeasurement`) executed end-to-end on the ledger; a crash after each of the 8 step records (snapshot … dust-burn) and inside the airdrop step: resume skips exactly the finished steps, the daughter mint is initialised once, `daughterLaunched` emitted once, reward burn and measurer transfer once, every holder paid its exact units, dust burned once, treasury balances exact, journals complete; journals for another mother / another collapse time and a non-collapsed coin refused; the treasury is excluded from the snapshot.

**Keys, config, webhooks (§9 l.391-394)** — `KeyVault`: round trip; blob holds no plaintext; 9 tamper variants (ciphertext first/last nibble, truncation, nonce, nonce length, label/AAD, alg, version, non-hex) + wrong key + short key rejected with messages that leak nothing; a blob moved to another label in the store is refused; the vault's `#kek` invisible to `JSON.stringify`/`inspect`. `loadChainConfig`: malformed KEK names the variable, never the value; bad cluster / RPC URL named; mainnet-beta refused for `QSD_MAINNET_ENABLED` ∈ {unset, '', false, 1, yes, TRUE, True, …}; memory key store refused on mainnet; `describeConfig` and `redactSecrets` hide KEK, API keys, JWT, webhook secret, `api-key=` query, bearer tokens, base58 secret keys. Webhooks: `timingSafeEqual` in source, no `===` on the secret; unset secret, missing / empty / wrong / case-different / longer header rejected; error messages echo neither side.

**Measurement composition (H-Q3 fix)** — on a combined ChainObserver + quantum-bus timeline: `anchorRequested(precommit) < anchored(precommit) < entropyRequested < entropyArrived < outcomeResolved < anchorRequested(proof) < anchored(proof)`; the bus's first event is `entropyRequested` (seq 0) and seqs are contiguous; the provider was called once; the precommit memo decodes to Agent H's independently computed `sha256(canonical(inputs))` and the injected nonce; the proof memo equals the bundle hash; precommit and proof are different transactions; the journal holds both signatures. A failed or dropped precommit anchor ⇒ provider never called, zero bus events, coin unchanged, no `precommitTx`/`bundleHash` journalled. A client that ignores `beforeDraw` is refused after the fact. `productionVerifyOptions()` requires the input binding; the dev provider cannot satisfy it.

**Snapshot honesty (§2 l.96-97, §9 l.382-384)** — no `HoldingHistory` ⇒ `NotImplementedError` naming the missing facts; data observed before the collapse slot refused; no sources / all sources failing throw with every reason; a failing first source falls through; excluded owners and zero balances dropped; balances from the ledger, facts from the history; the quiet flag coerced false for late acquirers; impossible `firstAcquiredAt` (after collapse, NaN) refused; `mergeByOwner` sums per owner.

**Source hygiene** — no `console.*` in either package; the protocol has no clock, randomness, I/O or `process`; the only randomness in solana is nonces, seeds, the cipher nonce, a tmp-file name, lock jitter and keypair generation; no placeholder / TODO / mock markers; every `PROTOCOL_PARAMS` constant is referenced by name and the protocol fractions never appear as bare literals in the rules; the airdrop batch size is computed by serialising a real v0 transaction against 1232 bytes (n fits, n+1 does not).

---

## 4. Not verified in wave 2A (and why)

- Live devnet / mainnet behaviour (`scripts/devnet-e2e.ts`, PumpPortal, Pinata, Jupiter, Helius DAS/webhooks): outbound CONNECT to those hosts is denied by the sandbox egress proxy (as the solana README also reports). Everything chain-side was exercised against Agent H's ledger, which executes the real instructions but is not a validator: compute budgets, rent, ATA edge cases, real signature-status semantics and real blockhash expiry timing are unverified.
- `hourlyBuyAndBurn` (Jupiter path) and `launchOnPumpFun` beyond their pure request builders — mainnet-only, no network.
- `FileJournalStore` / `FileReserveBackend` on a real multi-process host (lock-file staleness at 10 s, atomic rename on the target filesystem).
- The quantum package's wave-1 open LOW items (H-Q8) and crypto H-C4 were not re-examined.
- Scene, app, `/how` rendering, frame-time, physics-claim scan of `/apps/web` — wave 2B.
