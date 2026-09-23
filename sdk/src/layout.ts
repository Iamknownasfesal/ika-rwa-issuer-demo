/**
 * Byte offsets mirrored from `programs/issuer-ledger/src/state.rs`.
 * Keep in sync by hand; `test/accounts.test.ts` round-trips every field.
 */
export const MAX_APPROVERS = 5;
export const MAX_ALLOWLIST = 4;
export const MAX_LEGS = 2;
export const ADDR_BYTES = 64;
export const ADDR_LEN = 1 + ADDR_BYTES;

export const DISC_ASSET = 1;
export const DISC_CHAIN = 2;
export const DISC_INTENT = 3;
export const VERSION = 1;

export const ASSET = {
  CREATE_KEY: 2,
  ADMIN: 34,
  EXECUTOR: 66,
  SYMBOL: 98,
  DECIMALS: 106,
  THRESHOLD: 107,
  APPROVER_COUNT: 108,
  CHAIN_COUNT: 109,
  GLOBAL_CAP: 110,
  AUTHORIZED_TOTAL: 118,
  INTENT_COUNT: 126,
  TIMELOCK_SECS: 134,
  APPROVERS: 142,
  BUMP: 302,
  MINT_AUTHORITY_BUMP: 303,
  IKA_PROGRAM: 304,
  LEN: 352,
} as const;

export const CHAIN = {
  ASSET: 2,
  CHAIN_ID: 34,
  LEG_KIND: 36,
  ENCODING: 37,
  CURVE: 38,
  SIGNATURE_SCHEME: 40,
  DWALLET: 42,
  DWALLET_PUBKEY_LEN: 74,
  DWALLET_PUBKEY: 75,
  CONTRACT: 140,
  DOMAIN_SEPARATOR: 205,
  AUTHORIZED: 237,
  CAP: 245,
  ALLOWLIST_COUNT: 253,
  ALLOWLIST: 254,
  BUMP: 514,
  LEN: 531,
} as const;

export const INTENT = {
  ASSET: 2,
  INDEX: 34,
  KIND: 42,
  STATUS: 43,
  PROPOSER: 44,
  AMOUNT: 76,
  SRC_CHAIN: 84,
  DST_CHAIN: 86,
  RECIPIENT: 88,
  SOURCE: 153,
  MEMO: 218,
  CREATED_AT: 250,
  APPROVED_AT: 258,
  APPROVALS_BITMAP: 266,
  APPROVAL_COUNT: 267,
  LEG_COUNT: 268,
  BUMP: 269,
  LEGS: 270,
  LEN: 568,
} as const;

export const LEG = {
  ACTION: 0,
  CHAIN_ID: 1,
  STATUS: 3,
  MESSAGE_DIGEST: 4,
  MESSAGE_APPROVAL: 36,
  DEST_TX: 68,
  EXECUTED_AT: 133,
  CONFIRMED_AT: 141,
  LEN: 149,
} as const;

/** Ika MessageApproval (disc 14, 312 bytes). */
export const MESSAGE_APPROVAL = {
  DISC: 14,
  DWALLET: 2,
  MESSAGE_DIGEST: 34,
  MESSAGE_METADATA_DIGEST: 66,
  APPROVER: 98,
  USER_PUBKEY: 130,
  SIGNATURE_SCHEME: 162,
  EPOCH: 164,
  STATUS: 172,
  SIGNATURE_LEN: 173,
  SIGNATURE: 175,
  BUMP: 303,
  LEN: 312,
} as const;

/** Ika DWallet (disc 2, 153 bytes). */
export const DWALLET = {
  DISC: 2,
  AUTHORITY: 2,
  CURVE: 34,
  STATE: 36,
  PUBLIC_KEY_LEN: 37,
  PUBLIC_KEY: 38,
  BUMP: 144,
  LEN: 153,
} as const;

// ── byte helpers ──

export function readU16(d: Uint8Array, off: number): number {
  return d[off] | (d[off + 1] << 8);
}
export function readU64(d: Uint8Array, off: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[off + i]);
  return v;
}
export function readI64(d: Uint8Array, off: number): bigint {
  return BigInt.asIntN(64, readU64(d, off));
}
export function writeU16(d: Uint8Array, off: number, v: number): void {
  d[off] = v & 0xff;
  d[off + 1] = (v >> 8) & 0xff;
}
export function writeU64(d: Uint8Array, off: number, v: bigint): void {
  let x = BigInt.asUintN(64, v);
  for (let i = 0; i < 8; i++) {
    d[off + i] = Number(x & 0xffn);
    x >>= 8n;
  }
}
export function writeI64(d: Uint8Array, off: number, v: bigint): void {
  writeU64(d, off, BigInt.asUintN(64, v));
}
export function u64le(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  writeU64(b, 0, v);
  return b;
}
export function u16le(v: number): Uint8Array {
  const b = new Uint8Array(2);
  writeU16(b, 0, v);
  return b;
}
/** Read `len(1) | bytes(64)`. */
export function readAddr(d: Uint8Array, off: number): Uint8Array {
  const len = Math.min(d[off], ADDR_BYTES);
  return d.slice(off + 1, off + 1 + len);
}
/** Encode `len(1) | bytes(64)` (zero padded). */
export function padAddr(bytes: Uint8Array): Uint8Array {
  if (bytes.length > ADDR_BYTES) throw new Error(`address too long (${bytes.length} > ${ADDR_BYTES})`);
  const out = new Uint8Array(ADDR_LEN);
  out[0] = bytes.length;
  out.set(bytes, 1);
  return out;
}
export function concat(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
