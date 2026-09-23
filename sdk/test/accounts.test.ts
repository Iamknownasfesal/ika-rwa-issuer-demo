import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { decodeAsset, decodeChain, decodeIntent, decodeMessageApproval } from '../src/accounts.js';
import { MESSAGE_APPROVAL, writeU16, writeU64 } from '../src/layout.js';
import type { Asset, ChainDeployment, Intent } from '../src/types.js';
import { encodeAsset, encodeChain, encodeIntent } from './encode.js';

const A = address('11111111111111111111111111111111');
const B = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const C = address('87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY');
const D = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

describe('account decoders', () => {
  it('round-trips Asset', () => {
    const a: Omit<Asset, 'address'> = {
      createKey: new Uint8Array(32).fill(7),
      admin: A,
      executor: B,
      symbol: 'TBILL',
      decimals: 6,
      threshold: 2,
      approvers: [A, B, C],
      chainCount: 6,
      globalCap: 100_000_000_000_000n,
      authorizedTotal: 67_500_000_000_000n,
      intentCount: 9n,
      timelockSecs: 5n,
      bump: 254,
      mintAuthorityBump: 253,
      ikaProgram: C,
    };
    const out = decodeAsset(D, encodeAsset(a));
    expect(out).toEqual({ ...a, address: D });
  });

  it('round-trips ChainDeployment', () => {
    const c: Omit<ChainDeployment, 'address'> = {
      asset: D,
      chainId: 2,
      legKind: 1,
      encoding: 1,
      curve: 0,
      signatureScheme: 0,
      dwallet: C,
      dwalletPubkey: new Uint8Array(33).fill(2),
      contract: new Uint8Array(20).fill(0xc0),
      domainSeparator: new Uint8Array(32).fill(0xd0),
      authorized: 20_000_000_000_000n,
      cap: 30_000_000_000_000n,
      allowlist: [new Uint8Array(20).fill(0xaa), new Uint8Array(20).fill(0xbb)],
      bump: 250,
    };
    expect(decodeChain(A, encodeChain(c))).toEqual({ ...c, address: A });
  });

  it('round-trips Intent with two legs', () => {
    const x: Omit<Intent, 'address'> = {
      asset: D,
      index: 3n,
      kind: 2,
      status: 2,
      proposer: A,
      amount: 5_000_000_000_000n,
      srcChain: 2,
      dstChain: 4,
      recipient: new Uint8Array(32).fill(0xbb),
      source: new Uint8Array(20).fill(0xaa),
      memo: 'demo move',
      createdAt: 1_700_000_000n,
      approvedAt: 1_700_000_010n,
      approvalsBitmap: 0b101,
      approvalCount: 2,
      legs: [
        { action: 1, chainId: 2, status: 2, messageDigest: new Uint8Array(32).fill(1), messageApproval: B, destTx: new Uint8Array(32).fill(0xe7), executedAt: 1n, confirmedAt: 2n },
        { action: 0, chainId: 4, status: 1, messageDigest: new Uint8Array(32).fill(2), messageApproval: C, destTx: new Uint8Array(), executedAt: 3n, confirmedAt: 0n },
      ],
      bump: 255,
    };
    expect(decodeIntent(B, encodeIntent(x))).toEqual({ ...x, address: B });
  });

  it('decodes a negative i64 and a null messageApproval', () => {
    const x: Omit<Intent, 'address'> = {
      asset: D, index: 0n, kind: 0, status: 0, proposer: A, amount: 1n, srcChain: 0, dstChain: 1,
      recipient: new Uint8Array(32), source: new Uint8Array(), memo: '', createdAt: -5n, approvedAt: 0n,
      approvalsBitmap: 0, approvalCount: 0, bump: 1,
      legs: [{ action: 0, chainId: 1, status: 0, messageDigest: new Uint8Array(32), messageApproval: null, destTx: new Uint8Array(), executedAt: 0n, confirmedAt: 0n }],
    };
    const out = decodeIntent(A, encodeIntent(x));
    expect(out.createdAt).toBe(-5n);
    expect(out.legs[0].messageApproval).toBeNull();
  });

  it('decodes MessageApproval', () => {
    const d = new Uint8Array(MESSAGE_APPROVAL.LEN);
    d[0] = 14;
    d[1] = 1;
    d.set(new Uint8Array(32).fill(9), MESSAGE_APPROVAL.MESSAGE_DIGEST);
    writeU16(d, MESSAGE_APPROVAL.SIGNATURE_SCHEME, 5);
    writeU64(d, MESSAGE_APPROVAL.EPOCH, 5n);
    d[MESSAGE_APPROVAL.STATUS] = 1;
    writeU16(d, MESSAGE_APPROVAL.SIGNATURE_LEN, 64);
    d.set(new Uint8Array(64).fill(0x51), MESSAGE_APPROVAL.SIGNATURE);
    const m = decodeMessageApproval(A, d);
    expect(m.status).toBe(1);
    expect(m.scheme).toBe(5);
    expect(m.signature.length).toBe(64);
    expect(m.signature[0]).toBe(0x51);
    expect(m.messageDigest[0]).toBe(9);
  });
});
