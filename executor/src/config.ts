/** Deployment config + key loading for the executor and scripts. */
import { createKeyPairSignerFromBytes, type Address, type KeyPairSigner } from '@solana/kit';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DeploymentChain {
  pda: string;
  contract: string;
  treasury: string;
}

export interface Deployment {
  programId: string;
  ikaProgram: string;
  rpcUrl: string;
  wsUrl?: string;
  grpcUrl: string;
  createKey: string;
  asset: string;
  mintAuthority: string;
  cpiAuthority: string;
  executor: string;
  approvers: { name: string; pubkey: string }[];
  dwallets: Record<string, { pda: string; publicKeyHex: string; evmAddress?: string; suiAddress?: string }>;
  chains: Record<string, DeploymentChain>;
}

/** `mock` simulates every destination; `live` delivers to chains that have a real deployment in
 *  `deployments/evm.json` / `deployments/sui.json` and simulates the rest. `evm` is a legacy alias for `live`. */
export type DeliverMode = 'mock' | 'live' | 'evm';

export interface ExecutorConfig {
  rpcUrl: string;
  wsUrl: string;
  grpcUrl: string;
  programId: Address;
  ikaProgram: Address;
  asset: Address;
  /** Signs execute_leg / confirm_leg and authenticates gRPC requests (`user_pubkey`). */
  executorKeypair: KeyPairSigner;
  deliver: DeliverMode;
  /** Poll timeouts in ms. */
  timeouts?: { messageApproval?: number; signature?: number };
}

/** Repo root = two levels above `executor/src`. */
export function repoRoot(): string {
  return resolve(new URL('../..', import.meta.url).pathname);
}

export function loadDeployment(path = process.env.DEPLOYMENT_FILE ?? resolve(repoRoot(), 'deployments/devnet.json')): Deployment {
  return JSON.parse(readFileSync(path, 'utf8')) as Deployment;
}

/** Load a `solana-keygen` style JSON keypair (64-byte secret array). */
export async function loadKeypair(path: string): Promise<KeyPairSigner> {
  const bytes = new Uint8Array(JSON.parse(readFileSync(resolve(path), 'utf8')) as number[]);
  if (bytes.length !== 64) throw new Error(`${path}: expected 64-byte keypair`);
  return createKeyPairSignerFromBytes(bytes);
}

export async function configFromDeployment(d: Deployment, executorKeypair: KeyPairSigner, deliver: DeliverMode = 'mock'): Promise<ExecutorConfig> {
  const cfg: ExecutorConfig = {
    rpcUrl: d.rpcUrl,
    wsUrl: d.wsUrl ?? d.rpcUrl.replace(/^http/, 'ws'),
    grpcUrl: d.grpcUrl,
    programId: d.programId as Address,
    ikaProgram: d.ikaProgram as Address,
    asset: d.asset as Address,
    executorKeypair,
    deliver,
  };
  return cfg;
}
