/**
 * Authorization message + digest. Byte-for-byte mirror of
 * `programs/issuer-ledger/src/digest.rs`; verified by `test/digest.test.ts`
 * against vectors emitted by the Rust program.
 *
 * The dWallet never signs a raw destination transaction: it signs this
 * canonical authorization, which the on-chain ledger computes itself. The
 * destination contract verifies the same bytes, so a relayer can deliver it
 * and nothing can be minted/burned that the ledger did not authorize.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { Encoding } from './chains.js';
import { concat } from './layout.js';

export const RAW_PREFIX = new TextEncoder().encode('IKA_RWA_AUTH_V1');
export const EIP712_TYPE = 'IssuerAuthorization(uint8 action,uint256 amount,bytes32 account,uint256 nonce,bytes32 ledger)';
export const RAW_MESSAGE_LEN = 15 + 32 + 1 + 8 + 1 + 64 + 8 + 32; // 161
export const EIP712_MESSAGE_LEN = 2 + 32 + 32; // 66

export interface Authorization {
  /** 0 = mint, 1 = burn */
  action: 0 | 1;
  amount: bigint;
  /** destination (mint) or source (burn) account on the target chain, ≤ 64 bytes */
  account: Uint8Array;
  /** `(intent_index << 1) | leg_index` */
  nonce: bigint;
  /** Asset PDA (32 bytes) */
  ledger: Uint8Array;
  /** per-chain domain separator (32 bytes) */
  domainSeparator: Uint8Array;
}

export function keccak256(...parts: Uint8Array[]): Uint8Array {
  return keccak_256(concat(...parts));
}

export function legNonce(intentIndex: bigint, legIndex: number): bigint {
  return (intentIndex << 1n) | BigInt(legIndex & 1);
}

function u64le(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  let x = BigInt.asUintN(64, v);
  for (let i = 0; i < 8; i++) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}
function u256be(v: bigint): Uint8Array {
  const b = new Uint8Array(32);
  let x = BigInt.asUintN(256, v);
  for (let i = 31; i >= 0; i--) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

/** Raw message: prefix | domain | action | amount LE | account_len | account[64] | nonce LE | ledger */
export function rawMessage(a: Authorization): Uint8Array {
  check(a);
  const out = new Uint8Array(RAW_MESSAGE_LEN);
  let o = 0;
  out.set(RAW_PREFIX, o);
  o += 15;
  out.set(a.domainSeparator, o);
  o += 32;
  out[o++] = a.action;
  out.set(u64le(a.amount), o);
  o += 8;
  out[o++] = a.account.length;
  out.set(a.account, o);
  o += 64;
  out.set(u64le(a.nonce), o);
  o += 8;
  out.set(a.ledger, o);
  return out;
}

/** `bytes32 account`: right-aligned (EVM address → bytes32(uint160)), or keccak256 if > 32 bytes. */
export function accountWord(account: Uint8Array): Uint8Array {
  if (account.length <= 32) {
    const w = new Uint8Array(32);
    w.set(account, 32 - account.length);
    return w;
  }
  return keccak_256(account);
}

/** EIP-712 message: `0x19 0x01 || domainSeparator || structHash`. */
export function eip712Message(a: Authorization): Uint8Array {
  check(a);
  const typehash = keccak_256(new TextEncoder().encode(EIP712_TYPE));
  const structHash = keccak256(
    typehash,
    u256be(BigInt(a.action)),
    u256be(a.amount),
    accountWord(a.account),
    u256be(a.nonce),
    a.ledger,
  );
  const out = new Uint8Array(EIP712_MESSAGE_LEN);
  out[0] = 0x19;
  out[1] = 0x01;
  out.set(a.domainSeparator, 2);
  out.set(structHash, 34);
  return out;
}

/** The bytes the Ika network is asked to sign (it keccaks them itself). */
export function authorizationMessage(encoding: number, a: Authorization): Uint8Array {
  return encoding === Encoding.Eip712 ? eip712Message(a) : rawMessage(a);
}

/** keccak256(message): stored in the leg and in the Ika MessageApproval. */
export function messageDigest(encoding: number, a: Authorization): Uint8Array {
  return keccak_256(authorizationMessage(encoding, a));
}

/**
 * EIP-712 domain separator for a destination `MintController`:
 * keccak256(typeHash || keccak(name) || keccak(version) || chainId || verifyingContract).
 */
export function eip712DomainSeparator(d: { name: string; version: string; chainId: number | bigint; verifyingContract: Uint8Array }): Uint8Array {
  const enc = new TextEncoder();
  const typehash = keccak_256(enc.encode('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));
  return keccak256(typehash, keccak_256(enc.encode(d.name)), keccak_256(enc.encode(d.version)), u256be(BigInt(d.chainId)), accountWord(d.verifyingContract));
}

/** Domain separator for non-EVM chains: keccak256("ika-rwa:<chainKey>"). */
export function rawDomainSeparator(chainKey: string): Uint8Array {
  return keccak_256(new TextEncoder().encode(`ika-rwa:${chainKey}`));
}

function check(a: Authorization): void {
  if (a.ledger.length !== 32) throw new Error('ledger must be 32 bytes');
  if (a.domainSeparator.length !== 32) throw new Error('domainSeparator must be 32 bytes');
  if (a.account.length > 64) throw new Error('account must be ≤ 64 bytes');
}
