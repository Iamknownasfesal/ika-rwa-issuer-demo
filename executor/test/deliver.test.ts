import { ChainId } from '@ika-rwa/ledger-sdk';
import { describe, expect, it } from 'vitest';
import { mockDeliver } from '../src/deliver/mock.js';
import { withSigners } from '../src/solana.js';
import { AccountRole, address } from '@solana/kit';

const digest = new Uint8Array(32).fill(1);
const sig = new Uint8Array(64).fill(2);

describe('mockDeliver', () => {
  it('formats per chain and is deterministic', () => {
    const eth = mockDeliver(ChainId.Ethereum, digest, sig);
    expect(eth.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(eth.txHashBytes.length).toBe(32);
    expect(eth.explorer).toContain('sepolia.etherscan.io/tx/');
    expect(mockDeliver(ChainId.Ethereum, digest, sig).txHash).toBe(eth.txHash);
    const sui = mockDeliver(ChainId.Sui, digest, sig);
    expect(sui.txHash).not.toMatch(/^0x/);
  });
});

describe('withSigners', () => {
  it('attaches matching signers only', () => {
    const a = address('11111111111111111111111111111111');
    const b = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
    const ix = { programAddress: b, accounts: [{ address: a, role: AccountRole.READONLY_SIGNER }, { address: b, role: AccountRole.WRITABLE }], data: new Uint8Array() };
    const fake = { address: a } as never;
    const out = withSigners(ix, [fake]);
    expect((out.accounts?.[0] as { signer?: unknown }).signer).toBe(fake);
    expect((out.accounts?.[1] as { signer?: unknown }).signer).toBeUndefined();
  });
});
