/**
 * Decoded account types. Layouts: `programs/issuer-ledger/src/state.rs`.
 */
import type { Address } from '@solana/kit';

export type { Address };

export interface Asset {
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

export interface ChainDeployment {
  address: Address;
  asset: Address;
  chainId: number;
  legKind: number;
  encoding: number;
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

/** 0 Mint, 1 Burn, 2 Move */
export type IntentKind = 0 | 1 | 2;
export const IntentKind = { Mint: 0, Burn: 1, Move: 2 } as const;
/** 0 PendingApproval, 1 Approved, 2 Executing, 3 Executed */
export type IntentStatus = 0 | 1 | 2 | 3;
export const IntentStatus = { PendingApproval: 0, Approved: 1, Executing: 2, Executed: 3 } as const;
/** 0 Pending, 1 Authorized, 2 Confirmed */
export type LegStatus = 0 | 1 | 2;
export const LegStatus = { Pending: 0, Authorized: 1, Confirmed: 2 } as const;
/** 0 mint, 1 burn */
export type LegAction = 0 | 1;
export const LegAction = { Mint: 0, Burn: 1 } as const;

export interface Leg {
  action: LegAction;
  chainId: number;
  status: LegStatus;
  messageDigest: Uint8Array;
  /** Ika MessageApproval PDA, or null for a Solana-native leg. */
  messageApproval: Address | null;
  destTx: Uint8Array;
  executedAt: bigint;
  confirmedAt: bigint;
}

export interface Intent {
  address: Address;
  asset: Address;
  index: bigint;
  kind: IntentKind;
  status: IntentStatus;
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
  legs: Leg[];
  bump: number;
}

export interface MessageApproval {
  address: Address;
  dwallet: Address;
  messageDigest: Uint8Array;
  messageMetadataDigest: Uint8Array;
  approver: Address;
  userPubkey: Address;
  scheme: number;
  epoch: bigint;
  /** 0 pending, 1 signed */
  status: 0 | 1;
  signature: Uint8Array;
}

export interface Ledger {
  asset: Asset;
  chains: ChainDeployment[];
}
