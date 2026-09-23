/** Account decoders and RPC fetch helpers. */
import { fetchEncodedAccount, fetchEncodedAccounts, getAddressDecoder, type Address, type GetAccountInfoApi, type GetMultipleAccountsApi, type Rpc } from '@solana/kit';
import { bytesToUtf8 } from './format.js';
import {
  ADDR_LEN, ASSET, CHAIN, DISC_ASSET, DISC_CHAIN, DISC_INTENT, DWALLET, INTENT, LEG, MAX_ALLOWLIST, MAX_APPROVERS,
  MESSAGE_APPROVAL, readAddr, readI64, readU16, readU64,
} from './layout.js';
import { findChainPda, findIntentPda } from './pda.js';
import type { Asset, ChainDeployment, Intent, IntentKind, IntentStatus, Leg, LegAction, LegStatus, Ledger, MessageApproval } from './types.js';

const addrOf = (d: Uint8Array, off: number): Address => getAddressDecoder().decode(d.slice(off, off + 32));
const ZERO32 = new Uint8Array(32);
const isZero = (d: Uint8Array, off: number) => d.slice(off, off + 32).every((b) => b === 0);

export function decodeAsset(address: Address, d: Uint8Array): Asset {
  if (d.length !== ASSET.LEN || d[0] !== DISC_ASSET) throw new Error('not an Asset account');
  const approverCount = Math.min(d[ASSET.APPROVER_COUNT], MAX_APPROVERS);
  const approvers: Address[] = [];
  for (let i = 0; i < approverCount; i++) approvers.push(addrOf(d, ASSET.APPROVERS + i * 32));
  return {
    address,
    createKey: d.slice(ASSET.CREATE_KEY, ASSET.CREATE_KEY + 32),
    admin: addrOf(d, ASSET.ADMIN),
    executor: addrOf(d, ASSET.EXECUTOR),
    symbol: bytesToUtf8(d.slice(ASSET.SYMBOL, ASSET.SYMBOL + 8)),
    decimals: d[ASSET.DECIMALS],
    threshold: d[ASSET.THRESHOLD],
    approvers,
    chainCount: d[ASSET.CHAIN_COUNT],
    globalCap: readU64(d, ASSET.GLOBAL_CAP),
    authorizedTotal: readU64(d, ASSET.AUTHORIZED_TOTAL),
    intentCount: readU64(d, ASSET.INTENT_COUNT),
    timelockSecs: readU64(d, ASSET.TIMELOCK_SECS),
    bump: d[ASSET.BUMP],
    mintAuthorityBump: d[ASSET.MINT_AUTHORITY_BUMP],
    ikaProgram: addrOf(d, ASSET.IKA_PROGRAM),
  };
}

export function decodeChain(address: Address, d: Uint8Array): ChainDeployment {
  if (d.length !== CHAIN.LEN || d[0] !== DISC_CHAIN) throw new Error('not a ChainDeployment account');
  const pkLen = Math.min(d[CHAIN.DWALLET_PUBKEY_LEN], 65);
  const n = Math.min(d[CHAIN.ALLOWLIST_COUNT], MAX_ALLOWLIST);
  const allowlist: Uint8Array[] = [];
  for (let i = 0; i < n; i++) allowlist.push(readAddr(d, CHAIN.ALLOWLIST + i * ADDR_LEN));
  return {
    address,
    asset: addrOf(d, CHAIN.ASSET),
    chainId: readU16(d, CHAIN.CHAIN_ID),
    legKind: d[CHAIN.LEG_KIND],
    encoding: d[CHAIN.ENCODING],
    curve: readU16(d, CHAIN.CURVE),
    signatureScheme: readU16(d, CHAIN.SIGNATURE_SCHEME),
    dwallet: addrOf(d, CHAIN.DWALLET),
    dwalletPubkey: d.slice(CHAIN.DWALLET_PUBKEY, CHAIN.DWALLET_PUBKEY + pkLen),
    contract: readAddr(d, CHAIN.CONTRACT),
    domainSeparator: d.slice(CHAIN.DOMAIN_SEPARATOR, CHAIN.DOMAIN_SEPARATOR + 32),
    authorized: readU64(d, CHAIN.AUTHORIZED),
    cap: readU64(d, CHAIN.CAP),
    allowlist,
    bump: d[CHAIN.BUMP],
  };
}

function decodeLeg(d: Uint8Array, off: number): Leg {
  return {
    action: d[off + LEG.ACTION] as LegAction,
    chainId: readU16(d, off + LEG.CHAIN_ID),
    status: d[off + LEG.STATUS] as LegStatus,
    messageDigest: d.slice(off + LEG.MESSAGE_DIGEST, off + LEG.MESSAGE_DIGEST + 32),
    messageApproval: isZero(d, off + LEG.MESSAGE_APPROVAL) ? null : addrOf(d, off + LEG.MESSAGE_APPROVAL),
    destTx: readAddr(d, off + LEG.DEST_TX),
    executedAt: readI64(d, off + LEG.EXECUTED_AT),
    confirmedAt: readI64(d, off + LEG.CONFIRMED_AT),
  };
}

export function decodeIntent(address: Address, d: Uint8Array): Intent {
  if (d.length !== INTENT.LEN || d[0] !== DISC_INTENT) throw new Error('not an Intent account');
  const legCount = Math.min(d[INTENT.LEG_COUNT], 2);
  const legs: Leg[] = [];
  for (let i = 0; i < legCount; i++) legs.push(decodeLeg(d, INTENT.LEGS + i * LEG.LEN));
  return {
    address,
    asset: addrOf(d, INTENT.ASSET),
    index: readU64(d, INTENT.INDEX),
    kind: d[INTENT.KIND] as IntentKind,
    status: d[INTENT.STATUS] as IntentStatus,
    proposer: addrOf(d, INTENT.PROPOSER),
    amount: readU64(d, INTENT.AMOUNT),
    srcChain: readU16(d, INTENT.SRC_CHAIN),
    dstChain: readU16(d, INTENT.DST_CHAIN),
    recipient: readAddr(d, INTENT.RECIPIENT),
    source: readAddr(d, INTENT.SOURCE),
    memo: bytesToUtf8(d.slice(INTENT.MEMO, INTENT.MEMO + 32)),
    createdAt: readI64(d, INTENT.CREATED_AT),
    approvedAt: readI64(d, INTENT.APPROVED_AT),
    approvalsBitmap: d[INTENT.APPROVALS_BITMAP],
    approvalCount: d[INTENT.APPROVAL_COUNT],
    legs,
    bump: d[INTENT.BUMP],
  };
}

export function decodeMessageApproval(address: Address, d: Uint8Array): MessageApproval {
  if (d.length < MESSAGE_APPROVAL.LEN || d[0] !== MESSAGE_APPROVAL.DISC) throw new Error('not a MessageApproval account');
  const sigLen = readU16(d, MESSAGE_APPROVAL.SIGNATURE_LEN);
  return {
    address,
    dwallet: addrOf(d, MESSAGE_APPROVAL.DWALLET),
    messageDigest: d.slice(MESSAGE_APPROVAL.MESSAGE_DIGEST, MESSAGE_APPROVAL.MESSAGE_DIGEST + 32),
    messageMetadataDigest: d.slice(MESSAGE_APPROVAL.MESSAGE_METADATA_DIGEST, MESSAGE_APPROVAL.MESSAGE_METADATA_DIGEST + 32),
    approver: addrOf(d, MESSAGE_APPROVAL.APPROVER),
    userPubkey: addrOf(d, MESSAGE_APPROVAL.USER_PUBKEY),
    scheme: readU16(d, MESSAGE_APPROVAL.SIGNATURE_SCHEME),
    epoch: readU64(d, MESSAGE_APPROVAL.EPOCH),
    status: d[MESSAGE_APPROVAL.STATUS] as 0 | 1,
    signature: d.slice(MESSAGE_APPROVAL.SIGNATURE, MESSAGE_APPROVAL.SIGNATURE + Math.min(sigLen, 128)),
  };
}

export interface DWalletInfo {
  address: Address;
  authority: Address;
  curve: number;
  state: number;
  publicKey: Uint8Array;
}

export function decodeDWallet(address: Address, d: Uint8Array): DWalletInfo {
  if (d.length < DWALLET.LEN || d[0] !== DWALLET.DISC) throw new Error('not a DWallet account');
  const len = Math.min(d[DWALLET.PUBLIC_KEY_LEN], 65);
  return {
    address,
    authority: addrOf(d, DWALLET.AUTHORITY),
    curve: readU16(d, DWALLET.CURVE),
    state: d[DWALLET.STATE],
    publicKey: d.slice(DWALLET.PUBLIC_KEY, DWALLET.PUBLIC_KEY + len),
  };
}

// ── RPC fetchers ──

type RpcGet = Rpc<GetAccountInfoApi>;
type RpcMulti = Rpc<GetMultipleAccountsApi>;

export async function fetchAsset(rpc: RpcGet, address: Address): Promise<Asset> {
  const acc = await fetchEncodedAccount(rpc, address);
  if (!acc.exists) throw new Error(`Asset ${address} not found`);
  return decodeAsset(address, new Uint8Array(acc.data));
}

export async function fetchChains(rpc: RpcMulti, programId: Address, asset: Address, chainIds: number[]): Promise<ChainDeployment[]> {
  const pdas = await Promise.all(chainIds.map((id) => findChainPda(programId, asset, id)));
  const accs = await fetchEncodedAccounts(rpc, pdas.map((p) => p[0]));
  const out: ChainDeployment[] = [];
  accs.forEach((a, i) => {
    if (a.exists) out.push(decodeChain(pdas[i][0], new Uint8Array(a.data)));
  });
  return out;
}

export async function fetchIntents(rpc: RpcMulti, programId: Address, asset: Address, count?: bigint): Promise<Intent[]> {
  // When the caller has not read the asset yet, fetch it to learn how many intents exist.
  const n = Number(count ?? (await fetchAsset(rpc as unknown as RpcGet, asset)).intentCount);
  if (n === 0) return [];
  const pdas = await Promise.all(Array.from({ length: n }, (_, i) => findIntentPda(programId, asset, BigInt(i))));
  const out: Intent[] = [];
  // getMultipleAccounts is capped at 100 addresses per call.
  for (let s = 0; s < n; s += 100) {
    const slice = pdas.slice(s, s + 100);
    const accs = await fetchEncodedAccounts(rpc, slice.map((p) => p[0]));
    accs.forEach((a, i) => {
      if (a.exists) out.push(decodeIntent(slice[i][0], new Uint8Array(a.data)));
    });
  }
  return out;
}

export async function fetchMessageApproval(rpc: RpcGet, address: Address): Promise<MessageApproval | null> {
  const acc = await fetchEncodedAccount(rpc, address);
  if (!acc.exists) return null;
  return decodeMessageApproval(address, new Uint8Array(acc.data));
}

export async function fetchDWallet(rpc: RpcGet, address: Address): Promise<DWalletInfo | null> {
  const acc = await fetchEncodedAccount(rpc, address);
  if (!acc.exists) return null;
  return decodeDWallet(address, new Uint8Array(acc.data));
}

/** Asset + every registered chain deployment (tries chain ids 1..8). */
export async function fetchLedger(rpc: RpcGet & RpcMulti, programId: Address, asset: Address): Promise<Ledger> {
  const a = await fetchAsset(rpc, asset);
  const chains = await fetchChains(rpc, programId, asset, [1, 2, 3, 4, 5, 6, 7, 8]);
  return { asset: a, chains };
}

export { ZERO32 };
