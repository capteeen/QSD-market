import { encodeDeployData, getContractAddress, type Abi, type Address, type Hex } from 'viem';
import tokenArtifactJson from '../artifacts/InfinitwapToken.json';

export interface TokenArtifact {
  abi: Abi;
  bytecode: Hex;
}

/** Compiled contract JSON produced by `forge build` in contracts/. Bundled so a serverless deploy does not read the file from disk. */
export function compiledArtifact(json: { abi: unknown; bytecode?: { object?: string } }, name: string): TokenArtifact {
  const bytecode = json.bytecode?.object;
  if (!bytecode || bytecode === '0x') throw new Error(`${name} bytecode is missing; run forge build in packages/elysium/contracts`);
  return { abi: json.abi as Abi, bytecode: bytecode as Hex };
}

/** Compiled InfinitwapToken (OpenZeppelin ERC-20). Produced by `forge build` in contracts/. */
export function infinitwapTokenArtifact(): TokenArtifact {
  return compiledArtifact(tokenArtifactJson, 'InfinitwapToken');
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
