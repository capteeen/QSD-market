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
| `HELIUS_API_KEY`, `SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_RPC_URL` | [helius.dev](https://www.helius.dev): create a project and copy the API key. The RPC URL is `https://mainnet.helius-rpc.com/?api-key=<key>`. Use the same URL for both RPC variables, or make a second key restricted to your domain for the public one, because the browser can see it. |
| `PINATA_JWT` | [pinata.cloud](https://pinata.cloud): API Keys → New Key (admin or `pinFileToIPFS` + `pinJSONToIPFS`) → copy the **JWT**. pump.fun uses it to store coin images and metadata. |
| `JUPITER_API_KEY` | [portal.jup.ag](https://portal.jup.ag): create a key. Only the hourly $QSD buy-and-burn uses it. |
| `QSD_QRNG_API_KEY` | ANU Quantum Numbers on [AWS Marketplace](https://aws.amazon.com/marketplace) (search "ANU Quantum Numbers"): subscribe, then copy the API key from quantumnumbers.anu.edu.au. Without it, no coin can be measured. |
| `DATABASE_URL`, `REDIS_URL` | Postgres from [Neon](https://neon.tech) (or Vercel Postgres) and Redis from [Upstash](https://upstash.com). Copy each connection string. Then run `pnpm --filter web prisma:migrate` once against the database. |

When the site is live, register the Helius webhook at `https://<your-domain>/api/webhooks/helius` (Helius dashboard → Webhooks, type *enhanced*), with **Auth Header** set to your `QSD_WEBHOOK_SECRET`.

## 3. Make two choices

| Variable | Meaning |
|---|---|
| `QSD_LAUNCH_COST_LAMPORTS` | What a user pays to launch a coin, in lamports (1 SOL = 1 000 000 000). |
| `QSD_IDENTITY_RESERVE_LAMPORTS` | The part of that fee held back to pay for the coin's future on-chain anchors. |
| `QSD_DAUGHTER_DEV_BUY_SOL` | SOL the protocol buys of each daughter at birth. Use `0` for none. |

Until the two lamport values are set, `/launch` says "not available" and refuses to launch.

## 4. Launch the $QSD coin

`QSD_TOKEN_MINT` is the address of the $QSD coin itself. Launch it on pump.fun from the fee wallet, then paste its mint address. Until it is set, there is no hourly burn and `/burns` says so. Everything else works without it.

## 5. Fixed values

```
SOLANA_CLUSTER=mainnet-beta
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
QSD_MAINNET_ENABLED=true
QSD_QRNG_PROVIDER=anu-quantum-numbers
NODE_ENV=production
```

Leave `PUMPPORTAL_API_URL`, `JUPITER_API_URL` and `QSD_QRNG_ENDPOINT` at their defaults.

## 6. Keys and journals need a disk that survives restarts

`QSD_KEYSTORE_PATH` and `QSD_JOURNAL_DIR` are files. Each coin's mint key and identity seed are written to the key store at launch, and the airdrop and collapse journals that make a crash resumable live in the journal directory. Losing them means the protocol can no longer sign for that coin.

Two consequences:

- **The worker** (`pnpm --filter web worker`, which runs measurements, collapses and burns) can't run on Vercel. Run it on an always-on host with a persistent volume (Railway, Fly.io or a small VPS), give it the same environment, and point both paths at that volume. Back the volume up.
- **Launches currently run inside the Vercel app** (`/api/launch`), and Vercel's disk is temporary. On Vercel today a launch would write its keys somewhere that disappears. Before taking real launches, either serve the whole app from the same persistent host as the worker, or move the key store and journals into Postgres (a code change, not a setting).
