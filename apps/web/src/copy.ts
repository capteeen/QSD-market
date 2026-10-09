/**
 * Every user-facing string in apps/web, as named constants.
 *
 * Agent H diffs this file against /docs/physics.md. Rules followed here:
 * - physics words (superposed, measurement, collapse, Zeno, entangled,
 *   tunnelling) name GAME STATES / MECHANICS inspired by the physics, never
 *   properties of the coin itself; wording is quoted from physics.md where a
 *   claim is made;
 * - the randomness is "genuinely quantum" only in the sense physics.md allows:
 *   bytes from a third-party hardware QRNG with an attestation, no fallback;
 * - no string here contains a number that stands for live data. Numbers that
 *   appear are protocol constants rendered from @qsd/protocol at runtime, or
 *   structural copy ("four steps").
 */

export const SITE_NAME = 'QSD';
export const SITE_TAGLINE = 'Quantum State Decay';

export const FOOTER_DISCLAIMER =
  'A daughter coin is a new coin and can fail. QSD guarantees a share of the next attempt, not a return. Coins launch on pump.fun (Solana). A meme, not an investment.';

// ───────────────────────────── navigation ─────────────────────────────
export const NAV = {
  field: 'Field',
  launch: 'Launch',
  measure: 'Measure',
  burns: 'Burns',
  how: 'How it works',
  me: 'Me',
} as const;

export const WALLET = {
  connect: 'Connect wallet',
  connected: 'Connected',
  disconnect: 'Disconnect',
} as const;

// ───────────────────────────── home ─────────────────────────────
export const HOME = {
  eyebrow: 'Your coin dies. Your bag doesn’t.',
  h1: 'QSD',
  sentence:
    'A coin that stops trading decays; when a measurement resolves to collapse, a daughter coin is born and every holder of the mother receives a share of it at birth.',
  launch: 'Launch',
  how: 'How it works',
  nextBurnLabel: 'next $QSD burn',
  nextBurnUnavailable: 'the burn schedule is not available',
  stepsEyebrow: 'FOUR STEPS',
  steps: [
    {
      title: 'Launch',
      body: 'A coin launches on pump.fun in the game state “superposed”: some of its parameters are published as ranges rather than single numbers, and the decision that resolves them has not been made yet.',
    },
    {
      title: 'Decay',
      body: 'Its decay progress rises with time since its last trade, according to a half-life published at launch. Every buy partially resets it — the Zeno mechanic, named after the quantum Zeno effect; the resemblance is in the shape only.',
    },
    {
      title: 'Measure',
      body: 'Anyone can measure a superposed coin. A measurement draws bytes from a hardware quantum random number generator and feeds them through a public, deterministic resolver: survive, collapse, or tunnel. Every outcome ships with a proof bundle anyone can verify.',
    },
    {
      title: 'Daughter',
      body: 'On collapse a daughter is born. Each holder’s share is their bag fraction times an entanglement weight computed from how they held — a fixed public function of the holder snapshot, verifiable by recomputation.',
    },
  ],
  countersEyebrow: 'LIVE',
  counters: {
    superposed: 'coins in superposition',
    measurementsToday: 'measurements today',
    collapses: 'collapses',
    daughters: 'daughters born',
    tunnels: 'tunnels',
    burned: '$QSD burned',
  },
  logEyebrow: 'LOG',
  logTitle: 'Every event, newest first',
  logEmptyEyebrow: 'NO EVENTS YET',
  logEmptySentence: 'Nothing has happened on this protocol yet. The first entry will be the first real launch.',
  logUnavailableEyebrow: 'LOG NOT AVAILABLE',
  fieldEmptyEyebrow: 'NO LIVE COINS',
  fieldEmptySentence: 'No coin has launched yet. The first coin that exists will be the first real launch.',
} as const;

// ───────────────────────────── home: the anime.js-style story ─────────────────────────────
/** Hero, scroll story, feature sections. Illustrative visuals are labelled as such; no string here stands for live data. */
export const STORY = {
  heroEyebrow: 'QUANTUM STATE DECAY · A PUMP.FUN LAUNCHPAD ON SOLANA',
  heroTitle: 'Your coin dies. Your bag doesn’t.',
  heroCtaLaunch: 'launch a coin',
  heroCtaHow: 'how it works',
  heroScroll: 'scroll',
  illustration: 'illustration · not live data',
  apartEyebrow: 'ONE MACHINE',
  apartTitle: 'Every launch is a machine you can take apart.',
  apartBody:
    'Each part is a real operation the protocol performs, and every one leaves something you can check: a public key, a Merkle root, a witness-signed draw, a transaction.',
  blueprintEyebrow: 'THE COMPLETE LAUNCH PIPELINE',
  blueprintTitle: 'From key generation to the holder share, in the order it runs.',
  blueprintBody: 'Hash-based identity, published ranges, a decay clock, a measurement drawn from a hardware quantum random number generator, and a daughter whose shape follows the mother’s.',
  rebuiltEyebrow: 'REASSEMBLED',
  rebuiltTitle: 'Put back together, it is one coin on pump.fun.',
  rebuiltBody: 'Launch publishes the ranges, the identity and the half-life. Everything after that is a trade, a measurement or a birth.',
  parts: {
    intake: 'quantum draw',
    witness: 'witness signature',
    cables: 'attested bytes',
    chains: 'WOTS+ chains',
    tree: 'Merkle root',
    superposition: 'superposition ranges',
    core: 'launch identity',
    decay: 'decay clock',
    measure: 'measurement',
    daughter: 'daughter coin',
    share: 'holder share',
  },
  features: {
    launch: {
      eyebrow: 'LAUNCH',
      title: 'Launch in superposition',
      arrows: ['PARAMETERS PUBLISHED AS RANGES', 'HASH-BASED LAUNCH IDENTITY', 'ANCHORED ON SOLANA'],
    },
    decay: {
      eyebrow: 'DECAY',
      title: 'Quiet time decays it',
      arrows: ['HALF-LIFE PUBLISHED AT LAUNCH', 'EVERY BUY RESETS PART OF IT', 'NOTHING HAPPENS UNTIL A MEASUREMENT'],
    },
    measure: {
      eyebrow: 'MEASURE',
      title: 'Anyone can measure',
      arrows: ['BYTES FROM A HARDWARE QRNG', 'WITNESS-SIGNED RESPONSE', 'PUBLIC, DETERMINISTIC RESOLVER'],
    },
    daughter: {
      eyebrow: 'COLLAPSE',
      title: 'Collapse births a daughter',
      arrows: ['PARAMETERS FOLLOW HOW THE MOTHER DIED', 'EVERY HOLDER GETS A SHARE AT BIRTH', 'A NEW COIN, WHICH CAN FAIL'],
    },
  },
  liveEyebrow: 'THE FIELD',
  liveTitle: 'Live, or honestly empty.',
  liveBody: 'Everything below is read from the protocol’s own records. Nothing is simulated: an empty field is an empty field.',
  fieldLink: 'open the field',
} as const;

/** Terminal panels on the home page. Every printed value comes from a computation run in this browser or from a protocol constant; the idle lines carry no numbers. */
export const TERM = {
  user: 'qsd',
  host: 'lab',
  waiting: 'waiting to come on screen',
  runAgain: 'run again',
  xmss: {
    path: '~/identity',
    meta: 'xmss · fresh key each run',
    cmd: 'xmss verify --live',
    generating: 'generating a fresh key in this browser',
    cSign: '# sign      σ[i] = H^d[i](sk[i])',
    cVerify: (w: string): string => `# verify    pk[i] =? H^(${w}-d[i])(σ[i])`,
    cCompress: (last: string): string => `# compress  ℓ = L-tree(pk[0] … pk[${last}])`,
    cClimb: (last: string): string => `# climb     root =? H(…H(ℓ ‖ a[0])… ‖ a[${last}])`,
    moreChains: (n: string, steps: string): string => `… ${n} more chains · ${steps} verifier hashes in all`,
    msg: 'msg',
    leaf: (i: string): string => `leaf ${i}`,
    root: (done: string, h: string): string => `root ${done}/${h}`,
    verified: (bytes: string, ms: string): string => `signature verified · ${bytes} B · sha-256 only · ${ms} ms in your browser`,
    rejected: 'signature rejected · recomputed root ≠ public root',
    verifying: 'verifying',
    runs: (n: string, s: string): string => `run ${n} · new key in ${s} s ·`,
    error: 'verifier error:',
  },
  decay: {
    path: '~/decay',
    meta: 'protocol math · no coin',
    cmd: 'decay --curve',
    explain: '# decayProgress = 1 − 2^(−quiet / half-life)  (economics §1); protocol constants, not a coin',
    header: 'quiet  progress        state',
    autoAt: (hl: string): string => `auto-measurement at ${hl} half-lives of quiet time; a survive removes ${'<R>'} of the quiet time`,
    zeno: (k: string, cap: string): string => `zeno: a buy worth x of market cap removes min(${cap}, ${k}·x) of the quiet time`,
    presets: 'half-life presets offered at launch:',
    autoLabel: 'auto-measure',
    stateQuiet: 'quiet',
    stateDue: 'auto-measure due',
  },
  resolver: {
    path: '~/measure',
    meta: 'public resolver · constants only',
    cmd: 'resolver --describe',
    id: 'resolver',
    draw: 'draw',
    drawUnit: 'bytes from the QRNG, witness-signed verbatim',
    rule1: 'u[0] < decayProgress        → collapse, else survive',
    rule2: (p: string): string => `u[1] < ${p}                → tunnel (the coin re-emerges as itself)`,
    rule3: 'u[2] picks the channel; u[3] picks the pool point in the channel’s band',
    note: '# the same bytes and inputs always give the same outcome; anyone can recompute it from the proof bundle',
    noCoin: '# no coin was measured by this panel; it prints the rule, not a draw',
    tunnelLabel: 'tunnel probability',
    burnLabel: 'collapse burn',
    measurerLabel: 'measurer share of the burn',
    survLabel: 'survive reset',
  },
  merkle: {
    path: '~/allocation',
    meta: 'hash tree · random leaves',
    cmd: 'merkle commit --live',
    explain: '# the allocation table is committed as a hash tree; a holder proves their row with one path (economics §6)',
    leaves: (n: string): string => `${n} leaves of browser randomness, not holders`,
    fused: (level: string, n: string): string => `level ${level} · ${n} parents`,
    root: 'root',
    pathFor: (i: string, len: string): string => `auth path for leaf ${i} · ${len} siblings`,
    recomputed: 'recomputed root',
    ok: 'path verifies · recomputed root = root',
    bad: 'path rejected · recomputed root ≠ root',
    ms: (ms: string): string => `${ms} ms in your browser`,
  },
} as const;

// ───────────────────────────── page heroes (the inner pages in the home-page manner) ─────────────────────────────
export const PAGES = {
  field: {
    body: 'Every coin the protocol has launched, in whatever state it is in now. The scene draws the coins that exist; the table lists them.',
    arrows: ['SUPERPOSED, COLLAPSED OR TUNNELLED', 'DECAY PROGRESS RECOMPUTED LIVE', 'SORT BY WHAT MATTERS TO YOU'],
  },
  launch: {
    body: 'A coin launches on pump.fun with its parameters published as ranges. The identity is a hash-based key, generated for this launch alone.',
    arrows: ['PAY ONCE, FROM YOUR WALLET', 'EVERY STAGE IS A REAL OPERATION', 'THE STREAM PRINTS WHAT HAPPENS'],
  },
  measure: {
    body: 'Coins nearest to their auto-measurement, soonest first. Anyone can measure any of them before the protocol does.',
    arrows: ['SOONEST DUE AT THE TOP', 'REWARD PAID ON COLLAPSE', 'THE PROTOCOL MEASURES WHAT NOBODY DOES'],
  },
  burns: {
    body: 'The hourly tally of protocol fees, the $QSD bought with it, and the transaction that burned it.',
    arrows: ['ONE BURN PER HOUR', 'EVERY TRANSACTION LINKED', 'TOTALS FROM THE LEDGER, NOT A COUNTER'],
  },
  how: {
    body: 'The two documents the protocol is written against, rendered verbatim: the physics the mechanics borrow from, and the economics they implement.',
    arrows: ['PHYSICS, HONESTLY', 'ECONOMICS, EXACTLY', 'VERIFY A SIGNATURE WHILE YOU READ'],
  },
  me: {
    body: 'What this wallet has launched, holds and has been allocated, read from the protocol’s own records.',
    arrows: ['COINS YOU LAUNCHED', 'COINS YOU HOLD', 'DAUGHTER SHARES YOU RECEIVED'],
  },
  lineage: {
    body: 'One lineage, from its generation-one coin through every collapse and every daughter born from it.',
  },
  coin: {
    identityEyebrow: 'IDENTITY',
    channelCol: 'channel',
    bandWidth: 'band width',
  },
} as const;

// ───────────────────────────── field ─────────────────────────────
export const FIELD = {
  title: 'The field',
  eyebrow: 'EVERY COIN',
  filterAll: 'all',
  filterSuperposed: 'superposed',
  filterCollapsed: 'collapsed',
  filterTunnelled: 'tunnelled',
  sortUncertainty: 'uncertainty',
  sortHalfLife: 'half-life',
  sortDecay: 'decay progress',
  sortLabel: 'sort by',
  filterLabel: 'show',
  emptyEyebrow: 'NO LIVE COINS',
  emptySentence: 'No coin has launched yet. The first coin that exists will be the first real launch.',
  emptyFilteredEyebrow: 'NO COINS MATCH',
  emptyFilteredSentence: 'No coin is in that state right now.',
  unavailableEyebrow: 'FIELD NOT AVAILABLE',
  columns: {
    coin: 'coin',
    state: 'state',
    generation: 'gen',
    halfLife: 'half-life',
    decay: 'decay progress',
    uncertainty: 'uncertainty',
    nextAuto: 'auto-measure',
  },
} as const;

// ───────────────────────────── coin ─────────────────────────────
export const COIN = {
  notFoundEyebrow: 'NO SUCH COIN',
  notFoundSentence: 'No coin with that address exists on this protocol.',
  unavailableEyebrow: 'COIN NOT AVAILABLE',
  rows: {
    name: 'name',
    ticker: 'ticker',
    ca: 'contract address',
    generation: 'generation',
    state: 'state',
    mother: 'mother',
    daughter: 'daughter',
    lineage: 'lineage',
    identityRoot: 'identity root',
    halfLife: 'half-life',
    decayProgress: 'decay progress',
    quietSince: 'quiet since',
    nextAutoMeasure: 'auto-measurement at',
    supplyBand: 'supply band (daughter pool)',
    supplyMin: 'band minimum',
    supplyMax: 'band maximum',
    totalSupply: 'total supply',
    remainingSupply: 'remaining supply',
    bornAt: 'born',
    collapsedAt: 'collapsed',
    launchTx: 'launch tx',
    launchPath: 'launched via',
    holders: 'holders',
  },
  bandEyebrow: 'PROBABILITY BAND',
  bandTitle: 'Published ranges, outcome not yet drawn',
  bandCaption:
    'While the coin is superposed some of its parameters are published as ranges. The cloud is a visualisation of a probability distribution we wrote down, not a physical state.',
  channelsEyebrow: 'DECAY CHANNELS',
  channelsTitle: 'Which daughter would be born',
  channelProbability: 'probability',
  channelHalfLife: 'daughter half-life range',
  channelPool: 'daughter pool range',
  decayEyebrow: 'DECAY',
  decayCaption: 'A half-life, not a timer. The number only becomes an event when someone measures the coin.',
  measurementsEyebrow: 'MEASUREMENTS',
  measurementsTitle: 'Measurement history with proof bundles',
  measurementsEmptyEyebrow: 'NOT YET MEASURED',
  measurementsEmptySentence: 'No measurement has been made on this coin.',
  measurementRows: {
    index: 'index',
    at: 'at',
    by: 'by',
    outcome: 'outcome',
    decayBefore: 'decay before',
    decayAfter: 'decay after',
    provider: 'provider',
    attestation: 'attestation',
    commitment: 'commitment',
    inputsHash: 'inputs hash',
    precommitTx: 'pre-commit tx',
    proofTx: 'proof tx',
    bundleHash: 'bundle hash',
  },
  verifyButton: 'Verify in browser',
  verifying: 'verifying…',
  verifyNoKeys: 'no witness public key is published to this build (NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS)',
  verifyPending: 'not verified yet',
  verifiedCaption:
    'Verified means: these exact bytes were applied to these exact inputs and produced this exact outcome, and the bundle has not been altered since it was formed. It does not prove the photons.',
  downloadBundle: 'Download bundle',
  daughterEyebrow: 'THE FORMING DAUGHTER',
  daughterTitle: 'Projected allocation',
  daughterCaption:
    'The daughter’s parameters are a deterministic function of the mother’s final state; your share is your bag fraction times an entanglement weight between 1.0 and 1.5.',
  daughterNoWallet: 'wallet not connected',
  daughterNoSnapshot: 'no holder snapshot or holding history exists for this coin yet',
  daughterNotHolder: 'the connected wallet holds none of this coin',
  daughterCollapsed: 'this coin has collapsed; the allocation is final',
  projectedShare: 'projected share of the daughter pool',
  projectedUnits: 'projected daughter units',
  projectedWeight: 'entanglement weight',
  measureEyebrow: 'MEASURE',
  measureTitle: 'Measure this coin',
  measureCaption:
    'Measuring draws bytes from a hardware QRNG and applies them to the coin through a public resolver. Measuring a coin does not perform a quantum measurement on the coin.',
  measureNoWallet: 'connect a wallet to measure',
  measureNotMeasurable: 'this coin is collapsed and cannot be measured',
  measureQrngUnavailable: 'the quantum random number provider is not reachable; there is no fallback',
  measureChainUnavailable: 'the chain is not reachable',
  measureStatsUnavailable: 'protocol health is not available',
  measureSigning: 'sign the challenge in your wallet',
  measureRunning: 'measuring — waiting for the draw',
  measureDone: 'measurement recorded',
  measureFailed: 'measurement failed',
  daughterScheduled: 'the daughter launch has been handed to the collapse worker',
  daughterNotScheduled: 'the daughter launch could NOT be scheduled; the mother is recorded as collapsed and the reconciliation job will retry',
  holdersEyebrow: 'HOLDERS',
  holdersTitle: 'Holders at the latest snapshot',
  holdersEmptyEyebrow: 'NO HOLDER DATA',
  holdersEmptySentence: 'No holder snapshot has been taken for this coin.',
  holdersCols: { wallet: 'wallet', balance: 'balance', since: 'held since', weight: 'weight' },
  trade: 'Trade on pump.fun',
  tradeDevnet: 'devnet coin — pump.fun is mainnet-only',
  explorer: 'explorer',
  tunnelledNote:
    'This coin tunnelled: on collapse the same draw decided it re-emerges as itself, with every holder’s position intact. Nothing physically tunnelled; it is one branch of the resolver.',
} as const;

// ───────────────────────────── lineage ─────────────────────────────
export const LINEAGE = {
  eyebrow: 'LINEAGE',
  title: 'Generation one to now',
  unavailableEyebrow: 'LINEAGE NOT AVAILABLE',
  notFoundEyebrow: 'NO SUCH LINEAGE',
  notFoundSentence: 'No lineage with that id exists on this protocol.',
  collapseEyebrow: 'COLLAPSE',
  proofLabel: 'proof bundle',
  allocationRoot: 'allocation Merkle root',
  rootAnchorTx: 'root anchor tx',
  cohortsTitle: 'Holder cohorts carried forward',
  cohortsEmpty: 'no allocation table exists for this collapse',
  cohortWallets: 'wallets',
  cohortUnits: 'units allocated',
  cohortDust: 'dust burned',
  cohortWeightRange: 'weight range',
  measurementsSurvived: 'measurements survived',
  channel: 'channel',
} as const;

// ───────────────────────────── launch ─────────────────────────────
export const LAUNCH = {
  eyebrow: 'LAUNCH',
  title: 'Launch a coin',
  form: {
    name: 'name',
    ticker: 'ticker',
    image: 'image',
    description: 'description',
    halfLife: 'half-life preset',
    devBuy: 'dev buy (SOL)',
    submit: 'Pay and launch',
    paying: 'confirm the payment in your wallet',
    launching: 'launching — every stage below is a real operation',
  },
  costEyebrow: 'COST',
  cost: {
    launch: 'launch cost',
    identity: 'identity reserve',
    devBuy: 'dev buy',
    total: 'you pay',
    unavailableReason: 'the operator has not configured this amount',
    payTo: 'paid to',
  },
  noWalletEyebrow: 'WALLET REQUIRED',
  noWalletSentence: 'Connect a wallet to pay for a launch.',
  quoteUnavailableEyebrow: 'LAUNCH NOT AVAILABLE',
  devnetNotice: 'This deployment is on Solana devnet: the coin is minted as a plain SPL token. pump.fun is mainnet-only.',
  mainnetNotice: 'This deployment launches on pump.fun (Solana mainnet).',
  stageNote:
    'Every visual in the sequence is driven by a real event from the key generation, the quantum draw, the signature and the chain. If no event arrives, no stage advances and no value changes; the only motion without an event is the chamber’s ambient drift.',
  streamLost: 'the launch stream was interrupted; the server may still complete the launch — check the log',
  done: 'Launched',
  viewCoin: 'View coin',
  errorEyebrow: 'LAUNCH FAILED',
  identityNote:
    'The launch identity is generated on the server, in the protocol’s identity reserve. The hash chain values at depths below the tip are one-time secret key material, so the stream you see carries their SHA-256 commitments; every other hash is the real value.',
} as const;

// ───────────────────────────── measure queue ─────────────────────────────
export const MEASURE = {
  eyebrow: 'MEASUREMENT QUEUE',
  title: 'Nearest to auto-measurement',
  caption:
    'If nobody measures a coin within its window, the protocol does. Collapse can be delayed by trading; it can never be avoided.',
  emptyEyebrow: 'NOTHING TO MEASURE',
  emptySentence: 'No coin is in a measurable state.',
  unavailableEyebrow: 'QUEUE NOT AVAILABLE',
  cols: { coin: 'coin', autoAt: 'auto-measurement in', decay: 'collapse probability now', rewardCollapse: 'if it collapses you receive', rewardSurvive: 'if it survives' },
  /** What a survive pays the measurer today: nothing. No measurement fee is charged, so there is nothing to rebate; the coin's quiet time is partly removed. */
  surviveCell: (resetPct: string): string => `nothing — the coin stays alive and ${resetPct} of its quiet time is removed`,
  measureLink: 'open',
} as const;

// ───────────────────────────── burns ─────────────────────────────
export const BURNS = {
  eyebrow: 'BURNS',
  title: 'Every hourly burn',
  caption: 'Each hour the protocol tallies its fees, buys $QSD and burns all of it.',
  total: 'total $QSD burned',
  qsdCa: '$QSD contract address',
  qsdCaUnavailable: 'no $QSD mint is configured for this deployment',
  emptyEyebrow: 'NO BURNS YET',
  emptySentence: 'No hourly burn has executed yet.',
  unavailableEyebrow: 'BURNS NOT AVAILABLE',
  cols: { at: 'at', lamportsIn: 'SOL in', qsdBurned: '$QSD burned', tx: 'tx' },
} as const;

// ───────────────────────────── how ─────────────────────────────
export const HOW = {
  eyebrow: 'HOW IT WORKS',
  title: 'The physics, and the economics',
  physicsTab: 'physics',
  economicsTab: 'economics',
  unavailableEyebrow: 'DOCUMENTS NOT AVAILABLE',
  sourceNote: 'Rendered verbatim from the repository documents.',
} as const;

// ───────────────────────────── me ─────────────────────────────
export const ME = {
  eyebrow: 'ME',
  title: 'Your positions',
  connectEyebrow: 'CONNECT A WALLET',
  connectSentence: 'Connect a wallet to see your positions.',
  unavailableEyebrow: 'POSITIONS NOT AVAILABLE',
  coinsCreated: 'Coins you launched',
  coinsHeld: 'Coins you hold',
  noneCreated: 'You have not launched a coin.',
  noneHeld: 'No trades from this wallet have been seen by the protocol.',
  allocations: 'Your projected daughter allocations',
  noAllocations: 'No projected allocation exists for this wallet.',
  received: 'Daughter allocations you received',
  noReceived: 'No daughter has been allocated to this wallet.',
  lineages: 'Your lineage positions',
  noLineages: 'This wallet holds no position in any lineage.',
  identity: 'Launch identities',
  identityRoot: 'identity root',
  remainingKeys: 'remaining one-time keys',
  nextIndex: 'next key index',
} as const;

// ───────────────────────────── shared ─────────────────────────────
export const SHARED = {
  unavailableDb: 'the database is not reachable',
  unavailableRedis: 'the live event stream is not reachable',
  unavailableChain: 'the chain is not reachable',
  unavailableQrng: 'the quantum random number provider is not reachable',
  liveDot: 'live',
  reconnecting: 'reconnecting',
  loading: 'loading',
  seconds: 's',
  stateLabels: {
    superposed: 'superposed',
    'measured-alive': 'measured · alive',
    collapsed: 'collapsed',
    tunnelled: 'tunnelled',
  },
  outcomeLabels: { survive: 'survive', collapse: 'collapse', tunnel: 'tunnel' },
  explorerTx: 'tx',
  proof: 'proof',
  coin: 'coin',
} as const;

/** Reward / risk sentences for the MeasureButton. All numbers are computed by the caller. */
export const MEASURE_TEXT = {
  reward: (units: string, ticker: string, pct: string, resetPct: string): string =>
    `if it collapses you receive ${units} ${ticker} (${pct} of remaining supply); if it survives you receive nothing — no measurement fee is charged — and ${resetPct} of the coin’s quiet time is removed`,
  risk: (pct: string): string => `current collapse probability: ${pct}`,
} as const;

// ───────────────────────────── error pages ─────────────────────────────
export const ERRORS = {
  notFoundEyebrow: 'NO SUCH PAGE',
  notFoundSentence: 'Nothing exists at this address.',
  notFoundLink: 'Back to the field',
  errorEyebrow: 'PAGE FAILED',
  errorSentence: 'This page failed to render. Opening it changed nothing on the protocol.',
  retry: 'Try again',
  globalEyebrow: 'SITE FAILED',
  globalSentence: 'The site shell failed to render. Opening it changed nothing on the protocol.',
} as const;
