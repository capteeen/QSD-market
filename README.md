# INFINITWAP

An Elysium launchpad. The same pages as before — home, launch, coin, field, measure, burns, how, me, lineage — now settle a coin as an ERC-20 on Elysium testnet and take payment in HYPE.

This is not an official Kinetiq or Hyperliquid product. Mainnet chain ID, RPC and explorer are not published, so this build talks to Elysium testnet only (chain ID 99801).

## Run

```
pnpm install
cp apps/web/.env.example apps/web/.env
pnpm --filter web dev
```

The dev server listens on port 4178. Without `ELYSIUM_DEPLOYER_PRIVATE_KEY` and `QSD_KEY_ENCRYPTION_KEY`, launch says the chain is not configured. The public testnet RPC needs no key. Empty pages stay empty.

See `apps/web/README.md` for the database, worker and route notes, and `packages/elysium/README.md` for the token contract.
