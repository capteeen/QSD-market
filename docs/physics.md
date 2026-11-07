# The physics behind QSD, honestly

QSD — Quantum State Decay — is a token launchpad whose game mechanics are
*inspired by* quantum mechanics and whose randomness comes from a *real*
quantum random number generator. Those are two different claims and we keep
them separate on this page.

The short version, which every other page on this site must agree with:

- **The randomness is genuinely quantum.** Every measurement of a coin
  consumes bytes from a hardware quantum random number generator operated by
  a third-party provider, and every outcome ships with a proof bundle that
  anyone can check against QSD's published witness key. What the bundle
  proves is our signed record of the provider's response and what we did
  with it — not the photons, and not that it was the only draw we made. The
  section *Why quantum randomness is different from pseudorandomness* spells
  out exactly where the trust sits.
- **The coins are not quantum objects.** A token on Solana is a row in a
  ledger. It is not in a superposition, it does not collapse, it is not
  entangled with anything, and nothing tunnels. When we use those words we
  are naming game rules that borrow the *shape* of the physics. Each section
  below says exactly where the analogy starts and where it stops.

If you ever see copy on qsd.market that claims more than this page allows,
that copy is wrong and this page wins.

---

## Superposition

### What the physics says

A quantum system does not have to be in one definite state. It can be in a
*superposition*: a combination of several states at once, each with a
complex-valued weight called an amplitude. The squared magnitude of each
amplitude is the probability of finding the system in that state *if you
measure it*. In the standard textbook account, until you measure there is no
fact of the matter about which state it is "really" in; the superposition is
the complete description. Experiments (Bell tests) rule out the simplest
versions of "it was always secretly one or the other" — any theory that
reproduces them has to give something up, locality or determinism or both —
but they do not single out one interpretation, and QSD does not either.

### How QSD uses it as a mechanic

A newly launched coin is in the game state `superposed`. In that state some
of its parameters are published as *ranges* rather than single numbers:
a supply band `[supplyMin, supplyMax]`, and a set of *decay channels*, each
with a probability and a range of parameters for the daughter coin it would
produce. The UI draws this as a probability cloud. While the coin is
superposed, nobody — including us — knows which channel it will take,
because that decision has not been made and the input that will decide it
(the quantum draw) has not been generated yet.

### What QSD does NOT claim

- The coin is not physically in a superposition. The ranges are ordinary
  published numbers; the "cloud" is a visualisation of a probability
  distribution we wrote down.
- There are no amplitudes, no interference, no phase. Channel probabilities
  are plain classical probabilities that sum to 1.
- "Superposed" is a word for *undecided and bound to a future quantum draw*.
  It is a game state in a database, not a quantum state.

---

## Measurement and collapse

### What the physics says

Measuring a quantum system in superposition yields exactly one of the
possible outcomes, with the probabilities given by the amplitudes. After the
measurement the system is in the state corresponding to the outcome; the
other possibilities are gone. This transition is called *collapse* (in the
standard textbook account; other interpretations describe the same
predictions differently, and QSD takes no position on interpretation). Which
outcome you get is, in the standard account, not determined by anything that
existed before the measurement; interpretations that keep determinism do so
at the price of non-locality, and no known interpretation lets anyone
*predict* the outcome in advance. In practice it is random.

### How QSD uses it as a mechanic

Anyone can *measure* a superposed coin. A measurement does the following,
in order, and the 3D scene renders each step only when it actually happens:

1. **Entropy is requested** from the quantum random number provider
   (`entropyRequested`).
2. **Raw bytes arrive** together with the provider's response and an
   attestation (`entropyArrived`).
3. A **commitment hash** is computed over the provider id, the request
   time, the bytes and the attestation (`commitmentComputed`). This hash is
   what gets anchored on-chain.
4. The bytes are fed through a **public, deterministic resolver** together
   with the coin's current state (decay progress, channel table, tunnelling
   probability). The resolver returns the outcome: *survive*, *collapse into
   channel k*, or *tunnel* (`outcomeResolved`).

The outcome is binding. "Collapse" moves the coin to the `collapsed` game
state and triggers the birth of a daughter coin. The whole thing — bytes,
attestation, commitment, inputs, outcome — is packaged as a **proof bundle**
that anyone can re-verify with `verify()` from the open-source `@qsd/quantum`
package, with no account, trusting only the published QSD witness key (see
*where the trust actually sits*, below).

The *randomness* in step 2 is the genuinely quantum part. The provider's
hardware performs a physical quantum measurement (for example, measuring
vacuum fluctuations of the electromagnetic field, or which path a photon
takes), and the bytes are the digitised results of those measurements. That
is the only place real quantum physics enters QSD.

### What QSD does NOT claim

- Measuring a coin does not perform a quantum measurement *on the coin*. It
  performs one in the provider's lab, on photons or a vacuum mode, and we
  apply the result to the coin via an ordinary function.
- The resolver is deterministic. Given the same bytes and the same inputs
  it always returns the same outcome. That is a feature (it makes outcomes
  verifiable), and it means the only non-determinism is in the bytes.
- "Collapse" of a coin is a state change in our protocol, not a physical
  event.
- We do not claim the provider's bytes are "perfectly" random. We claim
  they come from a quantum physical process, that the provider says so, and
  that the proof bundle records exactly what we received. See the QRNG
  section for what the attestation does and does not prove.

---

## The quantum Zeno effect

### What the physics says

If you measure a quantum system very frequently, you can inhibit its
evolution. A system that would normally decay or transition from state A to
state B gets repeatedly projected back onto A by each measurement, because
shortly after a measurement the probability of having moved is tiny, and
each measurement "resets" it. In the limit of continuous observation the
transition is suppressed entirely — the "watched pot never boils" effect.
This is a real, experimentally confirmed phenomenon (first clearly shown in
trapped ions in 1990). Its mirror image, the anti-Zeno effect, where
measurement at certain intervals *accelerates* decay, is also real.

### How QSD uses it as a mechanic

A coin's `decayProgress` rises with time since its last trade, according to a
half-life published at launch. Every buy *partially resets* decay progress,
by an amount proportional to the buy size relative to market cap and capped
per trade. We call trades "weak measurements" and this reset the **Zeno
mechanic**: a coin that is constantly being bought keeps getting pushed back
toward "fresh" and is very unlikely to fully decay. A coin nobody touches
drifts toward collapse. The exact formula lives in the protocol
documentation.

### What QSD does NOT claim

- A buy is not a quantum measurement and the reset is not a projection. It
  is an arithmetic update to a number in our state machine. The term "weak
  measurement" is borrowed vocabulary, not a claim that anything is weakly
  measured in the physical sense.
- Trading does not freeze a quantum state. It resets a timer-like quantity.
  The analogy is only in the *shape*: frequent intervention keeps the system
  near its starting state.
- The half-life decay is a classical exponential model. There is no
  Hamiltonian, no quantum evolution being inhibited.

---

## Entanglement

### What the physics says

Two quantum systems are entangled when their joint state cannot be written
as a product of individual states. Measuring one then gives results that are
correlated with measurements on the other in a way that no classical model
of pre-agreed values can reproduce — this is what Bell inequality violations
show, and it has been confirmed experimentally many times, including with
the detectors far enough apart that no signal could travel between them
during the measurement. Entanglement does **not** allow faster-than-light
communication: looking at one particle alone shows pure randomness; the
correlation is only visible when you compare both sets of results.

### How QSD uses it as a mechanic

We use the word "entangled" for two places where one value is a *fixed
function* of another, so they can never disagree:

1. **Daughter parameters are entangled with the mother's death.** When a
   mother collapses (and does not tunnel), the daughter's half-life,
   superposition width and other launch parameters are computed
   deterministically from the mother's final state: how fast it decayed,
   how many measurements it survived, how much supply remained, and its
   generation. A fast death produces a short-lived, wide-band daughter; a
   long survival produces a long-lived, tight-band one.
2. **Allocation is entangled with holding behaviour.** Each holder's share
   of the daughter is their bag fraction times an *entanglement weight* in
   `[1.0, 1.5]`, computed from how long they held, how many measurements
   they held through, and whether they held through the final quiet period.
   The weights are a deterministic function of the holder snapshot, the
   table is normalised to 100%, and its Merkle root is published so the
   airdrop can be checked.

In both cases, "entangled" means *correlated by construction and verifiable
by recomputation*.

### What QSD does NOT claim

- There is no non-local correlation. The daughter and mother are not
  physically linked; the daughter's parameters are just an output of a
  public function of the mother's recorded history.
- No Bell inequality is violated, and we are not claiming anything that
  could not be reproduced by a classical computer given the same inputs.
  In fact that is the point: anyone *can* reproduce it.
- Holding a coin does not entangle your wallet with anything. The
  "entanglement weight" is a bounded, per-wallet scoring formula.

---

## Tunnelling

### What the physics says

In quantum mechanics a particle can be found on the far side of a potential
barrier even when it does not have enough energy to go over it. The
particle's wavefunction does not stop at the barrier; it decays
exponentially inside it, and if the barrier is thin enough a small but
nonzero amplitude leaks through. This is not a loophole or an approximation
— it is why the Sun shines (nuclear fusion at temperatures where classical
physics says nuclei could not get close enough), how flash memory and
scanning tunnelling microscopes work, and why some radioactive nuclei decay
by alpha emission.

### How QSD uses it as a mechanic

When a measurement resolves to *collapse*, the same quantum draw is also
used to decide a second, small fixed-probability event we call
**tunnelling**: instead of producing a daughter, the coin re-emerges as
*itself*, back in the `superposed` state, with every holder's position
intact. The tunnelling probability is a published constant in the protocol
documentation. It exists to make "this coin is definitely dead" never quite
certain, which mirrors the physical fact that a barrier is never perfectly
opaque.

### What QSD does NOT claim

- Nothing physically tunnels. No token crosses any barrier. "Tunnelling" is
  the name of one branch of the resolver function.
- The probability is a constant we chose, not something derived from a
  barrier height or width.
- Tunnelling is decided by the same bytes as the collapse, so it is exactly
  as verifiable as the collapse — and exactly as classical in its
  application.

---

## Why quantum randomness is different from pseudorandomness

### What the physics says

A **pseudorandom number generator (PRNG)** is a deterministic algorithm.
You give it a seed — a short secret — and it expands that seed into a long
stream of numbers that *look* random. Anyone who knows the seed and the
algorithm can reproduce the entire stream, forwards and sometimes backwards.
Cryptographic PRNGs are designed so that *without* the seed the stream is
computationally indistinguishable from random, and that is good enough for
most purposes. But the information content is only ever the seed: the
stream has no entropy of its own.

A **quantum random number generator (QRNG)** instead digitises the outcomes
of a physical quantum measurement — for example the quadrature of a vacuum
state of light, the arrival time of single photons, or which of two paths a
photon takes at a beam splitter. According to quantum mechanics these
outcomes are not determined by any prior state of the universe, so there is
no seed to learn. In a real device the quantum signal is mixed with ordinary
classical noise from the detectors and electronics, and the raw samples go
through deterministic post-processing — a randomness extractor — to produce
uniform bytes; how unpredictable the output is therefore rests on the
device's entropy model and calibration, not on quantum mechanics alone. Done
properly, each byte carries fresh entropy from the physical world that no
one, including the operator, had access to before it was produced.

That is the difference: a PRNG *hides* a deterministic value; a QRNG
*harvests* a non-deterministic one (and then cleans it up).

### How QSD uses it as a mechanic

Every measurement of every coin consumes bytes drawn live from a
third-party QRNG service. QSD never generates its own randomness for
outcomes, never caches bytes for reuse, and has **no deterministic fallback
in production**: if the provider cannot be reached, measurement is
unavailable and the interface says so plainly. The only non-quantum
provider in the codebase is named `UNSAFE_DEV_RANDOM`, exists for local
tests, and is built so that it cannot be constructed or used when
`NODE_ENV=production` — or when `NODE_ENV` is missing, misspelt, or the
code is running somewhere with no environment at all. It is permitted only
with positive evidence of a test or development environment. That guard is
itself covered by tests.

### What QSD does NOT claim — and where the trust actually sits

This is the most important honesty note on the page.

QSD does not perform the quantum measurement itself. A provider does. So
what you can verify from a proof bundle is:

- **That these exact bytes were applied to these exact inputs and produced
  this exact outcome.** The resolver is public and deterministic; you rerun
  it.
- **That the bundle has not been altered since it was formed.** The
  commitment hash and the inputs hash both recompute, and the attestation
  signature checks against the stated public key.
- **What the provider's response was, verbatim**, including its timestamps
  and request identifiers, because the attestation captures it.

What you *cannot* verify from the bundle alone is that the provider's
hardware is a working QRNG and was not substituted for a PRNG on the day in
question. Nobody downstream of a QRNG service can verify that; it rests on
the provider's reputation, their published certifications, and (where the
provider offers one) their own cryptographic signature over the response.

Two more things a bundle cannot show on its own, and we want them in plain
sight:

- **That the published draw was the only draw.** An operator holding the
  witness key could request several draws for the same measurement and
  publish the one it likes ("grinding"). To make that detectable rather than
  invisible, every draw is bound to the measurement before it is requested:
  the hash of the inputs and a per-measurement nonce are included in the
  witness statement and the commitment, and the protocol anchors that pair
  on-chain *before* asking the provider for bytes. A verifier compares the
  anchored pair with the bundle; a second draw for the same inputs would
  need a second anchor, visible to everyone, or a bundle that does not match
  the anchor. This raises the cost of grinding from zero to "leave public
  evidence"; it does not make it physically impossible, and we do not claim
  it does.
- **When it happened.** The `requestedAt` and `receivedAt` timestamps are
  asserted by the witness (QSD), not by the provider. The provider's own
  `date` header and request id are captured alongside, and the on-chain
  anchors carry block times, so a wrong timestamp is contradictable, but the
  bundle's timestamps are our statement, not a proof.

The attestation inside each bundle is therefore one of two kinds, and the
bundle says which:

- **`provider-signed`** — the provider itself signed the response with a
  published key. Verifying the signature proves the bytes came from the
  provider. This is the stronger form, and QSD uses it whenever a provider
  offers it.
- **`witness-signed`** — the provider's response (body and relevant
  headers) was captured verbatim over TLS, and the QSD protocol key signed
  a statement binding the provider id, the request time, the hash of that
  response, and the inputs hash and nonce of the measurement it was requested
  for. Verifying the signature proves that *QSD's key* attests to
  having received that response at that time. It does **not** by itself
  prove the provider sent it; you are trusting QSD's witness statement
  about what came over the TLS connection. We publish the protocol public
  key, and the captured response can be compared against the provider's
  own logs if a dispute ever arises.

The `@qsd/quantum` README states which provider is live and which
attestation kind it produces. The UI shows the attestation kind on every
collapse. We will not describe a witness-signed bundle as "provider-signed",
and we will not describe either as proof that the physics happened — only
as proof of what we received and what we did with it.

---

## Summary table

| Term in QSD | Real physics it is named after | What it actually is in QSD |
|---|---|---|
| Superposed | A state with multiple amplitudes | Published parameter ranges, outcome not yet drawn |
| Measurement | Projective measurement yielding one outcome | A live QRNG draw fed through a public deterministic resolver |
| Collapse | Post-measurement state reduction | Game-state transition `superposed → collapsed`, daughter is born |
| Zeno mechanic | Frequent measurement inhibiting evolution | Buys partially reset a decay counter |
| Entangled | Non-separable joint state, Bell correlations | A value that is a fixed public function of another value |
| Tunnelling | Barrier penetration via wavefunction leakage | A small fixed-probability branch of the resolver, same draw |
| Quantum randomness | Outcomes of a physical quantum measurement | Bytes from a third-party QRNG, with attestation, no fallback |

The physics in the left and middle columns is real and we have tried to
describe it accurately. The right column is what we built. Only the last
row touches actual quantum mechanics, and even there, what you verify is
our record of the provider's response — not the photons.
