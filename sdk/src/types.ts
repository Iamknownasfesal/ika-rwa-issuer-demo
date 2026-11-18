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
  /** The issuer's Ika request key: the signing key of every voucher this asset issues. */
  ikaSigningKey: Uint8Array;
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
  /** The leg's Ika signature voucher, or null for a Solana-native leg or a leg not executed yet. */
  signatureVoucher: Address | null;
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

/** `SignatureVoucher.status`. */
export const VoucherStatus = { Pending: 0, Signed: 1, ClosedByCharge: 2, Revoked: 3 } as const;

/** An Ika signature voucher: the right to one signature of one message with one dWallet. */
export interface SignatureVoucher {
  address: Address;
  dwallet: Address;
  /** keccak256 of the message. */
  messageDigest: Uint8Array;
  messageMetadataDigest: Uint8Array;
  /** Who controls the voucher: the ledger's CPI authority. */
  owner: Address;
  scheme: number;
  /** The Ed25519 request key a sign request must come from, or null while none is set. */
  signingKey: Uint8Array | null;
  issuedEpoch: bigint;
  /** 0 pending, 1 signed, 2 closed by a charge, 3 revoked */
  status: 0 | 1 | 2 | 3;
  /** Empty until the network commits it. ECDSA: 65 bytes, the recovery byte then r and s. */
  signature: Uint8Array;
}

export interface Ledger {
  asset: Asset;
  chains: ChainDeployment[];
}
