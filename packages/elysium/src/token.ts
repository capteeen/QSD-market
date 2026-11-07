import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeDeployData, getContractAddress, type Abi, type Address, type Hex } from 'viem';

export interface TokenArtifact {
  abi: Abi;
  bytecode: Hex;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** Compiled InfinitwapToken (OpenZeppelin ERC-20). Produced by `forge build` in contracts/. */
export function infinitwapTokenArtifact(): TokenArtifact {
  const file = path.resolve(here, '../artifacts/InfinitwapToken.json');
  const json = JSON.parse(readFileSync(file, 'utf8')) as { abi: Abi; bytecode: { object: Hex } };
  if (!json.bytecode?.object || json.bytecode.object === '0x') throw new Error('InfinitwapToken bytecode is missing; run forge build in packages/elysium/contracts');
  return { abi: json.abi, bytecode: json.bytecode.object };
}

/** CREATE address of the token deployed by `from` at `nonce`. */
export function predictedTokenAddress(from: Address, nonce: bigint): Address {
  return getContractAddress({ from, nonce });
}

export interface DeployArgs {
  name: string;
  symbol: string;
  supply: bigint;
  recipient: Address;
}

/** Init code for a CREATE at a known nonce. The deployer sends this as contract creation data. */
export function tokenInitCode(args: DeployArgs): Hex {
  const art = infinitwapTokenArtifact();
  return encodeDeployData({
    abi: art.abi,
    bytecode: art.bytecode,
    args: [args.name, args.symbol, args.supply, args.recipient],
  });
}
