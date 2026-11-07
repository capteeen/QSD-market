# INFINITWAP

An Elysium launchpad. The same pages as before — home, launch, coin, field, measure, burns, how, me, lineage — now settle a coin as an ERC-20 on Elysium testnet and take payment in HYPE.

This is not an official Kinetiq or Hyperliquid product. A launch on Elysium mainnet (chain ID 99901) deploys an ERC-20, puts the whole supply in a Uniswap v2 pool against HYPE, locks the liquidity, and fills an optional first buy in that same transaction. The protocol wallet deposits the opening HYPE (30 HYPE unless `POOL_SEED_WEI` is set). Kinetiq's own public mainnet RPC and block explorer are not published yet; the app uses a public relay for chain 99901 until they are. Set `ELYSIUM_NETWORK=testnet` to deploy an ERC-20 on testnet (chain ID 99801) with no pool.

## Run

```
pnpm install
cp apps/web/.env.example apps/web/.env
pnpm --filter web dev
```

The dev server listens on port 4178. Without `ELYSIUM_DEPLOYER_PRIVATE_KEY` and `QSD_KEY_ENCRYPTION_KEY`, launch says the chain is not configured. The public testnet RPC needs no key. Empty pages stay empty.

See `apps/web/README.md` for the database, worker and route notes, and `packages/elysium/README.md` for the token contract.
