# @qsd/elysium

Elysium helpers for INFINITWAP. Not an official Kinetiq or Hyperliquid product.

Network facts are copied from [Connecting to Elysium](https://elysium.kinetiq.xyz/docs/connecting-to-elysium) and [Contract addresses](https://elysium.kinetiq.xyz/docs/contract-addresses):

- Testnet chain ID `99801`, public RPC `https://testnet-rpc.elysium.kinetiq.xyz`
- Mainnet chain ID `99901` (published 7 Nov 2026). Kinetiq's own public RPC and explorer are still listed as coming at launch. `elysiumMainnet` uses a public relay that answers chain 99901.
- Native gas: HYPE (18 decimals)
- Canonical testnet WHYPE `0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234`
- Mainnet WHYPE `0xbA876237B0F021A6c6D852d6c26E107997cC5E81`
- Uniswap v2 factory `0xBbBcC62853a5fA27b93d6Bab3E6F7ce841E25Df2`
- Uniswap v2 router `0xE783DE89a7F0408687f051e3E6D0BEb62719EbAd` (its `factory()` and `WETH()` return the two addresses above)

This package does not use viem’s bundled `elysiumTestnet` export.

The token is `contracts/src/InfinitwapToken.sol`, an OpenZeppelin ERC-20. Build it with Foundry:

```
cd packages/elysium/contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts
forge build
forge test
```

`src/token.ts` and `src/pool.ts` read the forge output checked in under `artifacts/`, so a launch does not need the compiler at runtime. `InfinitwapLauncher` deploys the token with CREATE2, adds the whole supply and a HYPE seed to the Uniswap v2 router, sends the LP to the dead address, then swaps the optional first buy to the creator.
