# @qsd/protocol

The QSD game rules: decay, the Zeno buy reset, measurement, daughter
derivation and the holder allocation table. Pure TypeScript, no I/O, no
clock (`now` is always a parameter), exact integer arithmetic everywhere a
unit of value is involved. Consumed by `/apps/web` and `/packages/solana`.

The public explanation of these rules, with the numbers, is
[/docs/economics.md](../../docs/economics.md); it is rendered verbatim on
`/how` and a test here checks it against `PROTOCOL_PARAMS`. What the physics
words mean and do not mean is in [/docs/physics.md](../../docs/physics.md).

```ts
import {
  PROTOCOL_PARAMS, HALF_LIFE_PRESETS,
  decayProgress, applyBuy, nextAutoMeasureAt,
  measurementInputs, measurementResolver, applyMeasurement,
  deriveDaughterParams, buildDaughterCoin, resolvePoolUnits,
  computeAllocation, allocationProof, verifyAllocationProof,
} from '@qsd/protocol';
```

---

## 1. State machine

```
            applyBuy (any size)                 applyBuy
   ┌──────────────────────────┐          ┌──────────────────────┐
   │                          ▼          │                      ▼
   │   ┌───────────────────────────────────────────────────────────┐
   │   │ measurable:  superposed  ·  measured-alive  ·  tunnelled  │
   │   └───────────────────────────────────────────────────────────┘
   │         │ measure                    ▲ survive          ▲ tunnel
   │         ▼                            │                  │
   │   ┌───────────────┐  survive ────────┘                  │
   └── │  resolver     │  tunnel  ──────────────────────────┘
       │  (QRNG draw)  │  collapse ───────▶  collapsed  (terminal; daughter born)
       └───────────────┘
```

* **`superposed`** — the coin is quiet and decaying; anyone may measure it.
* **`measured-alive`** — the state immediately after a *survive* outcome. It
  is superposed for every rule (it decays, it can be measured, it
  auto-measures), carries a fresh survival for the UI, and settles back to
  `superposed` on the next `applyBuy`. It is a display state, not a pause.
* **`tunnelled`** — the state immediately after a *tunnel* outcome: the same
  coin, same holders, quiet clock reset to the measurement time. Also
  superposed for every rule; settles to `superposed` on the next `applyBuy`.
* **`collapsed`** — terminal. `decayProgress` is 1, `collapsedAt` is set,
  the last measurement holds the channel and pool point, and a daughter is
  derived from it.

`MEASURABLE_STATES` / `isMeasurable(state)` encode "superposed for every
rule".

## 2. Decay

A coin keeps a **quiet-clock origin** `lastActivityAt`. Quiet time is
`t = now − lastActivityAt` (never negative). With half-life `T`:

```
decayProgress(t) = 1 − 2^(−t / T)        clamped to [0, 1]; 1 once collapsed
```

It is a half-life, not a timer: nothing fires at `t = T`. The number is
resolved only by a measurement, whose collapse probability equals
`decayProgress` at that instant. Expected lifetime is exponential; actual
lifetime is whatever the draws say.

`Coin.decayProgress` is a snapshot written on every transition; use
`decayProgress(coin, now)` for the live value. `decayProgressPpb(coin, now)`
is the integer (parts per billion, floor) that goes into measurement inputs.
`Math.pow` is not bit-exact across JS engines, so an independent
re-computation of the ppb may differ by 1; the value *in* a bundle is what
the resolver was applied to and is what `verify()` checks.

**Auto-measurement.** `maxWindowSec(T) = AUTO_MEASURE_HALF_LIVES × T = 2T`.
`nextAutoMeasureAt(coin) = lastActivityAt + maxWindowSec(halfLifeSec)` for
any measurable state, `null` when collapsed; `isAutoMeasureDue(coin, now)`.
Presets (`HALF_LIFE_PRESETS`): 1h → 2h, 6h → 12h, 24h → 48h, 72h → 144h,
7d → 14d. Daughters have derived half-lives; the same `2T` rule applies.

## 3. Zeno mechanic (buys)

```
fractionBps = min( ZENO_RESET_CAP_BPS (5000), ZENO_K (4) × buy × 10000 / marketCap )     bigint, floor
lastActivityAt' = lastActivityAt + floor( quiet × fractionBps / 10000 )
```

`applyBuy(coin, buyLamports, marketCapLamports, now)` returns a new `Coin`
with the origin moved forward and the state settled to `superposed`. The
reset is on quiet *time*, never directly on `decayProgress`; one buy can
remove at most half the quiet time. Throws `InvalidStateError` for a
collapsed coin. `zenoResetBps` and `resetQuietTime` are exported separately.

## 4. Measurement

### Inputs and resolver

```ts
const at = nowSeconds();                                  // the chain package's clock
const inputs = measurementInputs(coin, at);               // throws unless measurable
// MeasurementInputs = { ca, decayProgressPpb, channels: [{id, probabilityPpm}], tunnelProbabilityPpm, measurementIndex }
const { bundle } = await client.measure(inputs, measurementResolver);   // @qsd/quantum, 32 bytes
```

`measurementResolver.id === 'qsd/measurement/v1'` (`MEASUREMENT_RESOLVER_ID`).
Byte usage, every comparison in bigint:

| bytes | word `u` (big-endian u64) | rule |
| --- | --- | --- |
| 0–7 | `u0` | **collapse** iff `u0 × 1e9 < decayProgressPpb × 2^64`, else **survive** |
| 8–15 | `u1` | only if collapse: **tunnel** iff `u1 × 1e6 < tunnelProbabilityPpm × 2^64` |
| 16–23 | `u2` | only if collapse and not tunnel: `x = floor(u2 × 1e6 / 2^64)`; first channel whose cumulative ppm `> x` |
| 24–31 | `u3` | only if collapse and not tunnel: `poolPointPpm = floor(u3 × 1e6 / 2^64)` ∈ [0, 999 999] |

Outcome values: `{kind:'survive'}`, `{kind:'tunnel'}`,
`{kind:'collapse', channelId, channelIndex, poolPointPpm}`; labels
`survive`, `tunnel`, `collapse:<channelId>`. `resolveMeasurement(bytes, inputs)`
is the bare function for tests. Channel tables must sum to exactly
1 000 000 ppm (`validateChannels`).

### Applying a bundle

```ts
const { coin: next, measurement, outcome } = applyMeasurement(coin, bundle, {
  at,                       // the same `at` the inputs were built with
  by: wallet,               // or PROTOCOL_PARAMS.AUTO_MEASURER_ID
  verify: { trustedWitnessKeys: [...] },   // optional: runs @qsd/quantum verify() first; dev: { allowUnsafeDev: true }
});
```

`applyMeasurement` checks, in order: `resolverId`; quantum `verify()` when
`verify` is given; that `bundle.inputs.value` equals `measurementInputs(coin, at)`
field for field (so a stale or foreign bundle is refused with
`BundleMismatchError`); that re-running the resolver on the bundle's bytes
reproduces the bundle's outcome value and label. Then:

| outcome | new state | quiet clock | `decayAfter` |
| --- | --- | --- | --- |
| survive | `measured-alive` | `+ floor(quiet × SURVIVE_RESET_BPS / 10000)` (75 % removed) | recomputed |
| tunnel | `tunnelled` | `= at` (fully reset) | 0 |
| collapse | `collapsed`, `collapsedAt = at` | unchanged | 1 |

`Measurement = { id: bundleHash(bundle), at, by, proofBundle, outcome, decayBefore, decayAfter }`
is appended to `coin.measurements`. The input coin is never mutated.

### Rewards (exact bigint, all floors)

* `collapseRewards(remainingUnits)` → `{ removedUnits, measurerUnits, burnedUnits }`:
  `removed = remaining × 1 %`, `measurer = removed × 20 %`, `burned = removed − measurer`.
* `surviveRebate(feeLamports)` → `fee × 10 %`.
* `resolvePoolUnits(superposition, poolPointPpm)` → `supplyMin + (supplyMax − supplyMin) × ppm / 1e6`:
  the daughter pool the allocation distributes.

The chain package executes these; the protocol only computes them.

## 5. Daughter

`deriveDaughterParams(mother, collapseAt)` (mother must be `collapsed`; the
channel is read from the collapse measurement) →
`{ halfLifeSec, superposition, decayChannels, longevityBps, name, generation, imageLineage }`.

```
fL = min(1, lifetime / (6 T))     fM = min(1, survived / 5)     fS = remaining / total
L  = 0.5 fL + 0.3 fM + 0.2 fS                                                  (bps, floor)
halfLife = clamp( lerp(ch.halfLife.min, ch.halfLife.max, L) × (1 − min(50 %, 5 % × (gen − 1))), 1 h, 7 d )
bandWidth = 100 % − 80 % × L  of (ch.poolUnits.max − min), centred on the midpoint, clipped to the channel range
```

Monotone (non-decreasing half-life and non-increasing band width in
lifetime, survives, remaining supply; non-increasing half-life in
generation) and bounded (clamped); both are property-tested.
`daughterParamsFrom(finalState, channel, inherit)` is the bare mapping,
`motherFinalState(mother, collapseAt)` extracts the inputs. The daughter
inherits the lineage's channel table unchanged.

* `daughterName(name, generation)` → `NAME·<generation>` (U+00B7); an
  existing `·N` suffix is replaced; generation 1 is the bare name.
* `initialImageLineage(imageHash) = sha256("qsd/image-lineage/v1" ‖ hash)`,
  `nextImageLineage(motherLineage, motherImageHash) = sha256(lineage ‖ hash)`.
* `buildDaughterCoin(mother, params, { ca, identityRoot, bornAt, supply, imageUri? })`
  assembles the `Coin` once the chain has minted it.

## 6. Allocation

```ts
const table = computeAllocation({
  snapshot,               // HolderSnapshot[] at the collapse block (chain package)
  measurements: mother.measurements,
  bornAt: mother.bornAt,
  collapseAt,
  quietPeriodStart: mother.lastActivityAt,   // at collapse
  totalDaughterUnits: resolvePoolUnits(mother.superposition, poolPointPpm),
});
```

```
HolderSnapshot = { wallet, balance: bigint, firstAcquiredAt, heldThroughMeasurementIds: string[], heldThroughQuietPeriod: boolean }

fD = min(1, (collapseAt − firstAcquiredAt) / (collapseAt − bornAt))
fM = min(1, |heldThrough ∩ survivedIds| / max(1, |survivedIds|))
fQ = heldThroughQuietPeriod ? 1 : 0
weightBps = 10000 + floor( floor((5000 fD + 3000 fM + 2000 fQ)/10000) × 5000 / 10000 )     ∈ [10000, 15000]
score     = balance × weightBps
units     = floor( totalDaughterUnits × score / Σ score )
dust      = totalDaughterUnits − Σ units            (< number of wallets; burned)
```

`AllocationTable = { version, entries[{ wallet, bagUnits, bagFractionPpb, weightBps, sharePpb, units, leaf }], totalUnits, allocatedUnits, dustUnits, merkleRoot, leafCount }`,
entries sorted by wallet ascending (UTF-16 code-unit order).

Guarantees (property-tested, thousands of runs): deterministic from inputs
regardless of input order; every `units ≥ 0`; `Σ units + dust == totalUnits`
exactly; weight bounded; more duration or a bigger bag never decreases a
wallet's units with others fixed; **splitting a bag across wallets with the
same timing never increases the total received** (floor per wallet, dust
burned — a largest-remainder rule can leak one unit to a splitter and is
deliberately not used; the split loses at most one base unit).

Validation: non-empty snapshot, unique wallets, non-negative bigint
balances, `heldThroughQuietPeriod` only if `firstAcquiredAt ≤ quietPeriodStart`,
`collapseAt > bornAt`, at least one non-zero balance.

### Merkle commitment

* leaf = `sha256(canonicalJson({ wallet, units: units.toString() }))` (`allocationLeaf`)
* leaves in table order, padded to the next power of two (≥ 2) with
  `EMPTY_LEAF = sha256("qsd/allocation/empty-leaf/v1")`
* tree = `@qsd/crypto` `buildHashTree(leaves, ALLOCATION_TREE_SEED)` with
  `ALLOCATION_TREE_SEED = sha256("qsd/allocation/tree-seed/v1")` (RAND_HASH
  with public seed, the same construction as the identity tree)
* `allocationProof(table, wallet)` → `{ index, path: hex[] }` (leaf level first)
* `verifyAllocationProof(rootHex, { wallet, units }, proof)` → boolean, never throws
* `allocationRoot(entries)` recomputes the root from a deserialised table

## 7. What the chain package (`/packages/solana`) must supply

* **Clock**: every call takes `now`/`at` in unix seconds; the protocol never
  reads `Date`.
* **Coin records**: `supply.{totalUnits, remainingUnits, decimals}` kept
  current (burns reduce `remainingUnits`); `lastActivityAt` persisted from
  the returned `Coin` after every `applyBuy` / `applyMeasurement`.
* **Buys**: call `applyBuy` per buy with the buy value and market cap in
  lamports.
* **Measurement**: build inputs with `measurementInputs(coin, at)`, draw
  through `@qsd/quantum`, anchor `bundleHash`, then `applyMeasurement` with
  the same `at` and `verify` options (trusted witness keys). Auto-measure
  when `isAutoMeasureDue(coin, now)` with `by = PROTOCOL_PARAMS.AUTO_MEASURER_ID`.
* **Collapse execution**: `collapseRewards(remainingUnits)` (pay measurer,
  burn), the holder snapshot at the collapse block (`HolderSnapshot[]`,
  including `firstAcquiredAt` as the start of the current unbroken holding
  period, measurement ids held through, and the quiet-period flag), mint the
  daughter, `buildDaughterCoin`, `computeAllocation`, publish `merkleRoot`,
  airdrop `entries[].units`, burn `dustUnits`.
* **Tunnel**: nothing on-chain beyond anchoring the bundle; the coin
  continues as itself.

## 8. API surface

Parameters: `PROTOCOL_PARAMS`, `HALF_LIFE_PRESETS`, `maxWindowSec`, `BPS`, `PPM`, `PPB`.

Types: `Coin`, `CoinState`, `Channel`, `ParamRanges`, `CoinImage`,
`CoinSupply`, `Measurement`, `MeasurementInputs`, `MeasurementOutcome`,
`MeasurementBundle`, `HolderSnapshot`, `AllocationInput`, `AllocationEntry`,
`AllocationTable`, `AllocationProof`, `DaughterParams`, `MotherFinalState`,
`UnixSeconds`, `Hex`, `Address`, `Range`, `BigRange`.

Decay: `MEASURABLE_STATES`, `isMeasurable`, `quietSeconds`,
`decayProgressFor`, `decayProgress`, `decayProgressPpb`, `nextAutoMeasureAt`,
`isAutoMeasureDue`, `zenoResetBps`, `resetQuietTime`, `applyBuy`, `assertHalfLife`.

Resolver: `MEASUREMENT_RESOLVER_ID`, `RESOLVER_DRAW_BYTES`,
`measurementResolver`, `resolveMeasurement`, `outcomeLabel`, `parseOutcome`,
`validateChannels`, `validateMeasurementInputs`, `readU64`.

Measurement: `measurementInputs`, `applyMeasurement`, `collapseMeasurement`,
`survivedMeasurementIds`, `resolvePoolUnits`, `collapseRewards`, `surviveRebate`.

Daughter: `deriveDaughterParams`, `daughterParamsFrom`, `motherFinalState`,
`buildDaughterCoin`, `daughterName`, `baseName`, `GENERATION_SEPARATOR`,
`initialImageLineage`, `nextImageLineage`, `longevityBps`,
`generationPenaltyBps`, `daughterHalfLifeSec`, `bandWidthBps`, `daughterBand`.

Allocation: `computeAllocation`, `allocationProof`, `verifyAllocationProof`,
`allocationRoot`, `allocationLeaf`, `paddedLeaves`, `allocationTree`,
`entanglementWeightBps`, `durationScoreBps`, `measurementScoreBps`,
`compareWallets`, `weightToNumber`, `ALLOCATION_VERSION`,
`ALLOCATION_TREE_SEED(_HEX)`, `EMPTY_LEAF(_HEX)`.

Errors: `ProtocolError`, `InvalidStateError`, `BundleMismatchError`, `NotImplementedError`.

## 9. Tests

`pnpm --filter @qsd/protocol test` (vitest + fast-check, ≈ 25 s; most of it
is 40 000 dev-provider draws for the distribution checks):

* decay: curve points, bounds, monotonicity (property), ppb, auto-window presets
* Zeno: k and cap, monotone in buy size, never past `now`, exact floor
* resolver: id, determinism (property), exact byte usage with crafted words,
  thresholds at 0 and 1, channel and tunnel frequencies over 20 000
  dev-provider draws (±2 % abs; tunnel ±0.6 %), survive/collapse frequency
  at 0.3 and 0.75
* measurement: a bundle from `@qsd/quantum`'s client passes `verify()` with
  `measurementResolver`; survive/collapse/tunnel transitions; rejection of
  stale, foreign, re-indexed, wrong-resolver, tampered-outcome and
  tampered-bytes bundles; reward arithmetic
* daughter: bounded and monotone mapping (properties), worked points, names,
  image lineage chain, derivation from a collapsed coin
* allocation: normalisation, sybil (2-way and k-way), monotonicity,
  determinism (properties, thousands of runs); Merkle root reproducible,
  every proof verifies, tampered rows fail
* economics: every `PROTOCOL_PARAMS` constant appears in `/docs/economics.md`
  with the same value, and the document's worked examples reproduce to the unit
