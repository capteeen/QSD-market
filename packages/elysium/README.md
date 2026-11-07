# @qsd/elysium

Elysium testnet helpers for INFINITWAP. Not an official Kinetiq or Hyperliquid product.

Network facts are copied from [Connecting to Elysium](https://elysium.kinetiq.xyz/docs/connecting-to-elysium) and [Contract addresses](https://elysium.kinetiq.xyz/docs/contract-addresses):

- Chain ID `99801`
- Public RPC `https://testnet-rpc.elysium.kinetiq.xyz`
- Native gas: HYPE (18 decimals)
- Canonical testnet WHYPE `0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234`

Mainnet chain ID, RPC and explorer are not published. `elysiumMainnet()` throws rather than inventing them. This package does not use viem’s bundled `elysiumTestnet` export.

The token is `contracts/src/InfinitwapToken.sol`, an OpenZeppelin ERC-20. Build it with Foundry:

```
cd packages/elysium/contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts
forge build
forge test
```

`src/token.ts` reads `artifacts/InfinitwapToken.json`, which is the forge output checked in so a launch does not need the compiler at runtime. There is no Uniswap v4 pool: Kinetiq has announced Uniswap on Elysium, and this package does not invent a PoolManager address.
