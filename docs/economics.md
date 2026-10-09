# How QSD works: the rules and the numbers

This page is the public description of the QSD protocol rules. Every number
on it is a constant exported from the open-source `@qsd/protocol` package as
`PROTOCOL_PARAMS`, and a test in that package reads this file and fails if
any number here drifts from the code. The physics vocabulary (superposition,
measurement, Zeno, tunnelling, entanglement) names game rules inspired by
quantum mechanics; what those words do and do not mean is set out in
[physics.md](./physics.md), and nothing on this page claims more than that
page allows.

**These are protocol parameters, not laws.** They are versioned
(`qsd-protocol-params/v1`) and can change in a future protocol version. A
coin always runs under the parameters it was launched with.

## Parameters at a glance

| Constant | Value | Meaning |
| --- | --- | --- |
| `VERSION` | `qsd-protocol-params/v1` | Parameter set version |
| `HALF_LIFE_MIN_SEC` | 3600 | Shortest half-life (1 hour) |
| `HALF_LIFE_MAX_SEC` | 604800 | Longest half-life (7 days) |
| `AUTO_MEASURE_HALF_LIVES` | 2 | Auto-measurement window, in half-lives |
| `ZENO_K` | 4 | Zeno gain: quiet time removed per unit of buy/market-cap |
| `ZENO_RESET_CAP_BPS` | 5000 | Max quiet time one buy can remove (50 %) |
| `SURVIVE_RESET_BPS` | 7500 | Quiet time removed by a survived measurement (75 %) |
| `TUNNEL_PROBABILITY_PPM` | 25000 | Tunnelling probability on collapse (2.5 %) |
| `COLLAPSE_BURN_BPS` | 100 | Share of remaining supply removed on collapse (1 %) |
| `MEASURER_SHARE_OF_BURN_BPS` | 2000 | Share of the removed amount paid to the measurer (20 %) |
| `SURVIVE_FEE_REBATE_BPS` | 1000 | Measurement fee rebated on survive (10 %) |
| `AUTO_MEASURER_ID` | `protocol` | Recorded as the measurer on auto-measurement |
| `DAUGHTER_LIFETIME_REF_HALF_LIVES` | 6 | Lifetime at which the lifetime score saturates |
| `DAUGHTER_MEASUREMENTS_REF` | 5 | Survived measurements at which that score saturates |
| `DAUGHTER_W_LIFETIME_BPS` | 5000 | Weight of lifetime in the longevity score (50 %) |
| `DAUGHTER_W_MEASUREMENTS_BPS` | 3000 | Weight of survived measurements (30 %) |
| `DAUGHTER_W_SUPPLY_BPS` | 2000 | Weight of remaining supply (20 %) |
| `DAUGHTER_GENERATION_PENALTY_BPS` | 500 | Half-life penalty per generation after the first (5 %) |
| `DAUGHTER_GENERATION_PENALTY_CAP_BPS` | 5000 | Cap on the generation penalty (50 %) |
| `DAUGHTER_BAND_WIDTH_MIN_BPS` | 2000 | Tightest superposition band (20 % of the channel range) |
| `DAUGHTER_BAND_WIDTH_MAX_BPS` | 10000 | Widest superposition band (100 % of the channel range) |
| `ENTANGLEMENT_WEIGHT_MAX_BPS` | 15000 | Largest entanglement weight (1.5×) |
| `ALLOC_W_DURATION_BPS` | 5000 | Weight of holding duration in the entanglement weight (50 %) |
| `ALLOC_W_MEASUREMENTS_BPS` | 3000 | Weight of measurements held through (30 %) |
| `ALLOC_W_QUIET_BPS` | 2000 | Weight of holding through the final quiet period (20 %) |

`BPS` are basis points (10 000 = 100 %), `PPM` parts per million, `PPB`
parts per billion. The protocol computes everything in integers so that two
people running the code get the same answer to the last unit.

---

## 1. Half-life and decay

Every coin launches with a **half-life** `T`, chosen from the presets 1 h,
6 h, 24 h, 72 h or 7 d (daughters get a derived half-life, see §5). The
coin's **quiet time** `t` is how long it has gone without activity. Its
**decay progress** is

```
decayProgress(t) = 1 − 2^(−t / T)
```

Plainly: after one half-life of silence, half of the coin's "survival
probability" is gone (`0.5`); after two, three quarters (`0.75`); after
three, seven eighths (`0.875`). It never quite reaches 1 and it is never
zero while the coin is quiet. This is the same curve as radioactive decay.

It is a **half-life, not a timer**. Nothing happens when `t = T`. The number
only becomes an event when someone **measures** the coin (§3): at that
moment, the probability that the coin collapses is exactly its decay
progress. A coin measured after one half-life has a 50 % chance of
collapsing and a 50 % chance of surviving. Its *expected* lifetime follows
an exponential; its *actual* lifetime is resolved only by measurement.

A coin is **superposed** while it is quiet and decaying. The transient
states `measured-alive` (just survived a measurement) and `tunnelled` (just
tunnelled) are superposed for every rule on this page and settle back to
`superposed` on the next buy.

## 2. Buys are weak measurements: the Zeno mechanic

Each buy removes a fraction of the accumulated quiet time:

```
fractionRemoved = min( ZENO_RESET_CAP, ZENO_K × buyValue / marketCap )
                = min( 50 %, 4 × buyValue / marketCap )
quietTimeRemoved = floor( quietTimeBefore × fractionRemoved )    (the removed time is rounded down to whole seconds)
quietTimeAfter   = quietTimeBefore − quietTimeRemoved
```

Rounding is on the *removed* time, in the coin's favour:
7 s quiet and a 50 % reset remove 3 s and leave 4 s.

A buy worth 1 % of market cap removes 4 % of the quiet time; a buy worth
5 % removes 20 %; anything from 12.5 % of market cap upward hits the 50 %
cap. The reset is on *time*, not on decay progress directly: a coin that has
been quiet for 2 hours with a 1-hour half-life sits at `0.75`; a 5 % buy
takes it to 1 h 36 min quiet, `0.67`.

We call this the Zeno mechanic after the quantum Zeno effect, in which
frequent observation inhibits a transition. The resemblance is in the shape
only: a coin that keeps getting bought keeps getting pushed back toward
fresh, and a coin nobody touches drifts toward collapse. No quantum state is
being observed; see physics.md.

## 3. Measurement

**Who.** Anyone can measure a superposed coin. If nobody does, the protocol
measures it itself once the quiet time reaches
`AUTO_MEASURE_HALF_LIVES × T = 2 T` (decay progress `0.75`). Collapse can be
delayed by trading; it can never be avoided.

| Half-life preset | Auto-measurement after |
| --- | --- |
| 1 h | 2 h |
| 6 h | 12 h |
| 24 h | 48 h |
| 72 h | 144 h (6 d) |
| 7 d | 14 d |

**What happens.** A measurement draws 32 bytes from a hardware quantum
random number generator, with an attestation and a commitment hash that are
published in a proof bundle anyone can verify. The bytes are fed through the
public resolver `qsd/measurement/v2` together with the coin's state at that
moment:

| Draw bytes | Decides | Rule |
| --- | --- | --- |
| 0–7 | survive or collapse | collapse if `u/2^64 < decayProgress` |
| 8–15 | tunnel (only on collapse) | tunnel if `u/2^64 < 2.5 %` |
| 16–23 | decay channel (only on collapse, no tunnel) | weighted by each channel's published probability |
| 24–31 | daughter pool size (only on collapse, no tunnel) | a point in the mother's published supply band |

(`u` is the 8-byte big-endian unsigned integer.) The inputs — coin address
(`ca`), the measurement moment `at`, the coin's quiet-clock origin
`lastActivityAt` and `halfLifeSec`, the decay progress in parts per billion
(`decayProgressPpb`, which must equal `1 − 2^(−(at − lastActivityAt)/halfLifeSec)`
rounded down to a billionth), the channel table, the tunnelling probability
and the measurement index — are hashed into the bundle and committed on-chain
*before* the draw. So a verifier can see what was drawn, what it was applied
to, and *when*: the moment of a measurement is fixed before anyone knows the
bytes, and a bundle can only be applied at the `at` it carries. (The earlier
resolver `qsd/measurement/v1` did not bind the moment; it is retired and
bundles carrying it are refused.)

**Survive.** The coin stays alive, 75 % (`SURVIVE_RESET_BPS`) of its quiet
time is removed, and it enters `measured-alive`. The measurer gets 10 %
(`SURVIVE_FEE_REBATE_BPS`) of their measurement fee back.

**Collapse.** The coin enters `collapsed`, decay progress is 1 for good, and
the same draw has already chosen the decay channel and the daughter pool
size. 1 % (`COLLAPSE_BURN_BPS`) of the mother's remaining supply is removed
from circulation out of the protocol reserve; 20 %
(`MEASURER_SHARE_OF_BURN_BPS`) of that removed amount — 0.2 % of remaining
supply — is paid to the measurer and the other 80 % is burned. All
divisions round down; the measurer's units plus the burned units equal the
removed amount exactly.

**Tunnel.** On 2.5 % (`TUNNEL_PROBABILITY_PPM`) of collapses, decided by
bytes 8–15 of the same draw, the coin does not produce a daughter. It
re-emerges as *itself*: same address, same holders, same generation, quiet
clock reset to zero, state `tunnelled`. Nothing is burned and no reward is
paid. It is there so that "this coin is definitely dead" is never quite
certain.

## 4. Daughters

When a coin collapses without tunnelling, a daughter is born. Its name is
the mother's name with a generation suffix after a middle dot
(`PHOTON·2`, `PHOTON·3`, …), it shares the mother's lineage id, records the
mother's address, and carries an image lineage hash
`sha256(motherLineage ‖ motherImageHash)` chained from the original launch
image. It inherits the lineage's channel table unchanged.

## 5. Daughter parameters are a function of how the mother died

First a **longevity score** `L` in `[0, 1]` is computed from the mother's
final state:

| Input | Score | Saturates at |
| --- | --- | --- |
| lifetime (birth → collapse) | `fL = min(1, lifetime / (6 T))` | 6 half-lives |
| measurements survived | `fM = min(1, survived / 5)` | 5 survives |
| supply remaining | `fS = remaining / total` | all of it |

```
L = 0.5 fL + 0.3 fM + 0.2 fS
```

Then, inside the ranges the selected channel published for its daughter:

```
halfLife   = clamp( lerp(channel.halfLife.min, channel.halfLife.max, L) × (1 − generationPenalty),
                    HALF_LIFE_MIN_SEC, HALF_LIFE_MAX_SEC )
generationPenalty = min( 50 %, 5 % × (daughterGeneration − 1) )     (generation 2: 5 %, 3: 10 %, …, 11+: 50 %)

bandWidth  = 100 % − 80 % × L          (fraction of the channel's pool range: 100 % at L = 0, 20 % at L = 1)
band       = the interval of that width centred on the channel's pool midpoint
```

| Mother | `L` | Daughter half-life | Daughter band |
| --- | --- | --- | --- |
| died fast, few survives, little supply left | 0 | channel minimum | the channel's full range |
| lived ≥ 6 half-lives, ≥ 5 survives, all supply | 1 | channel maximum (minus generation penalty) | 20 % of the range, centred |
| anything between | linear | linear between | linear between |

Longer life, more survives and more remaining supply never shorten the
daughter's half-life and never widen its band; later generations never get
a longer half-life than earlier ones from the same state. All outputs are
clamped. Example: a 1-hour mother that lived 3 half-lives, survived 2
measurements and kept 50 % of its supply scores
`0.5 × 0.5 + 0.3 × 0.4 + 0.2 × 0.5 = 0.47`.

The daughter's **band** is its superposition: the range of daughter units
that will be reserved for the mother's holders when *it* collapses. The
exact pool is resolved inside the band by bytes 24–31 of its collapse draw.

## 6. Allocation: who gets the daughter

Every holder of the mother at the collapse block gets a share of the
daughter pool. The share is the holder's bag fraction times an
**entanglement weight** between 1.0 and 1.5:

```
fD = min(1, timeHeld / motherLifetime)         continuous: 1 if held since launch
fM = min(1, survivesHeldThrough / survivesTotal)   survived measurements the wallet held through
fQ = 1 if the wallet held through the final quiet period, else 0

weight = 1 + 0.5 × ( 0.5 fD + 0.3 fM + 0.2 fQ )          ∈ [1.0, 1.5]
score  = bag × weight
units  = floor( pool × score / Σ score )
```

The weight is computed per wallet in basis points (10 000 = 1.0×,
15 000 = 1.5×), every division rounds down, and whatever rounding leaves
over (fewer units than there are wallets) is burned. `timeHeld` is the
wallet's current unbroken holding period; selling and rebuying restarts it.
If the mother was never measured, `fM` is 0 for everyone.

### Worked example 1

Mother born at `t = 0`, collapsed at `t = 100 000 s`, final quiet period
started at `t = 80 000`, two survived measurements (`m1`, `m2`). Daughter
pool: 1 000 000 000 units.

| Wallet | Bag | Held since | Held through | Quiet period | fD | fM | fQ | weight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 600 | 0 | m1, m2 | yes | 1.0 | 1.0 | 1 | 1 + 0.5 × 1.0 = **1.5000** |
| B | 300 | 50 000 | m2 | yes | 0.5 | 0.5 | 1 | 1 + 0.5 × (0.25 + 0.15 + 0.2) = **1.3000** |
| C | 100 | 90 000 | — | no | 0.1 | 0 | 0 | 1 + 0.5 × 0.05 = **1.0250** |

Scores: A `600 × 15000 = 9 000 000`, B `300 × 13000 = 3 900 000`,
C `100 × 10250 = 1 025 000`; total `13 925 000`.

| Wallet | Bag share | Units = floor(10⁹ × score / 13 925 000) | Daughter share |
| --- | --- | --- | --- |
| A | 60.0 % | **646 319 569** | 64.63 % |
| B | 30.0 % | **280 071 813** | 28.01 % |
| C | 10.0 % | **73 608 617** | 7.36 % |
| burned dust | | 1 | |

`646 319 569 + 280 071 813 + 73 608 617 + 1 = 1 000 000 000`.

### Worked example 2: a late whale versus early hands

Same mother. A wallet that bought 900 of the 1 000 units 5 000 s before
collapse (`fD = 0.05`, no measurements, not through the quiet period) has
weight `1 + 0.5 × 0.025 = 1.0125`. A wallet that held 100 units since
launch through everything has weight 1.5.

Scores `900 × 10125 = 9 112 500` and `100 × 15000 = 1 500 000`, total
`10 612 500`:

| Wallet | Bag share | Units | Daughter share |
| --- | --- | --- | --- |
| Whale | 90 % | **858 657 243** | 85.87 % |
| Hands | 10 % | **141 342 756** | 14.13 % |
| burned dust | | 1 | |

Bag size still dominates; behaviour moves the result by up to 1.5× per
wallet and no more.

### Why splitting a bag does not help (sybil resistance)

The weight is computed per wallet from that wallet's own timing, and it is
capped at 1.5. Two wallets with the same timing get the same weight, so a
bag `B` split into `B₁ + B₂ = B` has score `B₁w + B₂w = Bw` — exactly the
score of the unsplit bag. Because every wallet's units are rounded *down*
separately, the two pieces together receive at most what the whole bag
would have (`floor(x) + floor(y) ≤ floor(x + y)`), and at most one base unit
less. In worked example 1, splitting A into 400 and 200 gives
`430 879 712 + 215 439 856 = 646 319 568`, one unit less than the
646 319 569 A received whole. A largest-remainder rounding would have let a
splitter pick up a unit of dust; that is why the dust is burned instead.
The protocol package carries a property test over thousands of random
snapshots that splitting never increases the total.

### The Merkle commitment

The table is sorted by wallet address, each row becomes a leaf
`sha256(canonicalJSON({ wallet, units }))` with `units` written as a decimal
string, the list is padded to a power of two (at least 2) with the constant
leaf `sha256("qsd/allocation/empty-leaf/v1")`, and the leaves are fused
pairwise with the same keyed tree hash the launch identities use
(`@qsd/crypto`, public seed `sha256("qsd/allocation/tree-seed/v1")`). The
root is published with the collapse. Any holder can check their row against
the root with their sibling path and no trust in us, using
`verifyAllocationProof` from `@qsd/protocol`.
