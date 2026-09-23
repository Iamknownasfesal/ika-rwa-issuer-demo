/**
 * Instruction builders. Data layouts mirror the `/// Data:` doc comments in
 * `programs/issuer-ledger/src/instructions.rs`.
 */
import { AccountRole, getAddressEncoder, type Address, type Instruction } from '@solana/kit';
import { utf8Padded } from './format.js';
import { concat, padAddr, u16le, u64le } from './layout.js';

export const SYSTEM_PROGRAM = '11111111111111111111111111111111' as Address;
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' as Address;

export const Ix = { InitAsset: 0, AddChain: 1, CreateIntent: 2, ApproveIntent: 3, ExecuteLeg: 4, ConfirmLeg: 5 } as const;

const enc = () => getAddressEncoder();
const a32 = (a: Address) => enc().encode(a) as Uint8Array;
const b = (...x: number[]) => new Uint8Array(x);
const ro = (address: Address) => ({ address, role: AccountRole.READONLY });
const w = (address: Address) => ({ address, role: AccountRole.WRITABLE });
const rs = (address: Address) => ({ address, role: AccountRole.READONLY_SIGNER });
const ws = (address: Address) => ({ address, role: AccountRole.WRITABLE_SIGNER });

export interface InitAssetArgs {
  programId: Address;
  asset: Address;
  bump: number;
  admin: Address;
  payer: Address;
  createKey: Uint8Array;
  symbol: string;
  decimals: number;
  threshold: number;
  timelockSecs: bigint;
  globalCap: bigint;
  executor: Address;
  ikaProgram: Address;
  mintAuthorityBump: number;
  approvers: Address[];
}

export function buildInitAssetIx(x: InitAssetArgs): Instruction {
  if (x.createKey.length !== 32) throw new Error('createKey must be 32 bytes');
  const data = concat(
    b(Ix.InitAsset),
    x.createKey,
    utf8Padded(x.symbol, 8),
    b(x.decimals, x.threshold),
    u64le(x.timelockSecs),
    u64le(x.globalCap),
    a32(x.executor),
    a32(x.ikaProgram),
    b(x.bump, x.mintAuthorityBump, x.approvers.length),
    ...x.approvers.map(a32),
  );
  return { programAddress: x.programId, accounts: [w(x.asset), rs(x.admin), ws(x.payer), ro(SYSTEM_PROGRAM)], data };
}

export interface AddChainArgs {
  programId: Address;
  asset: Address;
  chain: Address;
  bump: number;
  admin: Address;
  payer: Address;
  chainId: number;
  legKind: number;
  encoding: number;
  curve: number;
  signatureScheme: number;
  /** Ika dWallet PDA (system program / zero address for a Solana-native chain). */
  dwallet: Address;
  dwalletPubkey: Uint8Array;
  /** Token-2022 mint on Solana, contract address elsewhere. */
  contract: Uint8Array;
  domainSeparator: Uint8Array;
  cap: bigint;
  /** Initial (already circulating) authorized supply. */
  authorized: bigint;
  allowlist: Uint8Array[];
}

export function buildAddChainIx(x: AddChainArgs): Instruction {
  if (x.domainSeparator.length !== 32) throw new Error('domainSeparator must be 32 bytes');
  if (x.dwalletPubkey.length > 65) throw new Error('dwalletPubkey too long');
  if (x.allowlist.length > 4) throw new Error('allowlist max 4');
  const pk = new Uint8Array(65);
  pk.set(x.dwalletPubkey);
  const data = concat(
    b(Ix.AddChain),
    u16le(x.chainId),
    b(x.legKind, x.encoding),
    u16le(x.curve),
    u16le(x.signatureScheme),
    a32(x.dwallet),
    b(x.dwalletPubkey.length),
    pk,
    padAddr(x.contract),
    x.domainSeparator,
    u64le(x.cap),
    u64le(x.authorized),
    b(x.bump, x.allowlist.length),
    ...x.allowlist.map(padAddr),
  );
  return {
    programAddress: x.programId,
    accounts: [w(x.asset), w(x.chain), rs(x.admin), ws(x.payer), ro(SYSTEM_PROGRAM)],
    data,
  };
}

export interface CreateIntentArgs {
  programId: Address;
  asset: Address;
  intent: Address;
  bump: number;
  proposer: Address;
  payer: Address;
  /** 0 mint, 1 burn, 2 move */
  kind: number;
  amount: bigint;
  srcChain: number;
  dstChain: number;
  recipient: Uint8Array;
  source: Uint8Array;
  memo: string;
  /** required for burn / move */
  srcChainPda?: Address;
  /** required for mint / move */
  dstChainPda?: Address;
}

export function buildCreateIntentIx(x: CreateIntentArgs): Instruction {
  const data = concat(
    b(Ix.CreateIntent, x.kind),
    u64le(x.amount),
    u16le(x.srcChain),
    u16le(x.dstChain),
    padAddr(x.recipient),
    padAddr(x.source),
    utf8Padded(x.memo, 32),
    b(x.bump),
  );
  const accounts = [w(x.asset), w(x.intent), rs(x.proposer), ws(x.payer), ro(SYSTEM_PROGRAM)];
  if (x.kind === 0) {
    if (!x.dstChainPda) throw new Error('dstChainPda required for mint');
    accounts.push(ro(x.dstChainPda));
  } else if (x.kind === 1) {
    if (!x.srcChainPda) throw new Error('srcChainPda required for burn');
    accounts.push(ro(x.srcChainPda));
  } else {
    if (!x.srcChainPda || !x.dstChainPda) throw new Error('srcChainPda and dstChainPda required for move');
    accounts.push(ro(x.srcChainPda), ro(x.dstChainPda));
  }
  return { programAddress: x.programId, accounts, data };
}

export function buildApproveIntentIx(x: { programId: Address; asset: Address; intent: Address; approver: Address }): Instruction {
  return { programAddress: x.programId, accounts: [ro(x.asset), w(x.intent), rs(x.approver)], data: b(Ix.ApproveIntent) };
}

export interface ExecuteLegSolanaArgs {
  programId: Address;
  asset: Address;
  intent: Address;
  chain: Address;
  authority: Address;
  payer: Address;
  legIndex: number;
  cpiAuthorityBump: number;
  mint: Address;
  tokenAccount: Address;
  mintAuthority: Address;
}

export function buildExecuteLegSolanaIx(x: ExecuteLegSolanaArgs): Instruction {
  return {
    programAddress: x.programId,
    accounts: [
      w(x.asset), w(x.intent), w(x.chain), rs(x.authority), ws(x.payer), ro(SYSTEM_PROGRAM),
      ro(TOKEN_2022_PROGRAM), w(x.mint), w(x.tokenAccount), ro(x.mintAuthority),
    ],
    data: b(Ix.ExecuteLeg, x.legIndex, 0, x.cpiAuthorityBump),
  };
}

export interface ExecuteLegForeignArgs {
  programId: Address;
  asset: Address;
  intent: Address;
  chain: Address;
  authority: Address;
  payer: Address;
  legIndex: number;
  messageApprovalBump: number;
  cpiAuthorityBump: number;
  ikaProgram: Address;
  coordinator: Address;
  messageApproval: Address;
  dwallet: Address;
  cpiAuthority: Address;
}

export function buildExecuteLegForeignIx(x: ExecuteLegForeignArgs): Instruction {
  return {
    programAddress: x.programId,
    accounts: [
      w(x.asset), w(x.intent), w(x.chain), rs(x.authority), ws(x.payer), ro(SYSTEM_PROGRAM),
      ro(x.ikaProgram), ro(x.coordinator), w(x.messageApproval), ro(x.dwallet), ro(x.programId), ro(x.cpiAuthority),
    ],
    data: b(Ix.ExecuteLeg, x.legIndex, x.messageApprovalBump, x.cpiAuthorityBump),
  };
}

export function buildConfirmLegIx(x: { programId: Address; asset: Address; intent: Address; authority: Address; legIndex: number; destTx: Uint8Array }): Instruction {
  return {
    programAddress: x.programId,
    accounts: [ro(x.asset), w(x.intent), rs(x.authority)],
    data: concat(b(Ix.ConfirmLeg, x.legIndex), padAddr(x.destTx)),
  };
}
