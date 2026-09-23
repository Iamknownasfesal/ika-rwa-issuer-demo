/**
 * Minimal structural types for the workspace packages, taken from docs/SDK_API.md.
 * The packages are loaded dynamically so the app builds even before they are compiled.
 */
import type { Instruction, Address as KitAddress } from "@solana/kit";

export type Address = KitAddress;

export interface SdkAsset {
  address: Address;
  createKey: Uint8Array;
  admin: Address;
  executor: Address;
  symbol: string;
  decimals: number;
  threshold: number;
  approvers: Address[];
  chainCount: number;
  globalCap: bigint;
  authorizedTotal: bigint;
  intentCount: bigint;
  timelockSecs: bigint;
  bump: number;
  mintAuthorityBump: number;
  ikaProgram: Address;
}
export interface SdkChain {
  address: Address;
  asset: Address;
  chainId: number;
  legKind: 0 | 1;
  encoding: 0 | 1;
  curve: number;
  signatureScheme: number;
  dwallet: Address;
  dwalletPubkey: Uint8Array;
  contract: Uint8Array;
  domainSeparator: Uint8Array;
  authorized: bigint;
  cap: bigint;
  allowlist: Uint8Array[];
  bump: number;
}
export interface SdkLeg {
  action: 0 | 1;
  chainId: number;
  status: 0 | 1 | 2;
  messageDigest: Uint8Array;
  messageApproval: Address | null;
  destTx: Uint8Array;
  executedAt: bigint;
  confirmedAt: bigint;
}
export interface SdkIntent {
  address: Address;
  asset: Address;
  index: bigint;
  kind: 0 | 1 | 2;
  status: 0 | 1 | 2 | 3;
  proposer: Address;
  amount: bigint;
  srcChain: number;
  dstChain: number;
  recipient: Uint8Array;
  source: Uint8Array;
  memo: string;
  createdAt: bigint;
  approvedAt: bigint;
  approvalsBitmap: number;
  approvalCount: number;
  legs: SdkLeg[];
  bump: number;
}

export interface LedgerSdk {
  findAssetPda(programId: Address, createKey: Uint8Array): Promise<[Address, number]>;
  findChainPda(programId: Address, asset: Address, chainId: number): Promise<[Address, number]>;
  findIntentPda(programId: Address, asset: Address, index: bigint): Promise<[Address, number]>;
  findMintAuthorityPda(programId: Address, asset: Address): Promise<[Address, number]>;
  findCpiAuthorityPda(programId: Address): Promise<[Address, number]>;
  fetchAsset(rpc: unknown, address: Address): Promise<SdkAsset>;
  fetchChains(rpc: unknown, programId: Address, asset: Address, chainIds: number[]): Promise<SdkChain[]>;
  fetchIntents(rpc: unknown, programId: Address, asset: Address): Promise<SdkIntent[]>;
  buildCreateIntentIx(args: {
    programId: Address;
    asset: Address;
    intent: Address;
    bump: number;
    proposer: Address;
    payer: Address;
    kind: 0 | 1 | 2;
    amount: bigint;
    srcChain: number;
    dstChain: number;
    recipient: Uint8Array;
    source: Uint8Array;
    memo: string;
    srcChainPda?: Address;
    dstChainPda?: Address;
  }): Instruction;
  buildApproveIntentIx(args: { programId: Address; asset: Address; intent: Address; approver: Address }): Instruction;
  explainError(code: number): { rule: string; message: string };
  extractLedgerErrorCode?(err: unknown): number | null;
}

export interface ExecutorStepEvent {
  leg: number;
  step: "policy" | "ika-approval" | "ika-signature" | "deliver" | "confirm";
  status: "start" | "ok" | "error";
  detail?: string;
  txHash?: string;
  signature?: string;
  messageApproval?: string;
}
export interface ExecutorConfig {
  rpcUrl: string;
  wsUrl: string;
  grpcUrl: string;
  programId: string;
  ikaProgram: string;
  asset: string;
  executorKeypair: unknown;
  deliver: "mock" | "live";
  evm?: { rpcUrl: string; mintController: string; privateKey: string };
}
export interface ExecutorSdk {
  runLeg(cfg: ExecutorConfig, intentIndex: bigint, legIndex: number): AsyncGenerator<ExecutorStepEvent>;
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
  dwallets: {
    secp256k1: { pda: string; publicKeyHex: string; evmAddress: string };
    curve25519: { pda: string; publicKeyHex: string; suiAddress: string };
  };
  chains: Record<string, { pda: string; contract: string; treasury: string }>;
}
