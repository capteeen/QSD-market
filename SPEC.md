# QSD — Quantum State Decay · qsd.market
# BUILD INSTRUCTIONS FOR CLAUDE CODE

You are the lead engineer on qsd-market. Read this entire file before writing
any code, then write it to SPEC.md at the repo root so it survives across
sessions. Re-read SPEC.md at the start of every session.

You will run this build as a TEAM OF SUBAGENTS working in parallel. Spawn them
with the Agent tool, give each one its section of this spec verbatim, and act
as integrator and reviewer. Do not build everything yourself serially.

═══════════════════════════════════════════════════════════════════════════
0. WHAT WE ARE BUILDING
═══════════════════════════════════════════════════════════════════════════

A pump.fun launchpad on Solana with one headline mechanic:

  A coin that stops trading does not die. It decays, and when it fully
  decays it AUTOMATICALLY launches a daughter coin. Every holder of the
  mother receives a proportional share of the daughter at birth. The
  holder's position survives the coin.

Everything else serves that. The quantum layer makes it fair and verifiable:
coins exist in superposition until measured; measurement uses a real quantum
random number generator with on-chain proof; daughter parameters are entangled
with how the mother died; allocations are entangled with holding behaviour.
Launch identities use hash-based WOTS + Merkle signatures.

The UI is the product. Every cryptographic and quantum step is rendered as a
transparent glass-and-light 3D sequence where every visual corresponds to a
real operation. The user should feel like they are operating a quantum
computer.

LIVE DATA ONLY. No mock coins, no fake holders, no simulated collapses, no
seed scripts producing fictional data. Empty states render empty and honest.

═══════════════════════════════════════════════════════════════════════════
1. TEAM STRUCTURE — spawn these agents, in this order
═══════════════════════════════════════════════════════════════════════════

Spawn the first three in parallel immediately. They have no dependencies on
each other. Spawn the rest as their dependencies complete.

AGENT A — "crypto"       Owns /packages/crypto. Section 3.
AGENT B — "quantum"      Owns /packages/quantum. Section 4.
AGENT C — "design"       Owns /packages/ui-tokens and the design system.
                         Section 6.
AGENT D — "visual"       Owns /packages/scene (the 3D launch sequence).
                         Section 7. Depends on A, B, C.
AGENT E — "protocol"     Owns /packages/protocol (decay, measurement,
                         daughter, allocation logic). Section 5. Depends on
                         A, B.
AGENT F — "app"          Owns /apps/web (Next.js pages, routes, data).
                         Section 8. Depends on C, D, E.
AGENT G — "chain"        Owns /packages/solana (pump.fun, DAS, burns).
                         Section 9. Depends on E.
AGENT H — "verify"       Owns /tests and /docs. Section 10. Starts when A
                         and B finish and runs continuously after. This
                         agent has NOT seen the code being written and
                         reviews everything adversarially.

RULES FOR ALL AGENTS
- Each agent writes only inside its owned directory, plus its tests.
- Each agent exposes a typed public API in its package index and documents
  it in a README in the package.
- No agent may stub, fake, or hardcode a value that the spec says must be
  computed. If something can't be done yet, it throws a clear NotImplemented
  with the reason, and the agent reports it to you.
- Every agent runs its own tests before reporting done. "Done" means tests
  pass, not that files exist.
- You, the integrator, review every agent's output against this spec
  before merging. If a visual doesn't match a real operation, if a crypto
  function is wrong, if the physics is misrepresented — reject it and send
  it back with the specific line of this spec it violates.

Monorepo: pnpm workspaces + Turborepo. TypeScript strict everywhere.
/apps/web, /packages/{crypto,quantum,protocol,scene,ui-tokens,solana}.

═══════════════════════════════════════════════════════════════════════════
2. NON-NEGOTIABLE QUALITY BARS (every agent reads this)
═══════════════════════════════════════════════════════════════════════════

CORRECTNESS OVER SPEED. A wrong hash chain rendered beautifully is a failure.
- Crypto must match published test vectors. If WOTS+ or the Merkle scheme
  can't be verified against a reference implementation, it isn't done.
- Physics must be represented truthfully. Superposition, measurement,
  collapse, entanglement, the Zeno effect and tunnelling are used as
  mechanics; the copy and visuals may not claim things quantum mechanics
  doesn't say. Agent H checks every user-facing physics claim against
  /docs/physics.md, which Agent B writes first.
- Every 3D visual maps to a real computed value. The scene package consumes
  live values from the crypto and quantum packages running in parallel; it
  never plays a canned animation while the real math happens elsewhere.
- 60fps on a mid-range phone. Agent D proves this with a frame-time test on
  a throttled profile, not by assertion.
- Nothing invented. If a holder count, a price, or a proof is unavailable,
  the UI says so. No placeholder numbers, ever.

═══════════════════════════════════════════════════════════════════════════
3. AGENT A — CRYPTO  (/packages/crypto)
═══════════════════════════════════════════════════════════════════════════

Implement hash-based signatures, faithfully, with step-by-step observability
so the scene can render them.

- WOTS+ with w=16 over SHA-256. 67 chains (64 message + 3 checksum), each
  16 links. Reference: RFC 8391 (XMSS) WOTS+ construction. Match the RFC's
  test vectors; include them in tests.
- Merkle tree of height 8 (256 leaves) binding one-time keys to a single
  root. Authentication path generation and verification.
- Identity = Merkle root. One-time key index tracking with persistent state:
  a used leaf can NEVER be reused. Reuse attempts throw. Agent H will try to
  trigger reuse.
- Key derivation from a seed using a KDF; seed is never logged.
- EVERY operation emits ordered progress events through an observable
  interface: chainStep(chainIdx, depth, hash), chainComplete, leafFormed,
  treeLevelFused(level, left, right, parent), rootReady(root),
  signChainStop(chainIdx, depth), authPathNode(level, hash),
  signatureReady(bytes). The scene package subscribes to these. Events carry
  real hash values. This is how "every visual is a real operation" is
  enforced.
- Sizes must match reality: signature ~2.4KB, report exact.
- Tests: RFC vectors, sign/verify round trip, tamper detection, reuse
  rejection, event ordering, deterministic output from a fixed seed.
- README: the math in plain language, what each event means, limits.

═══════════════════════════════════════════════════════════════════════════
4. AGENT B — QUANTUM  (/packages/quantum)
═══════════════════════════════════════════════════════════════════════════

Own the randomness source and the physics documentation.

- QRNG client with a pluggable provider interface. Implement at least one
  real provider against a commercial quantum random number API that returns
  signed attestations (research current options; the integrator will supply
  the API key via env). Each draw returns: raw bytes, provider id, request
  timestamp, provider signature/attestation, and a locally computed
  commitment hash. No draw is accepted without an attestation.
- Deterministic fallback is FORBIDDEN in production. If the provider is
  unreachable, measurement is unavailable and the UI must say so. A
  dev-only provider exists for local tests, clearly named UNSAFE_DEV_RANDOM,
  and is impossible to enable when NODE_ENV=production (test this).
- Proof bundle format: a JSON structure holding the draw, attestation,
  commitment, the inputs it was applied to, and the outcome. A verify()
  function that anyone can run on a bundle. This is what gets anchored
  on-chain and shown on every collapse.
- Progress events for the scene: entropyRequested, entropyArrived(bytes,
  attestation), commitmentComputed(hash), outcomeResolved(value).
- /docs/physics.md — written FIRST, before code. Plain-English, accurate
  explanations of: superposition, measurement and collapse, the quantum Zeno
  effect, entanglement, tunnelling, and why QRNG output differs from
  pseudorandomness. For each, state exactly how QSD uses it as a mechanic
  and exactly what QSD does NOT claim. Agent H uses this as the ground truth
  for every physics claim in the product. Be honest: these are mechanics
  inspired by the physics, running on genuinely quantum randomness; the
  coins are not quantum objects.
- Tests: attestation rejection on bad signature, production fallback
  impossibility, proof bundle round trip, verify() against tampered bundles.

═══════════════════════════════════════════════════════════════════════════
5. AGENT E — PROTOCOL  (/packages/protocol)
═══════════════════════════════════════════════════════════════════════════

The game rules. Pure TypeScript, no I/O, fully unit-tested, consumed by the
app and the chain package.

COIN STATE
  Coin { ca, name, ticker, image, lineageId, generation, motherCa?,
         daughterCa?, identityRoot, halfLifeSec, decayProgress 0..1,
         decayChannels: Channel[], superposition: { supplyMin, supplyMax },
         state: 'superposed'|'measured-alive'|'collapsed'|'tunnelled',
         lastActivityAt, measurements: Measurement[], bornAt }
  Channel { id, probability, daughterParams: ParamRanges, label }
  Measurement { id, at, by, proofBundle, outcome, decayBefore, decayAfter }

DECAY
- A coin's decay probability per interval is derived from halfLifeSec and
  time since lastActivityAt. Document the formula; it's a half-life, not a
  timer: expected lifetime follows an exponential, actual lifetime is only
  resolved by measurement.
- Trading is weak measurement: each buy resets decayProgress by a fraction
  proportional to buy size relative to market cap, capped. Document as the
  Zeno mechanic.

MEASUREMENT
- Anyone may measure a coin in 'superposed' state. Measuring consumes one
  QRNG draw (Agent B). Outcome: survive (decayProgress resets partially) or
  collapse (coin moves to 'collapsed', a channel is selected by the same
  draw, weighted by channel probability).
- Measurer reward: a fixed fraction of supply burned on collapse, or a small
  fee rebate on survive. Document the numbers in /docs/economics.md.
- Auto-measurement: if no one measures within maxWindowSec, the protocol
  measures. Collapse can be delayed, never avoided.
- Tunnelling: on collapse, a small fixed probability (document it) that the
  coin returns to 'superposed' as itself with all holders intact instead of
  producing a daughter. Same draw decides it.

DAUGHTER
- On collapse (non-tunnel), compute daughter params from the mother's final
  state: collapse speed, measurements survived, supply remaining, generation.
  Fast death → shorter half-life, wider superposition. Long survival →
  longer half-life, tighter band. Document the mapping; Agent H checks it
  is monotonic and bounded.
- Daughter inherits name with generation suffix (NAME·2), lineageId,
  motherCa, and the mother's image hash lineage.

ALLOCATION (the headline — get this exactly right)
- Input: snapshot of mother holders at collapse block (Agent G supplies).
- Each holder's daughter share = bag fraction × entanglement weight.
  entanglement weight ∈ [1.0, 1.5], from: duration held (continuous), number
  of measurements held through, whether held through the final quiet
  period. Fully documented formula in /docs/economics.md with worked
  examples. Must be: deterministic from inputs, sum-normalized so shares
  total 100%, and strictly non-negative. Sybil note: weight is per-wallet
  and bounded, so splitting a bag never increases total allocation —
  Agent H must prove this with a property test.
- Output: an allocation table with per-wallet shares and a Merkle root of
  the table (reuse Agent A's tree) so the airdrop is verifiable.

TESTS: property-based tests for allocation (normalization, sybil-resistance,
monotonicity in holding duration), decay formula bounds, channel selection
distribution matches probabilities over many draws (using the dev provider),
tunnelling frequency, daughter param mapping bounds.

═══════════════════════════════════════════════════════════════════════════
6. AGENT C — DESIGN SYSTEM  (/packages/ui-tokens)
═══════════════════════════════════════════════════════════════════════════

Aesthetic: a quantum computer rendered as light in a void. Dark-field
laboratory. Glass and refraction. Clinical restraint in the chrome,
spectacle in the chamber.

TOKENS
  void        #06080A     panel #0D1117     border #1C2430
  probability #4DD0E1     collapse #E91E63  decay #FFB300
  tunnel      #F0F4F8     dead #3A4049      text #D7DEE6   muted #6B7684
  glassEdge   rgba(77,208,225,0.35)   glow magenta-white for computation
  Fonts: JetBrains Mono for ALL numbers, hashes, proofs, logs, labels.
         Space Grotesk 600 for headings. Tabular-nums everywhere.
  Shape: circles and ellipses for quantum objects; 2px-bordered square-
         cornered cards for data (slide-mount framing); 1px rules.
  Motion: cubic-bezier(0.4,0,0.2,1), 700ms+. Slow, physical, viscous.
          Nothing snaps except a collapse.
  Light "brightfield" mode optional, dark is default.

DELIVER: Tailwind preset, CSS variables, a small component kit (Panel,
DataRow, HashDisplay with copy, ProofBadge, MeasureButton, Countdown,
LineageBreadcrumb, EmptyState), and a Storybook. Every component has an
honest empty/unavailable state. No component ever shows a placeholder
number.

═══════════════════════════════════════════════════════════════════════════
7. AGENT D — VISUAL  (/packages/scene)  ← highest effort, highest scrutiny
═══════════════════════════════════════════════════════════════════════════

Build the 3D launch sequence as a standalone React component
<LaunchSequence /> plus three reusable scenes: <MeasurementScene />,
<CollapseScene />, <FieldScene />. Three.js via react-three-fiber + drei +
postprocessing.

CORE RULE: every visual is driven by a real event from Agent A or Agent B.
The component subscribes to their observables and renders what arrives. If
no event arrives, nothing moves. There is no timeline-based fake animation.
Agent H will verify this by feeding a recorded event stream and checking
the scene reproduces it, and by feeding an empty stream and checking the
scene stays still.

MATERIALS: transmission (refractive glass) with thin-film iridescence on
edges, rim light in probability cyan, emissive magenta-white for active
computation, subtle UnrealBloom, light depth-of-field at the periphery,
faint cold radial vignette. No textures. No skybox. Pure geometry and light.

THE LAUNCH SEQUENCE — eight stages, each driven by real events, ~40s total,
every stage skippable, a side panel showing the real values as the geometry
produces them:

 1 INITIALIZATION  An empty chamber: a transparent cylindrical vessel with
   nested glass rings, suspended in void. A single glowing sphere (the coin,
   not yet real) pulses at centre.
 2 KEY GENERATION  Seed streams enter as thin lines of light. 67 hash
   chains GROW as literal chains: each link a transparent block, each new
   block emitted by Agent A's chainStep event with its real hash shown on
   hover. 16 links each. Instanced. This is the longest, most beautiful
   stage. Do not fake the count.
 3 MERKLE          Chain tips fold into one leaf on leafFormed. 256 leaves
   rise; pairs fuse upward level by level on each treeLevelFused event until
   one root glows white on rootReady. Root hash shown in mono beside it.
 4 SUPERPOSITION   Parameters appear as a probability cloud around the
   sphere: supply as a shimmering band, half-life as a rotating ring, decay
   channels as branching ghost-paths labelled with percentages. The cloud
   breathes. Driven by protocol's superposition ranges.
 5 QUANTUM DRAW    The chamber dims. On entropyRequested a beam leaves the
   chamber; on entropyArrived raw photons enter; the cloud contracts,
   flickers, and on outcomeResolved collapses to a point with a flash and
   a ring of light. Raw entropy + attestation appear in mono at that exact
   moment. This is the signature moment of the product.
 6 SIGNING         Light runs down each of the 67 chains and stops at the
   depth from signChainStop; those 67 blocks lift out and lock into the
   signature structure; the auth path to the root illuminates on each
   authPathNode. Correct WOTS signing, visibly.
 7 ANCHORING       The signed state compacts into one bright packet, travels
   down a lane of light, lands in a block that seals. Fires on the chain
   package's anchored event with the real tx signature shown.
 8 LINEAGE         Zoom out; the coin takes its node in its chain. If a
   daughter, a line of light connects it to its mother and the mother's
   final state is shown entangled with it.

MEASUREMENT SCENE  Stage 5 alone, on a coin page.
COLLAPSE SCENE     Stages 4→5, then the daughter forming from the collapsed
                   point, then stage 8. The ghost of the daughter is visible
                   during stage 4 with its projected allocation for the
                   viewer's wallet if connected.
FIELD SCENE        Home page. Every coin a glass vessel; cloud spread =
                   uncertainty; bright tight = heavily traded, wide dim
                   drifting = untouched and near collapse. On a live
                   measurement anywhere, that vessel flashes. Instanced,
                   LOD, frustum culling, 300+ vessels at 60fps.

PERFORMANCE: a frame-time test under CPU throttling (4×) and a mid-range
GPU profile must hold ≥55fps median through the full sequence. Progressive
asset load; first frame under 2s on mobile. Degrade bloom/DOF before
degrading frame rate; never degrade correctness of the chain counts.

SOUND: optional, off by default. Low cryogenic hum; harmonic rises during
computation; a single soft tone on collapse.

═══════════════════════════════════════════════════════════════════════════
8. AGENT F — APP  (/apps/web)
═══════════════════════════════════════════════════════════════════════════

Next.js 14 app router, TypeScript, Tailwind using Agent C's preset, Zustand,
TanStack Query, Prisma + Postgres, Redis, BullMQ. Solana wallet adapter.

ROUTES
 /            FieldScene full-bleed. Glass panel: eyebrow "Your coin dies.
              Your bag doesn't.", H1 "QSD", one sentence, [Launch] [How it
              works], next-burn countdown. Below: 4 steps, live counters
              (coins in superposition · measurements today · collapses ·
              daughters born · tunnels · $QSD burned), the LOG (every event,
              newest first, mono, each with proof/tx link).
 /field       Full field with filters (superposed / collapsed / tunnelled,
              sort by uncertainty / half-life / decay progress).
 /coin/[ca]   Name, ticker, CA, generation, mother link, identity root,
              probability band over chart, decay channels with percentages,
              half-life, decay progress, measurement history with proof
              bundles (each verifiable in-browser via Agent B's verify()),
              the forming daughter ghost with the connected wallet's
              projected allocation, MEASURE button stating current reward
              and current risk plainly, holders, [Trade on pump.fun].
 /lineage/[id] The full chain, generation 1 → now: every collapse, every
              proof, every allocation Merkle root, which holder cohorts
              carried forward.
 /launch      The LaunchSequence component, full-screen, wrapping the real
              launch. Form first (name, ticker, image, description, half-
              life preset, dev buy), cost breakdown (launch cost · identity
              reserve · dev buy · you pay), then the sequence runs on the
              real operations.
 /measure     Queue of coins nearest auto-measurement, with rewards.
 /burns       Every hourly burn with tx. Total burned. $QSD CA.
 /how         Rendered from /docs/physics.md and /docs/economics.md. Never
              paraphrase those files; render them.
 /me          Your coins, your projected daughter allocations, your
              lineage positions, your identity root and remaining one-time
              keys.

DATA: Prisma schema mirroring the protocol types. Ingestion workers via
BullMQ. Presence/live log via Redis pub/sub and SSE.

EVERY page has an honest empty state from Agent C's kit. The first coin that
exists is the first real launch.

Footer on every page: "A daughter coin is a new coin and can fail. QSD
guarantees a share of the next attempt, not a return. Coins launch on
pump.fun (Solana). A meme, not an investment."

═══════════════════════════════════════════════════════════════════════════
9. AGENT G — CHAIN  (/packages/solana)
═══════════════════════════════════════════════════════════════════════════

- pump.fun launch via PumpPortal (or current equivalent — research and
  confirm the live API) with the protocol-held keypair as creator. The
  daughter launch is fully automatic on collapse: no human in the loop.
- Holder snapshot at collapse block via DAS / getTokenLargestAccounts with
  pagination; feeds Agent E's allocation.
- Daughter airdrop: SPL transfers per the allocation table, batched, with
  retries and an on-chain anchor of the allocation Merkle root. Idempotent:
  a crashed airdrop resumes without double-paying. Agent H tests this.
- Proof anchoring: each proof bundle's commitment written on-chain (memo or
  a small program), returning the tx signature the scene displays.
- Hourly job: tally fees, buy $QSD via Jupiter, burn 100%, log tx.
- Trade webhooks (Helius or equivalent) for the Zeno reset on buys.
- Identity reserve: a per-coin wallet holding the one-time-key state.
- All keys encrypted at rest; no secrets in logs; everything behind env.
- Devnet first. Mainnet behind an explicit flag the integrator sets.

═══════════════════════════════════════════════════════════════════════════
10. AGENT H — VERIFY  (/tests, /docs)  ← adversarial, independent
═══════════════════════════════════════════════════════════════════════════

You have not seen the other agents' code being written. Treat it as
untrusted. Your job is to break it and to check every claim.

- Run Agent A's crypto against an independent reference implementation of
  WOTS+/XMSS; report any mismatch as blocking.
- Attempt one-time-key reuse through every public path. Must be impossible.
- Attempt to enable the dev random provider in production. Must be
  impossible.
- Tamper with proof bundles; verify() must reject every variant.
- Property-test allocation: sums to 100%, splitting a bag never increases
  total share, longer holding never decreases share.
- Feed the scene a recorded event stream and an empty stream; confirm it
  reproduces the former and stays still on the latter. Count rendered chain
  links: must be exactly 67×16.
- Run the frame-time test on the throttled profile.
- Read every user-facing string in /apps/web and compare each physics claim
  against /docs/physics.md. Flag anything that overclaims.
- Crash the airdrop midway and resume; confirm no double payment.
- Write /docs/security.md and /docs/audit-log.md with every finding, what
  was fixed, and what remains open. Nothing ships with an open blocking
  finding.

═══════════════════════════════════════════════════════════════════════════
11. INTEGRATOR CHECKLIST (you)
═══════════════════════════════════════════════════════════════════════════

Before calling the build done:
[ ] SPEC.md exists at root and matches this document.
[ ] All eight agents reported done with passing tests.
[ ] Agent H has no open blocking findings.
[ ] A real launch on devnet runs the full LaunchSequence end-to-end on real
    operations, and the proof panel values match the on-chain anchor.
[ ] A real coin on devnet has been measured, collapsed, and produced a
    daughter that real test wallets received in the right proportions.
[ ] No mock data, no placeholder numbers, no canned animations anywhere.
[ ] /how renders the physics and economics docs verbatim.
[ ] The footer disclaimer is on every page.

Report back with: what works end-to-end, what is devnet-only, what Agent H
left open, and the exact env variables needed for mainnet.
