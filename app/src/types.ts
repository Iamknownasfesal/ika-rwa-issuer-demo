import type { ApproverId } from "@/demoConfig";

export type ChainKey = "solana" | "ethereum" | "base" | "sui" | "tempo";
export type Curve = "ed25519" | "secp256k1";
export type DWalletId = "dw-secp256k1" | "dw-ed25519";
export type IntentType = "mint" | "burn" | "move";
export type LegAction = "mint" | "burn";
export type IntentStatus = "rejected" | "pending_approval" | "approved" | "executing" | "executed";
export type LegExecStatus = "pending" | "policy" | "signing" | "broadcast" | "confirmed";

/** Amounts are integers in base units (6 decimals). 100,000,000 TBILL fits in a JS number. */
export interface Asset {
  id: string;
  name: string;
  decimals: number;
  globalCap: number;
  chains: ChainDeployment[];
}

export interface ChainDeployment {
  chain: ChainKey;
  chainId: number;
  name: string;
  testnet: string;
  contractAddress: string;
  /** The mint/burn authority on this chain: the dWallet address, or the program PDA on Solana. */
  authority: string;
  authorityKind: "address" | "pda";
  dwalletId: DWalletId | "program-pda";
  encoding: "eip712" | "raw" | "native";
  authorized: number;
  cap: number;
  explorerPrefix: string;
  lastActivity?: string;
}

export interface DWallet {
  id: DWalletId;
  curve: Curve;
  /** Raw public key, hex. */
  publicKey: string;
  /** Chain-formatted identities derived from the key. */
  identities: { label: string; value: string }[];
  chains: ChainKey[];
  onChainAddress?: string;
  policyProgram: string;
  userShareLocation: string;
  networkShareControl: string;
}

export interface AllowlistEntry {
  label: string;
  address: string;
}

export interface Approver {
  id: ApproverId;
  name: string;
  pubkey: string;
}

export interface PolicyConfig {
  globalCap: number;
  chainCaps: Record<ChainKey, number>;
  allowlist: Record<ChainKey, AllowlistEntry[]>;
  approvers: Approver[];
  threshold: number;
  timelockSeconds: number;
}

export interface Leg {
  action: LegAction;
  chain: ChainKey;
  amount: number;
  /** Destination account (mint) or source account (burn). */
  account: string;
}

export interface LegExecution {
  status: LegExecStatus;
  /** Solana tx that ran `execute_leg` (policy approval + Ika `approve_message`). */
  policyTxHash?: string;
  /** Ika MessageApproval PDA (foreign legs). */
  messageApproval?: string;
  /** keccak256 of the signed authorization message. */
  messageDigest?: string;
  ikaSignatureId?: string;
  signature?: string;
  dwalletId?: DWalletId | "program-pda";
  curve?: Curve | "n/a";
  destTxHash?: string;
  block?: number;
  error?: string;
}

export type RuleId = "amount" | "globalCap" | "chainCap" | "supply" | "allowlist" | "threshold" | "timelock";

export interface RuleResult {
  rule: RuleId;
  label: string;
  ok: boolean;
  detail: string;
}

export interface Approval {
  approver: ApproverId;
  at: string;
}

export interface Intent {
  id: string;
  index: number;
  type: IntentType;
  legs: Leg[];
  amount: number;
  recipient?: string;
  source?: string;
  memo: string;
  proposer: ApproverId;
  status: IntentStatus;
  policyResults: RuleResult[];
  approvals: Approval[];
  approvedAt?: string;
  createdAt: string;
  execution?: { legs: LegExecution[] };
  /** Program error (devnet) or policy summary (mock) when rejected. */
  error?: string;
}

export interface IntentDraft {
  type: IntentType;
  amount: number;
  srcChain?: ChainKey;
  dstChain?: ChainKey;
  recipient?: string;
  source?: string;
  memo: string;
}

export interface LedgerMeta {
  mode: "mock" | "devnet";
  programId?: string;
  assetPda?: string;
  cpiAuthority?: string;
  mintAuthority?: string;
  ikaProgram?: string;
  rpcUrl?: string;
  grpcUrl?: string;
  cluster?: string;
}

export interface LedgerState {
  asset: Asset;
  dwallets: DWallet[];
  config: PolicyConfig;
  intents: Intent[];
  meta: LedgerMeta;
}

/** Progress events emitted while a leg executes. */
export interface StepEvent {
  intentId: string;
  leg: number;
  step: 1 | 2 | 3;
  status: "start" | "ok" | "error";
  detail?: string;
  execution?: LegExecution;
  /** Full snapshot after the step, so the UI never has to reconcile. */
  intent?: Intent;
  asset?: Asset;
}

/** One Solana transaction in an intent's history, read back from chain (devnet) or simulated (mock). */
export interface ActivityEntry {
  kind: "create" | "approve" | "execute" | "ika-sign" | "confirm";
  /** Who paid for and signed the transaction. */
  signer: string;
  signerName: string;
  signature?: string;
  slot?: number;
  at?: string;
  leg?: number;
}
