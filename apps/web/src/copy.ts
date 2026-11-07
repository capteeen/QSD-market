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

export const SITE_NAME = 'INFINITWAP';
export const SITE_TAGLINE = 'No-vamp launchpad on Elysium';

export const FOOTER_DISCLAIMER =
  'A daughter coin is a new coin and can fail. INFINITWAP guarantees a share of the next attempt, not a return. Coins launch on Elysium. A meme, not an investment.';

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
  eyebrow: 'No vamp. Creator rewards.',
  h1: 'INFINITWAP',
  sentence:
    'A ticker can be launched once. The wallet that launches it is the creator, and that name cannot be copied.',
  launch: 'Launch',
  how: 'How it works',
  nextBurnLabel: 'INFINITWAP burn',
  nextBurnUnavailable: 'buy-and-burn is not available on Elysium',
  stepsEyebrow: 'FOUR STEPS',
  steps: [
    {
      title: 'No vamp',
      body: 'Each ticker can be launched once. A second attempt with the same ticker is refused before anyone is asked to pay.',
    },
    {
      title: 'Creator',
      body: 'The wallet that pays for the launch is stored as the creator of that ticker.',
    },
    {
      title: 'Creator reward',
      body: 'Creator rewards belong to that wallet alone. A copied ticker never qualifies, because a copy is not created.',
    },
    {
      title: 'On Elysium',
      body: 'The coin is paid for in HYPE. The creator and the ticker are written with the coin.',
    },
  ],
  countersEyebrow: 'LIVE',
  counters: {
    superposed: 'coins in superposition',
    measurementsToday: 'measurements today',
    collapses: 'collapses',
    daughters: 'daughters born',
    tunnels: 'tunnels',
    burned: 'INFINITWAP burned',
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
  heroEyebrow: 'INFINITWAP · NO VAMP ON ELYSIUM',
  heroTitle: 'One ticker. One creator.',
  heroCtaLaunch: 'launch a coin',
  heroCtaHow: 'how it works',
  heroScroll: 'scroll',
  illustration: 'illustration · not live data',
  apartEyebrow: 'ONE MACHINE',
  apartTitle: 'Every launch is a machine you can take apart.',
  apartBody: 'Two rules, and both are enforced: a ticker launches once, and the wallet that launches it is the creator of that coin.',
  blueprintEyebrow: 'THE LAUNCH',
  blueprintTitle: 'From a free ticker to a creator reward.',
  blueprintBody: 'The ticker is checked, the creator wallet is stored, and the coin is deployed on Elysium.',
  rebuiltEyebrow: 'REASSEMBLED',
  rebuiltTitle: 'Put back together, it is one coin on Elysium.',
  rebuiltBody: 'What remains is one coin, one ticker, and one creator.',
  parts: {
    intake: 'one ticker',
    witness: 'no copy',
    cables: 'locked ticker',
    chains: 'name locked',
    tree: 'first creator',
    superposition: 'creator wallet',
    core: 'creator reward',
    decay: 'your coin',
    measure: 'on elysium',
    daughter: 'paid in hype',
    share: 'your share',
  },
  features: {
    launch: {
      eyebrow: 'NO VAMP',
      title: 'One ticker, one coin',
      arrows: ['TICKER CHECKED BEFORE PAYMENT', 'A SECOND LAUNCH IS REFUSED', 'THE NAME STAYS WITH THE FIRST CREATOR'],
    },
    decay: {
      eyebrow: 'CREATOR',
      title: 'The launching wallet',
      arrows: ['STORED WITH THE COIN', 'SHOWN ON THE COIN PAGE', 'SHOWN UNDER ME'],
    },
    measure: {
      eyebrow: 'REWARDS',
      title: 'Creator rewards',
      arrows: ['ASSIGNED TO THE CREATOR WALLET', 'A COPIED TICKER NEVER QUALIFIES', 'NO SECOND COIN CAN TAKE THE NAME'],
    },
    daughter: {
      eyebrow: 'ELYSIUM',
      title: 'Launch the coin',
      arrows: ['A TOKEN ON ELYSIUM', 'PAID IN HYPE', 'THE TICKER IS LOCKED AT LAUNCH'],
    },
  },
  liveEyebrow: 'THE FIELD',
  liveTitle: 'Live, or honestly empty.',
  liveBody: 'Everything below is read from the protocol’s own records. Nothing is simulated: an empty field is an empty field.',
  fieldLink: 'open the field',
} as const;

/** Terminal panels on the home page. Every printed value comes from a computation run in this browser or from a protocol constant; the idle lines carry no numbers. */
export const TERM = {
  user: 'infinitwap',
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
    zenoNote: 'The resemblance is in the shape only.',
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
    body: 'Every coin launched on Elysium, in whatever state it is in now. Each ticker belongs to one creator. The scene draws the coins that exist; the table lists them.',
    arrows: ['SUPERPOSED, COLLAPSED OR TUNNELLED', 'DECAY PROGRESS RECOMPUTED LIVE', 'ONE TICKER, ONE CREATOR'],
  },
  launch: {
    body: 'Pay in HYPE, lock a ticker, and become its creator. A ticker that already exists cannot be launched again.',
    arrows: ['ONE TICKER, ONE CREATOR', 'A COPY IS REFUSED BEFORE PAYMENT', 'CREATOR REWARDS STAY WITH THAT WALLET'],
  },
  measure: {
    body: 'Coins on Elysium nearest to their auto-measurement, soonest first. Anyone can measure any of them before the protocol does.',
    arrows: ['SOONEST DUE AT THE TOP', 'REWARD PAID ON COLLAPSE', 'THE PROTOCOL MEASURES WHAT NOBODY DOES'],
  },
  burns: {
    body: 'Burns recorded by the ledger. Buying and burning a token is not available on Elysium yet.',
    arrows: ['ONE BURN PER HOUR', 'EVERY TRANSACTION LINKED', 'TOTALS FROM THE LEDGER, NOT A COUNTER'],
  },
  how: {
    body: 'INFINITWAP on Elysium, written down and rendered verbatim: the physics the mechanics borrow from, and the economics they implement. A ticker launches once. The wallet that pays is the creator.',
    arrows: ['PHYSICS, HONESTLY', 'ECONOMICS, EXACTLY', 'VERIFY A SIGNATURE WHILE YOU READ'],
  },
  me: {
    body: 'What this wallet has launched, holds and has been allocated, read from the protocol’s own records.',
    arrows: ['COINS YOU CREATED', 'CREATOR REWARDS ON THOSE TICKERS', 'NO SECOND COIN CAN TAKE THE NAME'],
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

// ───────────────────────────── launched list ─────────────────────────────
export const LAUNCHED = {
  eyebrow: 'EVERY LAUNCH',
  hint: 'Newest mother first. A daughter coin sits under the coin it was born from.',
  generation: 'gen',
  halfLife: 'half-life',
  launched: 'launched',
  bornFromCollapse: 'born on collapse',
} as const;

// ───────────────────────────── airdrop figure ─────────────────────────────
export const AIRDROP = {
  eyebrow: 'THE AIRDROP',
  title: 'When the holders received the daughter',
  caption: 'Each square is one wallet from the holder snapshot. It fills as its transfer of the daughter coin confirms on Elysium.',
  stepCollapse: 'collapse',
  stepBorn: 'daughter born',
  stepAirdrop: 'airdrop',
  airdropPending: 'not started',
  airdropRunning: 'in progress',
  airdropDone: 'complete',
  wallets: 'wallets',
  confirmed: 'confirmed',
  sent: 'sent',
  pending: 'pending',
  showing: 'showing',
  of: 'of',
  noWallets: 'No wallet was in the holder snapshot, so there was nothing to airdrop.',
  stillExecuting: 'Daughter coin creation is coming soon.',
  notCollapsed: 'No collapse has happened for this coin yet.',
  unavailableEyebrow: 'AIRDROP NOT AVAILABLE',
  walletsConfirmed: 'wallets confirmed',
} as const;

// ───────────────────────────── coin ─────────────────────────────
export const COIN = {
  notFoundEyebrow: 'NO SUCH COIN',
  notFoundSentence: 'No coin with that address exists on this protocol.',
  unavailableEyebrow: 'COIN NOT AVAILABLE',
  rows: {
    name: 'name',
    ticker: 'ticker',
    creator: 'creator',
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
  daughterEyebrow: 'DAUGHTER',
  daughterTitle: 'Coming soon',
  daughterCaption: 'Daughter coin creation is coming soon.',
  daughterComingSoon: 'Daughter coin creation is coming soon.',
  creatorRewardNote: 'Creator rewards for this ticker belong to this wallet. No one else can launch the same ticker.',
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
  daughterScheduled: 'Daughter coin creation is coming soon.',
  daughterNotScheduled: 'Daughter coin creation is coming soon.',
  holdersEyebrow: 'HOLDERS',
  holdersTitle: 'Holders at the latest snapshot',
  holdersEmptyEyebrow: 'NO HOLDER DATA',
  holdersEmptySentence: 'No holder snapshot has been taken for this coin.',
  holdersCols: { wallet: 'wallet', balance: 'balance', since: 'held since', weight: 'weight' },
  trade: 'Trade on Elysium',
  tradeDevnet: 'Trade on Elysium is not available yet — no pool is published for this coin.',
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
    tickerTaken: 'already launched',
    noVamp: 'This ticker can be used once. The wallet that pays becomes its creator.',
    image: 'image',
    description: 'description',
    halfLife: 'half-life preset',
    devBuy: 'dev buy (HYPE)',
    submit: 'Pay and launch',
    checking: 'checking the launch services',
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
  noWalletSentence: 'Connect a wallet to pay in HYPE on Elysium.',
  quoteUnavailableEyebrow: 'LAUNCH NOT AVAILABLE',
  devnetNotice: 'This deployment is on Elysium testnet. The coin is an ERC-20 paid for in HYPE.',
  mainnetNotice: 'Elysium mainnet chain ID, RPC and explorer are not published yet. Launches stay on testnet.',
  stageNote:
    'Every visual in the sequence is driven by a real event from the key generation, the quantum draw, the signature and the chain. If no event arrives, no stage advances and no value changes; the only motion without an event is the chamber’s ambient drift.',
  streamLost: 'the launch stream was interrupted; the server may still complete the launch — check the log',
  done: 'Launched',
  viewCoin: 'View coin',
  errorEyebrow: 'LAUNCH FAILED',
  notCharged: 'Nothing was charged. A launch service is down:',
  identityNote:
    'The launch identity is generated on the server, in the protocol’s identity reserve. The hash chain values at depths below the tip are one-time secret key material, so the stream you see carries their SHA-256 commitments; every other hash is the real value.',
} as const;

// ───────────────────────────── measure queue ─────────────────────────────
export const MEASURE = {
  eyebrow: 'MEASUREMENT QUEUE',
  title: 'Nearest to auto-measurement',
  caption:
    'Coins on Elysium. If nobody measures a coin within its window, the protocol does. Collapse can be delayed by trading; it can never be avoided.',
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
  caption: 'Buy-and-burn is not available on Elysium. This page lists only burns the ledger has recorded.',
  total: 'total INFINITWAP burned',
  qsdCa: 'INFINITWAP contract address',
  qsdCaUnavailable: 'no INFINITWAP token is configured for this deployment',
  emptyEyebrow: 'NO BURNS YET',
  emptySentence: 'No hourly burn has executed yet.',
  unavailableEyebrow: 'BURNS NOT AVAILABLE',
  cols: { at: 'at', lamportsIn: 'HYPE in', qsdBurned: 'INFINITWAP burned', tx: 'tx' },
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
  connectSentence: 'Connect a wallet to see the coins you created on Elysium.',
  unavailableEyebrow: 'POSITIONS NOT AVAILABLE',
  coinsCreated: 'Coins you created',
  creatorRewardNote: 'Creator rewards on these tickers belong to this wallet. A second coin cannot take the name.',
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
