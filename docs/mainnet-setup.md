# Getting every mainnet variable

There are four sources: one command you run yourself, five sign-ups, two choices you make, and one coin you launch. Put every value in your host's environment settings (Vercel → Project → Settings → Environment Variables, plus the worker host). Never commit them.

## 1. Run one command (7 secrets, offline)

```sh
pnpm install
pnpm --filter @qsd/solana generate-secrets > qsd-secrets.env
```

This prints the following, generated on your machine with nothing sent anywhere:

| Variable | What it is |
|---|---|
| `QSD_KEY_ENCRYPTION_KEY` | Encrypts every key at rest. If you lose it, every stored key is unreadable. |
| `QSD_PROTOCOL_CREATOR_SECRET` | The creator wallet, encrypted with the key above. |
| `QSD_FEE_WALLET` | That wallet's public address. **Send SOL to it**: it pays for every launch, airdrop and burn. |
| `QSD_WITNESS_SECRET_KEY` | Signs each quantum random draw. |
| `QSD_WITNESS_PUBLIC_KEYS` and `NEXT_PUBLIC_QSD_WITNESS_PUBLIC_KEYS` | The matching public key, the same value in both. |
| `QSD_WEBHOOK_SECRET` | Shared password for Helius webhooks (see step 2). |

If you already have a Solana wallet you want to use as the creator, pass its CLI keypair file: `pnpm --filter @qsd/solana generate-secrets ~/my-wallet.json`.

Save `qsd-secrets.env` in a password manager, then delete the file.

## 2. Sign up for five services

| Variable(s) | Where to get it |
|---|---|
| `HELIUS_API_KEY`, `SOLANA_RPC_URL` | [helius.dev](https://www.helius.dev): create a project and copy the API key. `SOLANA_RPC_URL` is `https://mainnet.helius-rpc.com/?api-key=<key>`. Leave `NEXT_PUBLIC_SOLANA_RPC_URL` empty: the browser's wallet then goes through the site's own `/api/rpc` relay, so the key stays on the server (the public mainnet endpoint refuses browsers). |
| `PINATA_JWT` | [pinata.cloud](https://pinata.cloud): API Keys → New Key (admin or `pinFileToIPFS` + `pinJSONToIPFS`) → copy the **JWT**. pump.fun uses it to store coin images and metadata. |
| `JUPITER_API_KEY` | [portal.jup.ag](https://portal.jup.ag): create a key. Only the hourly $QSD buy-and-burn uses it. |
| `QSD_QRNG_API_KEY` | ANU Quantum Numbers on [AWS Marketplace](https://aws.amazon.com/marketplace) (search "ANU Quantum Numbers"): subscribe, then copy the API key from quantumnumbers.anu.edu.au. Without it, no coin can be measured. |
| `DATABASE_URL`, `REDIS_URL` | Postgres from [Neon](https://neon.tech) (or Vercel Postgres) and Redis from [Upstash](https://upstash.com). Copy each connection string. Then run `pnpm --filter web prisma:migrate` once against the database. |

When the site is live, register the Helius webhook at `https://<your-domain>/api/webhooks/helius` (Helius dashboard → Webhooks, type *enhanced*), with **Auth Header** set to your `QSD_WEBHOOK_SECRET`.

## 3. Set the launch price

A user pays the sum of three amounts, in lamports (1 SOL = 1 000 000 000). The values below make a launch cost 0.15 SOL.

| Variable | Value | Meaning |
|---|---|---|
| `QSD_LAUNCH_COST_LAMPORTS` | `40000000` | Launch fee (0.04 SOL): pays for creating the coin and its proof transactions. |
| `QSD_IDENTITY_RESERVE_LAMPORTS` | `10000000` | Identity reserve (0.01 SOL): pays for the coin's future on-chain signatures. |
| `QSD_LAUNCH_DEV_BUY_LAMPORTS` | `100000000` | Fixed dev buy (0.10 SOL). Its tokens stay with the protocol and fund the coin's collapse reward, so it must be above 0 on mainnet. |

Until all three are set, `/launch` says "not available" and refuses to launch.

`/launch` also needs `QSD_GENESIS_CONFIG`, the generation-1 channel table (airdrop pool of 0.30–0.34 % of supply). On Vercel paste the JSON itself:

```
QSD_GENESIS_CONFIG={"supplyUnits":"1000000000000000","decimals":6,"poolUnits":{"min":"3000000000000","max":"3400000000000"},"channels":[{"id":"fast","probabilityPpm":500000,"label":"fast decay","halfLifeSec":{"min":3600,"max":86400},"poolUnits":{"min":"3000000000000","max":"3200000000000"}},{"id":"slow","probabilityPpm":500000,"label":"slow decay","halfLifeSec":{"min":86400,"max":604800},"poolUnits":{"min":"3200000000000","max":"3400000000000"}}]}
```

**Collapses are paid by the fee wallet, not by users.** Each daughter is launched with a dev buy just large enough to cover its airdrop pool. With `genesis.example.json` the pool is 0.30–0.34 % of the daughter's supply, which costs just under 0.1 SOL (estimated from pump.fun's starting price), plus network fees. The collapse reward (normally 1 % of the mother's supply, 20 % of it to the measurer, the rest burned) is capped to the mother tokens the launch dev buy bought, about 0.35 %, so nothing else is bought. A collapse the wallet can't afford stops and resumes after you top it up.

| Variable | Default | Meaning |
|---|---|---|
| `QSD_DAUGHTER_DEV_BUY_MAX_SOL` | `0.1` | Largest daughter dev buy allowed; a bigger pool waits. |
| `QSD_REWARD_SHORTFALL_MAX_SOL` | `0` | `0` caps the reward to what the treasury holds. Above `0`, the wallet buys the rest of the 1 % on the curve, up to this much SOL. |

Launch fees leave only about 0.02 SOL each after costs (estimate), so expect to fund collapses yourself (about 0.1 SOL each). `QSD_MAX_COLLAPSES_PER_DAY` (default `3` on mainnet) caps how many collapses run in any 24 hours; extra ones wait their turn.

**Launch phase.** With `QSD_FAST_LAUNCH_PHASE=true`, every new coin gets a 30-second half-life and the worker measures it after 60 quiet seconds, so with no trading it usually collapses within a minute or two and its daughter appears a few minutes later (the launch and airdrop transactions take that long). Daughters keep the genesis half-lives (1 hour or more), so only the first generation is fast. This needs the worker running.

## 4. Launch the $QSD coin

`QSD_TOKEN_MINT` is the address of the $QSD coin itself. Launch it on pump.fun from the fee wallet, then paste its mint address. Until it is set, there is no hourly burn and `/burns` says so. Everything else works without it.

The burn only spends creator fees the fee wallet has collected from its pump.fun creator vault. Your top-ups and users' launch payments are never counted as fees, so funding the wallet is safe with the burn on.

## 5. Fixed values

```
SOLANA_CLUSTER=mainnet-beta
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
QSD_MAINNET_ENABLED=true
QSD_QRNG_PROVIDER=anu-quantum-numbers
NODE_ENV=production
```

Leave `PUMPPORTAL_API_URL`, `JUPITER_API_URL` and `QSD_QRNG_ENDPOINT` at their defaults.

## 6. Keys live in the database

Each coin's mint key and identity seed, the identity's one-time-key state, and the crash-resume journals for airdrops and collapses are stored in Postgres (table `ChainKv`), with keys encrypted under `QSD_KEY_ENCRYPTION_KEY`. Losing them means the protocol can no longer sign for that coin, so:

- The table is created automatically: every Vercel build applies pending migrations (`prisma migrate deploy`). Nothing to run by hand.
- Turn on backups for the database (Neon keeps point-in-time history on paid plans).
- Leave `QSD_KEYSTORE_PATH` and `QSD_JOURNAL_DIR` unset. Setting them switches back to files, which only makes sense on a host with a persistent disk.
- Only then set `QSD_MAINNET_ENABLED=true`.

**The worker** (`pnpm --filter web worker`, which runs measurements, collapses and burns) still can't run on Vercel, because it is a long-running process. Run it on any always-on host (Railway, Fly.io or a small VPS) with the same environment. It no longer needs a disk.
