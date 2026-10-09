# @qsd/solana

The chain layer of qsd.market: pump.fun launches, holder snapshots, proof
anchoring, the allocation airdrop, buy-and-burn, Helius trade webhooks, keys
encrypted at rest and the per-coin **identity reserve** (the persistent
one-time-key state for `@qsd/crypto`). It executes what `@qsd/protocol`
computes (protocol README §7) and never invents a chain value: anything it
cannot do throws `NotImplementedError` or `ChainUnavailableError` with the
reason. No fake signatures, holders or balances, on any cluster.

```ts
import { loadChainConfig, createChain, measureCoin, executeCollapse, runAirdrop, parseHeliusWebhook, hourlyBuyAndBurn } from '@qsd/solana';
```

## 1. Environment

`loadChainConfig(env)` reads everything once. It throws `ChainConfigError`
naming the variable — never its value — when something is missing or
malformed. **Mainnet requires the explicit integrator flag**:
`SOLANA_CLUSTER=mainnet-beta` without `QSD_MAINNET_ENABLED=true` throws.

| Variable | devnet | mainnet | Meaning |
|---|---|---|---|
| `SOLANA_CLUSTER` | `devnet` (default) | `mainnet-beta` | Cluster. |
| `QSD_MAINNET_ENABLED` | ignored | **required `true`** | The explicit mainnet switch. |
| `SOLANA_RPC_URL` | optional (default `https://api.devnet.solana.com`) | recommended (Helius/Triton…) | JSON-RPC endpoint for sends, confirmations, `getProgramAccounts`. |
| `HELIUS_API_KEY` | optional | recommended | Enables the DAS `getTokenAccounts` snapshot source (`heliusRpcUrl(cfg)`) and webhook registration. Without it, snapshots fall back to `getProgramAccounts`. |
| `PUMPPORTAL_API_URL` | unused (pump.fun is mainnet-only) | optional (default `https://pumpportal.fun/api`) | PumpPortal Local Transaction API base. |
| `PINATA_JWT` | unused | **required for launches** | Pinata upload JWT for pump.fun IPFS metadata (PumpPortal's documented path; the old `pump.fun/api/ipfs` is gone). |
| `JUPITER_API_URL` | unused (no $QSD on devnet) | optional (default `https://api.jup.ag`) | Jupiter Swap V2 base. |
| `JUPITER_API_KEY` | unused | required by Jupiter for `api.jup.ag` | Sent as `x-api-key`. |
| `QSD_KEY_ENCRYPTION_KEY` | **required** | **required** | 32 bytes hex. Encrypts every keypair/seed at rest (§4). |
| `QSD_PROTOCOL_CREATOR_SECRET` | optional | **required** | The protocol creator keypair as an `EncryptedBlob` JSON (inline) or a path to one, label `qsd/protocol-creator`. If unset, the key store is searched under that label. |
| `QSD_KEYSTORE_PATH` | optional (memory store) | **required** | File-backed `KeyStore` (`<path>`) and identity reserve (`<path>.reserve.json`). Mainnet refuses memory-only stores. |
| `QSD_JOURNAL_DIR` | optional (memory journals) | **required in practice** | Directory for airdrop / collapse / burn / measurement journals (crash-resume). |
| `QSD_TOKEN_MINT` | unset | **required for buy-and-burn** | The $QSD mint. `hourlyBuyAndBurn` throws without it. |
| `QSD_FEE_WALLET` | optional | required for buy-and-burn | Fee wallet; must be the sender payer of the burn job. |
| `QSD_WEBHOOK_SECRET` | required to accept webhooks | required | The `authHeader` value registered with Helius; compared (constant-time) with the incoming `Authorization` header. |
| `QSD_WITNESS_PUBLIC_KEYS`, `QSD_QRNG_*` | see `@qsd/quantum` | see `@qsd/quantum` | Read by `productionVerifyOptions()` / `createProviderFromEnv()`. |

`describeConfig(cfg)` returns a loggable copy with every secret replaced by
`[set]`/`[unset]`; `redactSecrets()` is applied to every error message that
embeds upstream text (hex keys, bearer tokens, `api-key=` query params).
The secret fields of the returned `ChainConfig` (`keyEncryptionKey`,
`heliusApiKey`, `pinataJwt`, `jupiterApiKey`, `protocolCreatorSecret`,
`webhookSecret`) are **non-enumerable**: readable by name, invisible to
`JSON.stringify`, `util.inspect` and object spread — so pass the object
`loadChainConfig` returned, never `{ ...cfg }`. `toJSON`/`inspect` of the
config, of `createChain()`'s result and of every sender/reader print only
cluster and payer. The payer keypair lives in `#private` fields.

The mainnet flag is enforced at every entry point: `loadChainConfig` (env),
and `createChain` → `assertClusterAllowed(cfg)`, which refuses any config
whose `cluster`, `isMainnet` and `mainnetEnabled` (set only when the env
said `true`) do not all agree, and a devnet config whose RPC URL names
mainnet. Mainnet also refuses memory-only key stores.

### Devnet / mainnet split — what is NOT possible from devnet

* **pump.fun has no devnet deployment.** PumpPortal's docs (below) describe
  mainnet only. `launchOnPumpFun` throws
  `ChainUnavailableError('pump.fun launches are mainnet-only …')` on devnet.
  Devnet uses `launchDevnetSplToken`: a plain Token-program mint
  (`createAccount` + `initializeMint2` + ATA + `mintTo`, one transaction, no
  Metaplex token-metadata — kept off to avoid the dependency, so the devnet
  coin has no on-chain name/symbol). It is enough for the full
  snapshot → allocation → airdrop → anchor path with real devnet
  transactions.
* **No $QSD on devnet**, so `hourlyBuyAndBurn` has nothing to buy; and
  Jupiter routes mainnet only.
* Helius serves devnet (`enhancedDevnet` webhooks, `devnet.helius-rpc.com`
  DAS) when a key is set.

## 2. External APIs confirmed (fetched 2026-10-09)

**PumpPortal Local Transaction API** — <https://pumpportal.fun/creation>

1. Upload the image, then the metadata JSON, to IPFS through Pinata:
   `POST https://uploads.pinata.cloud/v3/files`, header
   `Authorization: Bearer <PINATA_JWT>`, multipart fields `network=public`,
   `file=<bytes>` → `{ data: { cid } }` → `https://ipfs.io/ipfs/<cid>`.
   The page states: *"The old pump.fun/api/ipfs endpoint is no longer
   supported."* Metadata JSON: `{ name, symbol, image, description?, twitter?, telegram?, website?, showName? }`.
2. `POST https://pumpportal.fun/api/trade-local`, `content-type: application/json`:
   ```json
   { "publicKey": "<creator>", "action": "create",
     "tokenMetadata": { "name": "...", "symbol": "...", "uri": "https://ipfs.io/ipfs/<cid>" },
     "mint": "<fresh mint pubkey>", "denominatedInSol": "true",
     "amount": 0.5, "slippage": 10, "priorityFee": 0.0005, "pool": "pump" }
   ```
   HTTP 200 → the body **is** the serialized `VersionedTransaction`
   (`arrayBuffer`, not JSON).
3. `tx.sign([mintKeypair, creatorKeypair])`, send through our own RPC.

`buildPumpPortalCreateRequest()` is the pure builder (tested for exact shape
and key order); `launchOnPumpFun()` is the live path. The mint keypair is
generated per launch and stored encrypted in the vault (`qsd/mint/<ca>`);
the protocol-held creator keypair signs as creator — automatic, no human.

**Jupiter** — <https://developers.jup.ag/docs/swap/v2/get-quote.md>. The
docs mark Swap V1 (`api.jup.ag/swap/v1/quote` + `/swap`) as *"no longer
actively maintained and has been superseded by Swap V2"*, so this package
uses V2: `GET https://api.jup.ag/swap/v2/order?inputMint&outputMint&amount&taker&slippageBps`
with `x-api-key`, which returns `{ requestId, transaction (base64, when
taker is set), outAmount, … }`. We sign the transaction and send it through
our RPC (Jupiter also offers `POST /execute`). `buildJupiterOrderRequest()`
is the tested builder.

**Helius**
* Webhook auth — <https://www.helius.dev/docs/faqs/webhooks.md>: the
  `authHeader` set at registration is *"echoed … in the `Authorization`
  header when sending data to your webhook endpoint"*.
* Payload — <https://www.helius.dev/docs/webhooks>: a JSON array of
  enhanced transactions with `signature, slot, timestamp, type, source, fee,
  feePayer, nativeTransfers[{amount, fromUserAccount, toUserAccount}],
  tokenTransfers[{fromTokenAccount, fromUserAccount, mint, toTokenAccount,
  toUserAccount, tokenAmount, tokenStandard}], accountData, events`. `SWAP`
  is a listed type (<https://www.helius.dev/docs/webhooks/transaction-types.md>).
  `events.swap` (`nativeInput/nativeOutput/tokenInputs/tokenOutputs` with
  `rawTokenAmount`) follows the Helius SDK `SwapEvent`; the public pages
  fetched today only show the NFT event, so the parser treats `events.swap`
  as an optional refinement and the documented transfer arrays as the primary
  signal. `test/fixtures/helius-enhanced-swap.json` is a **documented
  example, not live data**, and is labelled so.
* Registration — <https://www.helius.dev/docs/api-reference/webhooks/create-webhook.md>:
  `{ webhookURL, transactionTypes, accountAddresses, webhookType:
  'enhanced' | 'enhancedDevnet', authHeader, txnStatus }`
  (`buildHeliusWebhookRegistration()`).
* DAS — <https://www.helius.dev/docs/api-reference/das/gettokenaccounts>:
  `getTokenAccounts { mint, limit, cursor?, options: { showZeroBalance } }` →
  `{ total, limit, cursor?, token_accounts[{ address, mint, owner, amount,
  delegated_amount, frozen }] }` (cursor-paginated, 1000 per page).

Memo program: `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, instruction
built by hand (`createMemoInstruction`), max 566 bytes.

## 3. Modules and public API

| module | exports |
|---|---|
| `config` | `loadChainConfig`, `ChainConfig`, `ENV`, `heliusRpcUrl`, `describeConfig`, defaults |
| `errors` | `ChainError`, `NotImplementedError`, `ChainUnavailableError`, `ChainConfigError`, `KeyVaultError`, `JournalError`, `WebhookAuthError`, `TransientChainError`, `InvalidCollapseError`, `redactSecrets`, `isTransient` |
| `keys` | `KeyVault`, `KeyStore`, `MemoryKeyStore`, `FileKeyStore`, `encryptKeypair`/`decryptKeypair`, `encryptBytes`/`decryptBytes`, `EncryptedBlob`, `loadCreatorKeypair`, `CREATOR_KEY_LABEL` |
| `reserve` | `PersistentStateStore` (implements `@qsd/crypto` `StateStore`), `ReserveBackend`, `MemoryReserveBackend`, `FileReserveBackend`, `IdentityReserve` |
| `journal` | `JournalStore`, `MemoryJournalStore`, `FileJournalStore`, `withRetry`, bigint-safe JSON helpers |
| `observer` | `ChainObserver` (`subscribe(listener) ⇒ unsubscribe`, monotonic `seq`), `ChainEvent`, `recordChainEvents` |
| `memo` | `createMemoInstruction`, `encodeAnchorMemo`/`decodeAnchorMemo`, `createAnchorMemoInstruction`, `MEMO_PROGRAM_ID` |
| `sender` | `TransactionSender`, `Web3TransactionSender`, `ChainReader`, `Web3ChainReader`, `TxStatus`, `createConnection` |
| `anchor` | `anchorCommitment(hash, kind, deps, nonce?)`, `anchorWith(deps) ⇒ AnchorFn`, `AnchorResult` |
| `snapshot` | `holderSnapshotAtSlot`, `HoldingHistory`, `TokenAccountSource`, `HeliusDasSource`, `ProgramAccountsSource`, `mergeByOwner` |
| `launch` | `launchOnPumpFun`, `launchDevnetSplToken`, `launchDaughter`, `buildPumpPortalCreateRequest`, `uploadTokenMetadata`, `buildDevnetSplMintInstructions` |
| `airdrop` | `runAirdrop`, `TransferSender`, `Web3TransferSender`/`web3TransferSender`, `AirdropJournal`, `MemoryAirdropJournal`, `FileAirdropJournal`, `computeMaxTransfersPerTx`, `buildTransferInstructions`, `transactionSize` |
| `burn` | `hourlyBuyAndBurn`, `buildJupiterOrderRequest`, `fetchJupiterOrder`, `FeeLedger`, `Web3FeeLedger`, `BurnJournal`, `WSOL_MINT` |
| `webhooks` | `parseHeliusWebhook`, `verifyWebhookAuth`, `buyEventsFromTransaction`, `BuyEvent`, `buildHeliusWebhookRegistration` |
| `measure` | `measureCoin`, `autoMeasureDue`, `autoMeasureAll`, `productionVerifyOptions`, `MeasurementJournalDoc` |
| `collapse` | `executeCollapse`, `CollapseJournal`, `CollapseJournalDoc`, `COLLAPSE_STEPS`, `CollapseOutcome` |
| `chain` | `createChain(config)` — wires connection, vault, reserve, observer, snapshot sources, fee ledger, journals, and `withCreator()` → sender/reader/transferSender/anchor |

### Events (`ChainObserver`)

`anchorRequested {kind, hash}` → `anchored {kind, hash, txSignature, cluster}`
(scene stage 7 shows the real signature), `airdropBatchSent`,
`airdropBatchConfirmed`, `burnSent`, `daughterLaunched`, `collapseStep
{step, started|done|skipped}`. Every value is a real chain value.

## 4. Keys at rest

Every keypair and seed is encrypted with **XChaCha20-Poly1305**
(`@noble/ciphers`) under the 32-byte `QSD_KEY_ENCRYPTION_KEY`: random
24-byte nonce, AAD = the blob's label (so a blob cannot be re-labelled or
moved to another slot), blob `{ v:1, alg:'xchacha20poly1305', label, nonce,
ct }`. `KeyStore` implementations (`MemoryKeyStore`, `FileKeyStore` — one
JSON file, mode 0600, atomic rename) only ever see ciphertext. The vault's
key lives in a `#private` field; `JSON.stringify(vault)` shows nothing.
Decryption failures say only "authentication failed". Labels in use:
`qsd/protocol-creator`, `qsd/mint/<ca>`, `qsd/identity-seed/<ca>`.

## 5. Identity reserve

`IdentityReserve` = registry `{ ca → identityRoot, pubSeed, seedLabel }` +
`PersistentStateStore`, the durable `StateStore` for `@qsd/crypto`:

* `put(root, state, expected)` has the reference semantics (`null` =
  nothing stored yet, a state = the stored `used` bitmap must still equal
  `expected.used`) **plus a version counter** checked by the backend's
  atomic `writeState(root, record, expectedVersion)`; `FileReserveBackend`
  also takes an exclusive lock file (`<file>.lock`, O_EXCL, stale after
  10 s) around every read-modify-write so two processes cannot both reserve
  an index. A used bit is never cleared (merge, never overwrite).
* `createForCoin(ca)` draws a 32-byte seed, builds the identity (≈ 3 s), stores
  the seed encrypted, writes the initial state with `expected = null`.
  `identityFor(ca)` rebuilds the identity from the seed and checks the root;
  `signerFor(ca)` returns `@qsd/crypto`'s `Signer` over the persistent
  store, the only signing path.
* Tested: CAS conflicts, reuse refused after a "restart" (store reopened over
  the same bytes, memory and file), concurrent signers on one file never
  share an index, seed never in the store in clear.

## 6. Measurement (`measureCoin`) — with the H-Q3 pre-commitment

```
inputs     = measurementInputs(coin, at)             inputsHash = hashJson(inputs)
nonce      = 32 random bytes (hex)
precommit  : memo  qsd:v1:precommit:<inputsHash>:<nonce>   ← anchored INSIDE client.measure's beforeDraw, so no anchor ⇒ no draw
draw       = @qsd/quantum client.measure(inputs, measurementResolver, { nonce, beforeDraw })  (binds inputsHash+nonce into the attestation)
proof      : memo  qsd:v1:proof:<bundleHash(bundle)>
apply      = applyMeasurement(coin, bundle, { at, by, verify })
```

Both signatures are journalled (`MeasurementJournalDoc`: `precommitTx`,
`bundleHash`, `proofTx`) for the proof panel. In production pass
`verify: productionVerifyOptions()` (= `{ trustedWitnessKeys:
trustedWitnessKeysFromEnv(), requireInputBinding: true }`); devnet tests
with `UNSAFE_DEV_RANDOM` pass `{ allowUnsafeDev: true }` (the dev provider
carries no binding, and is only constructible with `NODE_ENV=test` or
`development` + `QSD_ALLOW_UNSAFE_DEV=1`). `autoMeasureDue(coins, now)` /
`autoMeasureAll` measure with `by = PROTOCOL_PARAMS.AUTO_MEASURER_ID`.

## 7. Collapse (`executeCollapse`) and the journals

Steps, each journalled as `done` with its result (bigint-safe JSON) and
skipped on resume (and each transaction inside a step journalled by
signature, see below): `snapshot` (holders at the collapse slot, *before* any
token moves) → `rewards` (`collapseRewards`: burn + measurer transfer from
the treasury's mother holdings; the auto-measurer's share is burned) →
`daughter-key` (mint keypair into the vault) → `daughter-identity`
(reserve) → `daughter-launch` (pump.fun / devnet SPL; supply read back from
the chain) → `allocation` (`deriveDaughterParams`, `resolvePoolUnits`,
`computeAllocation`, `buildDaughterCoin`) → `airdrop` → `dust-burn`.
The treasury must hold the reward units and the resolved pool; otherwise
the collapse stops with `ChainUnavailableError` rather than paying less.

### Airdrop crash-resume guarantee (and in-process retry)

A Solana signature is a deterministic function of the signed transaction,
so every batch is journalled — `entries[w] = sent { txSignature,
lastValidBlockHeight }` and `batches[sig] = { wallets, status: 'sent' }` —
**before** it is submitted. From then on the invariant is: *an entry
journalled `sent` under signature S is moved only by the chain's verdict on
S.* `confirmed`/`finalized` → `confirmed` (never re-sent); `failed` or
`expired` (signature not found **and** block height past
`lastValidBlockHeight`, so it can never land) → back to `pending`;
`pending` → wait (`confirm()` polls until the blockhash expires). A thrown
`submit()`, a `confirm()` timeout, a transient status error, a crash: none
of them move an entry, and the loop always re-reads the journal rather than
re-using records captured in a closure. On every start the run first
reconciles every batch record in the journal (including signatures no entry
points at any more) before preparing anything new. The allocation Merkle
root is anchored once and journalled. Batches hold at most
`computeMaxTransfersPerTx()` transfers — computed by serialising a real v0
transaction against the 1232-byte packet limit (≈ 9–10 ATA-create +
transfer pairs), not guessed. The retry budget (`maxAttemptsPerBatch`) is
per run; when it is spent the run throws `ChainUnavailableError` and a
later run resumes with a fresh budget. An on-chain failure throws (no
blind retry) and the next run re-sends that batch only.

**Lease.** The airdrop and collapse journals are `Leasable`: a run takes a
lease (`{ owner, expiresAt }`, TTL `leaseTtlMs`, default 30 s) with a
compare-and-swap on the document's version counter, and every save re-checks
the version and the owner (`LeasedJournal`). A second worker that finds a
live lease waits for it to be released or to expire; the lease is released
in `finally`, so a worker that exits by exception frees it at once and only
a hard kill leaves it to expire. Journals: `AirdropJournal` (memory / file),
`CollapseJournal`, `BurnJournal`, `MeasurementJournalDoc` — all atomic
writes (tmp + rename).

**Inside collapse steps.** `rewards` (burn, measurer transfer),
`daughter-launch` and `dust-burn` journal each transaction under
`sends['<step>.<name>']` as soon as its signature is known — before
submission when the sender implements `prepare()` (the real
`Web3TransactionSender` does), otherwise right after `send()` returns and
before confirmation (`sendTracked`). On resume a `sent` record is settled by
status before anything is re-sent. The daughter launch is additionally
idempotent from the mint itself: if `getTokenSupply(mint)` succeeds the
launch happened and the journalled signature is reused; a mint that exists
with no journalled signature stops the collapse with a clear error instead
of guessing one. The allocation-root anchor carries no tokens; a crash while
it confirms re-anchors the same root (duplicate memo, harmless).

Tested in this package (fault-injecting `TransferSender` fake over an
in-memory ledger that executes the real instructions) and independently by
`/tests/solana` (Agent H's own ledger): crash after journal-sent/before
submit, crash after submit/before confirm, submit that throws after the RPC
accepted the transaction (lands later), confirm timeout with the batch in
flight, dropped/rejected/failed/expired batches, two workers resuming the
same journal concurrently, crashes inside the reward burn, the dust burn and
the daughter launch, plus a random-fault property; in every case Σ
transferred == table total exactly, no wallet is paid twice, every burn and
the launch happen exactly once.

## 8. Buy-and-burn (`hourlyBuyAndBurn`)

Tally = Σ positive balance deltas of the fee wallet over
`getSignaturesForAddress(feeWallet, { until: lastTalliedSignature })`
(journalled cursor) → Jupiter V2 `/order` SOL→$QSD for the spendable amount
(keeps `reserveLamports`, skips below `minSwapLamports`) → sign + send →
`createBurnInstruction` for 100 % of the fee wallet's $QSD → journal every
signature. An interrupted run resumes (swap re-checked by signature before
burning).

## 9. Snapshot honesty

Neither DAS nor `getProgramAccounts` serves historical state; both return
the ledger at their `observedSlot`. The collapse worker takes the snapshot
at the collapse moment and the result records `requestedSlot`,
`observedSlot` and `slotLag = observedSlot − requestedSlot` (the UI should
show the lag); data observed before the collapse slot is refused. Pass
`collapseSlot` (the slot of the collapse measurement's proof-anchor
transaction, from the measurement journal) to `executeCollapse` so the
requested slot is the collapse itself; without it the orchestration start
slot is used and journalled as `collapseSlotSource: 'orchestration-start'`.
Trades between the proof anchor and the worker's first run are inside the
lag either way, because no public source serves slot-pinned balances today
(Helius DAS does not).
`firstAcquiredAt`, measurements held through and the quiet-period flag come
only from the app's `HoldingHistory` (its trade DB fed by the webhooks);
without one `holderSnapshotAtSlot` throws `NotImplementedError` — it never
defaults them.

## 10. Devnet e2e

`scripts/devnet-e2e.ts` (`pnpm --filter @qsd/solana devnet-e2e`) with
`SOLANA_RPC_URL` (devnet), `QSD_KEY_ENCRYPTION_KEY` and a funded
`QSD_DEVNET_PAYER` mints a token, distributes to 3 generated wallets,
anchors a memo, snapshots via `getProgramAccounts`, computes an allocation,
runs the airdrop with a file journal (set `QSD_E2E_JOURNAL` to replay a
resume), burns the dust and prints every signature. It refuses mainnet.
**It could not be run from the build sandbox: outbound CONNECT to
`api.devnet.solana.com` (and pumpportal.fun, jup.ag, helius.dev RPC) is
denied by the egress proxy (HTTP 403, organisation policy).** Running it is
the integrator's step. `test/network.test.ts` likewise skips with a printed
reason when no reachable `SOLANA_RPC_URL` is set.

## 11. Tests

`pnpm --filter @qsd/solana test` (vitest, ≈ 60 s; identity key generation
dominates) and `typecheck`. Config guard and redaction; KeyVault round trip
/ tamper / label / file store; persistent state store CAS and reuse across
restart (memory + file, concurrent signers); memo encoding incl. precommit;
airdrop crash-resume matrix and batch sizing under 1232 bytes; journal
idempotency and bigint round trip; Helius parser against the documented
fixture + bad-auth rejection + registration body; PumpPortal and Pinata
request shapes (mocked fetch, no network) and the devnet refusal; devnet SPL
mint; Jupiter V2 request shape and buy-and-burn tally/journal; `measureCoin`
ordering (precommit anchored before `entropyRequested`, proof after) with a
verifiable bundle and both signatures journalled; full `executeCollapse`
against the in-memory ledger with a crash in the airdrop and a resume that
repeats no paid step, every holder paid its exact units, root anchored once,
proofs verify. Network tests skip (not fail) without an RPC.

`bigint: Failed to load bindings` printed by `@solana/web3.js` is the
optional native `bigint-buffer` binding (pnpm ignored its build script);
the pure-JS path is used and is correct.
