# apps/web — qsd.market

Next.js 14 (app router), React 18, Tailwind 3.4 on the `@qsd/ui-tokens` preset,
Zustand, TanStack Query, Prisma + Postgres, Redis pub/sub + SSE, BullMQ
workers, Solana wallet adapter (Phantom, Solflare).

**Live data only.** There is no seed script, no mock coin, no placeholder
number. The first row in `Coin` is the first real launch. Every page renders
the kit's `EmptyState` / `Unavailable` components when there is nothing, or
when a dependency is down; a failed query is "not available (reason)", never
`0`.

## Run book

```
cp apps/web/.env.example apps/web/.env            # fill in; see the comments
pnpm install
pnpm --filter web prisma:validate
pnpm --filter web prisma:generate
pnpm --filter web exec prisma migrate dev --name init   # first time (creates the migration)
pnpm --filter web prisma:migrate                  # deploy migrations
pnpm --filter web worker                          # BullMQ workers (auto-measure, collapse, burn, ingest, snapshot)
pnpm --filter web dev                             # http://localhost:3000

pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web build     # needs no database, Redis or chain: every page is force-dynamic
```

Register the Helius webhook for every coin mint at
`POST https://<host>/api/webhooks/helius` with `authHeader = QSD_WEBHOOK_SECRET`
(`buildHeliusWebhookRegistration` in `@qsd/solana`).

### Genesis config (`QSD_GENESIS_CONFIG`)

`@qsd/protocol` defines how a daughter inherits its lineage's channel table but
not what a generation-1 table is. That is operator configuration, read from a
JSON file; without it `/launch` is unavailable and says so.

```json
{
  "supplyUnits": "1000000000000000",
  "decimals": 6,
  "poolUnits": { "min": "100000000000000", "max": "300000000000000" },
  "channels": [
    { "id": "fast", "probabilityPpm": 500000, "label": "fast decay",
      "halfLifeSec": { "min": 3600, "max": 86400 },
      "poolUnits": { "min": "100000000000000", "max": "200000000000000" } },
    { "id": "slow", "probabilityPpm": 500000, "label": "slow decay",
      "halfLifeSec": { "min": 86400, "max": 604800 },
      "poolUnits": { "min": "150000000000000", "max": "300000000000000" } }
  ]
}
```

Channel probabilities must sum to 1 000 000 ppm and half-life ranges must lie
inside the protocol bounds (`validateChannels` + `PROTOCOL_PARAMS`); the file
is validated on first use. `supplyUnits`/`decimals` are the devnet mint supply
(on mainnet pump.fun sets the supply). The genesis superposition band is
`poolUnits` in full — the widest band, as economics.md §5 gives a coin with no
history (`L = 0`).

## Routes and where their data comes from

| Route | Data | Empty / unavailable |
| --- | --- | --- |
| `/` | `FieldScene` from `GET /api/coins`; glass panel; next-burn `Countdown` from `/api/stats.nextBurnAt` (the BullMQ cron's next top of the hour, only when `REDIS_URL` and `QSD_TOKEN_MINT` are set); four steps (copy); live counters from `/api/stats` (Prisma counts); LOG from `/api/log` (`EventLog`, newest first) | empty chamber + `EmptyState`; counters per-row `Unavailable` on 503, `0` only on a real zero; log `EmptyState` |
| `/field` | `/api/coins` with client-side filter (superposed / collapsed / tunnelled) and sort (uncertainty = band width, half-life, live decay progress) | `EmptyState` (none / none matching), `Panel unavailable` |
| `/coin/[ca]` | `/api/coin/[ca]` (Prisma `Coin` + `Channel` + `Measurement`), `/api/coin/[ca]/holders` (trade-log reconstruction), `/api/stats.health` for the measure button | not found → `EmptyState`; every row through `DataRow`/`HashDisplay` unavailable states |
| `/lineage/[id]` | `/api/lineage/[id]` (`Lineage`, coins by generation, collapse measurements, `AllocationTable` + entry aggregates) | `EmptyState` |
| `/launch` | `/api/launch/quote` (env costs + protocol creator address + genesis status) then `POST /api/launch` SSE | costs `DataRow` unavailable per missing env var; wallet gate |
| `/measure` | `/api/coins` filtered to measurable, sorted by `nextAutoMeasureAt`; rewards from `collapseRewards(remainingUnits)` and `PROTOCOL_PARAMS` | `EmptyState` |
| `/burns` | `/api/burns` (`Burn` rows, sum) + `QSD_TOKEN_MINT` | `EmptyState`; mint `HashDisplay` unavailable |
| `/how` | `/api/how` reads `/docs/physics.md` and `/docs/economics.md` at request time (walks up from `process.cwd()` until `docs/physics.md` exists; `QSD_DOCS_DIR` overrides) and renders them with `react-markdown` + `remark-gfm`, verbatim | `Panel unavailable` |
| `/me` | `/api/me?wallet=` (coins by `createdBy`, trades by buyer, `AllocationEntry` by wallet with airdrop status, `Identity` mirror) | wallet gate `EmptyState`; per-section sentences |

Live updates: `GET /api/events` is an SSE stream of the Redis `qsd:events`
channel (heartbeat every 15 s). `LiveProvider` invalidates the TanStack
queries on each event; the header dot is "live" only while the stream is open.
Measurement events also flash the vessel in the `FieldScene`.

## API

| Method & path | Purpose |
| --- | --- |
| `POST /api/webhooks/helius` | `parseHeliusWebhook` (auth = `QSD_WEBHOOK_SECRET`), store `Trade` + `BalanceChange`, `applyBuy` (Zeno), log, publish; DB down → queued to `ingest-trades` |
| `GET /api/events` | SSE from Redis pub/sub |
| `POST /api/measure/challenge` | `{ wallet, ca }` → nonce + message to sign (5 min, single use, stored in `AuthChallenge`) |
| `POST /api/measure` | `{ ca, wallet, nonce, signature }` → Ed25519 check → `measureCoin` (pre-commit anchor → QRNG → proof anchor → `applyMeasurement`) → persisted `Measurement` with `precommitTx`/`proofTx` |
| `GET /api/launch/quote` | cost breakdown + pay-to address |
| `POST /api/launch` | multipart form → SSE of the real launch (below) |
| `GET /api/coins`, `GET /api/coin/[ca]`, `GET /api/coin/[ca]/holders`, `GET /api/coin/[ca]/image` | coins |
| `GET /api/lineage/[id]`, `GET /api/stats`, `GET /api/log`, `GET /api/burns`, `GET /api/me?wallet=`, `GET /api/how` | pages |

Every handler that touches the database runs under `guarded()`: a connection
failure returns **HTTP 503 `{ unavailable: { reason } }`**; the client helper
(`src/lib/api.ts`) returns that as a value so pages render the honest state.

## Launch streaming design

`POST /api/launch` validates the multipart form, verifies the wallet's payment
transaction on-chain (a SOL transfer of launch cost + identity reserve + dev
buy to the protocol creator, signed by the wallet, unused before), then runs
`src/server/launch.ts` as an async generator of SSE frames:

| frame | payload | scene input |
| --- | --- | --- |
| `status` | `{ step, message }` | caption |
| `crypto` | base64 of `encodeCryptoEvents(batch)` (`@qsd/scene/model` codec, 4096 events per batch) | `store.dispatchMany(decodeCryptoEvents(...))` — stages 2, 3 and 6 |
| `superposition` | `SuperpositionInput` (bigints as strings) | stage 4 |
| `quantum` | `QuantumEvent` with `bytes` as hex | stage 5 |
| `chain` | scene `ChainEvent` (`anchorSubmitted` / `anchored { txSignature }`) | stage 7 |
| `launch` | `{ ca, txSignature, path }` | — |
| `lineage` | `LineageInput` | stage 8 |
| `done` / `error` | | |

**Identity generation runs on the server** inside the protocol's identity
reserve (`chain.reserve.createForCoin(ca, { observer })`): the seed is drawn
there, encrypted into the vault and never leaves it, and the reserve's
`Signer` is the only signing path (one identity, one store). The
key-generation stream is redacted with `@qsd/crypto` `redactEvent` before it
is sent: chain values at depth 0–14 are one-time secret key material and are
replaced by their SHA-256 ("still a real, verifiable commitment" — crypto
README §3); tips, leaves, fused nodes, the root and the whole signing stream
are the real values. `createIdentity` is synchronous (~3 s), so its 292 097
events are batched in memory and flushed as fast as the connection accepts;
nothing is paced or animated. The quantum draw at launch resolves the
**lineage id** (resolver `qsd/launch-lineage/v1`: bytes 0–15 → hex), is
pre-committed and anchored like a measurement, and its bundle is stored on
the coin (`Coin.launchBundle`). The launch statement
`{ ca, identityRoot, lineageId, launchBundleHash, imageHash, halfLifeSec }`
is signed with the identity's first one-time key. On devnet the coin is a
plain SPL mint (`launchDevnetSplToken`) and the page says so; on mainnet
`launchOnPumpFun`.

## Measurement on `/coin/[ca]`

Every measurement card verifies its bundle **in the browser** with
`verify(bundle, measurementResolver, { trustedWitnessKeys: NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS, requireInputBinding: true })`
and shows `ProofBadge` with the bundle's attestation kind verbatim. The card
lists the bundle inputs (`at`, `lastActivityAt`, `halfLifeSec`,
`decayProgressPpb`, `measurementIndex`) and recomputes the decay probability
from them with `decayProgressPpbFromInputs`. The `MeasureButton` text is
computed from `collapseRewards(remainingUnits)`, `PROTOCOL_PARAMS` and the
live `decayProgress`; it is disabled with the reason when the wallet is not
connected, the QRNG provider or chain is not configured (`/api/stats.health`),
or the coin is collapsed. After a measurement the `MeasurementScene` replays
the four draw events from the returned proof bundle (the draw itself runs on
the server; the values shown are the bundle's).

The daughter ghost computes the connected wallet's projected allocation
client-side with `computeAllocation` over the trade-log holder reconstruction,
using the band **minimum** as the pool (the pool point is only drawn at
collapse); without a wallet, trade history, or a position it is unavailable.

## Data

`prisma/schema.prisma` mirrors `@qsd/protocol`: `Coin`, `Channel`,
`Measurement` (proof bundle JSON, outcome, decay before/after, `precommitTx`,
`proofTx`, attestation kind), `Lineage`, `AllocationTable` + `AllocationEntry`
(bigint units), `AirdropEntry` (read-only mirror of the airdrop journal),
`Burn`, `Trade` + `BalanceChange` (from Helius webhooks and airdrop credits),
`Identity` (display mirror of the reserve: root, pubSeed, next index, used
bitmap, remaining keys), `EventLog`, `AuthChallenge`, `CoinImage` (devnet
images; served at `/api/coin/[ca]/image`).

`HoldingHistory` for `@qsd/solana` `holderSnapshotAtSlot` is
`src/server/holdingHistory.ts`: `firstAcquiredAt` is the start of the current
unbroken holding period from the wallet's `BalanceChange` rows (a running
balance that returns to zero restarts the period); measurements held through
are those after it; the quiet-period flag is `firstAcquiredAt ≤
quietPeriodStart` with a positive balance. A wallet the log has never seen is
refused (the snapshot throws), never guessed.

Two display normalisations exist and are not protocol quantities:
`activity` (buys in the last 24 h / 10, saturating, for the field vessels) and
the market cap used for the Zeno reset, which is implied by each buy
(`lamports / tokenUnits × remainingUnits`); neither is shown as a number.

## Workers (`src/workers/index.ts`)

`auto-measure` (repeat every minute: `autoMeasureDue` → `performMeasurement`
with `by = 'protocol'`), `collapse` (`executeCollapse`, resumable, enqueued on
every collapse outcome with a stable job id), `hourly-burn` (cron `0 * * * *`
when `QSD_TOKEN_MINT` is set), `ingest-trades`, `snapshot` (identity mirror).

## Tests (`test/`)

Footer on every route; every page's honest state against `{ unavailable }`
and against empty arrays; counters unavailable on 503 and `0` on a real zero;
no digit on any page rendered against `{ unavailable }` except the listed
structural copy (step numbers `01–04`, the half-life preset labels on
`/launch`, "1.0 and 1.5" quoted from economics.md, "SHA-256", and the test
coin address in the page header); `/how` contains the exact first heading and
every summary-table row of each document; the Helius webhook rejects bad auth
and stores a trade from `@qsd/solana`'s documented fixture; `/api/measure`
refuses without wallet auth; the SSE crypto codec round trip; docs resolution.

`src/copy.ts` holds every user-facing string.
