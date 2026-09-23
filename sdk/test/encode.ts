/** Test-only encoders that mirror `state.rs` (round-trip with the decoders). */
import { getAddressEncoder, type Address } from '@solana/kit';
import { ADDR_LEN, ASSET, CHAIN, DISC_ASSET, DISC_CHAIN, DISC_INTENT, INTENT, LEG, VERSION, padAddr, writeI64, writeU16, writeU64 } from '../src/layout.js';
import { utf8Padded } from '../src/format.js';
import type { Asset, ChainDeployment, Intent } from '../src/types.js';

const a32 = (a: Address) => getAddressEncoder().encode(a);

export function encodeAsset(a: Omit<Asset, 'address'>): Uint8Array {
  const d = new Uint8Array(ASSET.LEN);
  d[0] = DISC_ASSET;
  d[1] = VERSION;
  d.set(a.createKey, ASSET.CREATE_KEY);
  d.set(a32(a.admin), ASSET.ADMIN);
  d.set(a32(a.executor), ASSET.EXECUTOR);
  d.set(utf8Padded(a.symbol, 8), ASSET.SYMBOL);
  d[ASSET.DECIMALS] = a.decimals;
  d[ASSET.THRESHOLD] = a.threshold;
  d[ASSET.APPROVER_COUNT] = a.approvers.length;
  d[ASSET.CHAIN_COUNT] = a.chainCount;
  writeU64(d, ASSET.GLOBAL_CAP, a.globalCap);
  writeU64(d, ASSET.AUTHORIZED_TOTAL, a.authorizedTotal);
  writeU64(d, ASSET.INTENT_COUNT, a.intentCount);
  writeU64(d, ASSET.TIMELOCK_SECS, a.timelockSecs);
  a.approvers.forEach((p, i) => d.set(a32(p), ASSET.APPROVERS + i * 32));
  d[ASSET.BUMP] = a.bump;
  d[ASSET.MINT_AUTHORITY_BUMP] = a.mintAuthorityBump;
  d.set(a32(a.ikaProgram), ASSET.IKA_PROGRAM);
  return d;
}

export function encodeChain(c: Omit<ChainDeployment, 'address'>): Uint8Array {
  const d = new Uint8Array(CHAIN.LEN);
  d[0] = DISC_CHAIN;
  d[1] = VERSION;
  d.set(a32(c.asset), CHAIN.ASSET);
  writeU16(d, CHAIN.CHAIN_ID, c.chainId);
  d[CHAIN.LEG_KIND] = c.legKind;
  d[CHAIN.ENCODING] = c.encoding;
  writeU16(d, CHAIN.CURVE, c.curve);
  writeU16(d, CHAIN.SIGNATURE_SCHEME, c.signatureScheme);
  d.set(a32(c.dwallet), CHAIN.DWALLET);
  d[CHAIN.DWALLET_PUBKEY_LEN] = c.dwalletPubkey.length;
  d.set(c.dwalletPubkey, CHAIN.DWALLET_PUBKEY);
  d.set(padAddr(c.contract), CHAIN.CONTRACT);
  d.set(c.domainSeparator, CHAIN.DOMAIN_SEPARATOR);
  writeU64(d, CHAIN.AUTHORIZED, c.authorized);
  writeU64(d, CHAIN.CAP, c.cap);
  d[CHAIN.ALLOWLIST_COUNT] = c.allowlist.length;
  c.allowlist.forEach((e, i) => d.set(padAddr(e), CHAIN.ALLOWLIST + i * ADDR_LEN));
  d[CHAIN.BUMP] = c.bump;
  return d;
}

export function encodeIntent(x: Omit<Intent, 'address'>): Uint8Array {
  const d = new Uint8Array(INTENT.LEN);
  d[0] = DISC_INTENT;
  d[1] = VERSION;
  d.set(a32(x.asset), INTENT.ASSET);
  writeU64(d, INTENT.INDEX, x.index);
  d[INTENT.KIND] = x.kind;
  d[INTENT.STATUS] = x.status;
  d.set(a32(x.proposer), INTENT.PROPOSER);
  writeU64(d, INTENT.AMOUNT, x.amount);
  writeU16(d, INTENT.SRC_CHAIN, x.srcChain);
  writeU16(d, INTENT.DST_CHAIN, x.dstChain);
  d.set(padAddr(x.recipient), INTENT.RECIPIENT);
  d.set(padAddr(x.source), INTENT.SOURCE);
  d.set(utf8Padded(x.memo, 32), INTENT.MEMO);
  writeI64(d, INTENT.CREATED_AT, x.createdAt);
  writeI64(d, INTENT.APPROVED_AT, x.approvedAt);
  d[INTENT.APPROVALS_BITMAP] = x.approvalsBitmap;
  d[INTENT.APPROVAL_COUNT] = x.approvalCount;
  d[INTENT.LEG_COUNT] = x.legs.length;
  d[INTENT.BUMP] = x.bump;
  x.legs.forEach((l, i) => {
    const o = INTENT.LEGS + i * LEG.LEN;
    d[o + LEG.ACTION] = l.action;
    writeU16(d, o + LEG.CHAIN_ID, l.chainId);
    d[o + LEG.STATUS] = l.status;
    d.set(l.messageDigest, o + LEG.MESSAGE_DIGEST);
    if (l.messageApproval) d.set(a32(l.messageApproval), o + LEG.MESSAGE_APPROVAL);
    d.set(padAddr(l.destTx), o + LEG.DEST_TX);
    writeI64(d, o + LEG.EXECUTED_AT, l.executedAt);
    writeI64(d, o + LEG.CONFIRMED_AT, l.confirmedAt);
  });
  return d;
}
