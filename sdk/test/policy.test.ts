import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { evaluate, executionReadiness, policyPasses } from '../src/policy.js';
import type { Asset, ChainDeployment, Ledger } from '../src/types.js';

const M = 1_000_000n;
const alice = address('11111111111111111111111111111111');
const bob = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const stranger = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const ETH_TREASURY = new Uint8Array(20).fill(0xaa);
const SUI_TREASURY = new Uint8Array(32).fill(0xbb);

const asset: Asset = {
  address: alice, createKey: new Uint8Array(32), admin: alice, executor: alice, symbol: 'TBILL', decimals: 6, threshold: 2,
  approvers: [alice, bob], chainCount: 2, globalCap: 100_000_000n * M, authorizedTotal: 65_000_000n * M, intentCount: 0n,
  timelockSecs: 5n, bump: 0, mintAuthorityBump: 0, ikaProgram: alice,
};
const chain = (chainId: number, authorized: bigint, cap: bigint, allow: Uint8Array): ChainDeployment => ({
  address: alice, asset: alice, chainId, legKind: 1, encoding: 1, curve: 0, signatureScheme: 0, dwallet: alice,
  dwalletPubkey: new Uint8Array(), contract: new Uint8Array(), domainSeparator: new Uint8Array(32), authorized, cap, allowlist: [allow], bump: 0,
});
const ledger: Ledger = { asset, chains: [chain(2, 20_000_000n * M, 30_000_000n * M, ETH_TREASURY), chain(4, 5_000_000n * M, 15_000_000n * M, SUI_TREASURY)] };

const byRule = (rs: ReturnType<typeof evaluate>, r: string) => rs.find((x) => x.rule === r);

describe('evaluate', () => {
  it('passes a valid mint and lists every rule with numbers', () => {
    const rs = evaluate({ kind: 0, amount: 2_500_000n * M, dstChain: 2, recipient: ETH_TREASURY, proposer: alice }, ledger);
    expect(policyPasses(rs)).toBe(true);
    expect(rs.map((r) => r.rule)).toEqual(['amount', 'proposer', 'globalCap', 'chainCap', 'allowlist']);
    expect(byRule(rs, 'globalCap')?.detail).toBe('Global cap: 65,000,000 + 2,500,000 = 67,500,000 ≤ 100,000,000');
    expect(byRule(rs, 'chainCap')?.detail).toBe('Ethereum cap: 20,000,000 + 2,500,000 = 22,500,000 ≤ 30,000,000');
  });

  it('reports global AND chain cap failures together', () => {
    const rs = evaluate({ kind: 0, amount: 40_000_000n * M, dstChain: 2, recipient: ETH_TREASURY }, ledger);
    expect(byRule(rs, 'globalCap')?.ok).toBe(false);
    expect(byRule(rs, 'globalCap')?.detail).toBe('Global cap: 65,000,000 + 40,000,000 = 105,000,000 > 100,000,000');
    expect(byRule(rs, 'chainCap')?.ok).toBe(false);
    expect(byRule(rs, 'allowlist')?.ok).toBe(true);
  });

  it('rejects a non-allowlisted recipient', () => {
    const rs = evaluate({ kind: 0, amount: 1n * M, dstChain: 2, recipient: new Uint8Array(20).fill(0x99) }, ledger);
    expect(byRule(rs, 'allowlist')?.ok).toBe(false);
    expect(rs.filter((r) => !r.ok).map((r) => r.rule)).toEqual(['allowlist']);
  });

  it('rejects zero amount', () => {
    const rs = evaluate({ kind: 0, amount: 0n, dstChain: 2, recipient: ETH_TREASURY }, ledger);
    expect(byRule(rs, 'amount')?.ok).toBe(false);
  });

  it('checks supply for a burn', () => {
    const ok = evaluate({ kind: 1, amount: 5_000_000n * M, srcChain: 4, source: SUI_TREASURY }, ledger);
    expect(policyPasses(ok)).toBe(true);
    const bad = evaluate({ kind: 1, amount: 6_000_000n * M, srcChain: 4, source: SUI_TREASURY }, ledger);
    expect(byRule(bad, 'supply')?.ok).toBe(false);
    expect(byRule(bad, 'supply')?.detail).toBe('Sui supply: 5,000,000 < 6,000,000');
    expect(byRule(bad, 'globalCap')).toBeUndefined();
  });

  it('evaluates a move: source supply + destination cap + allowlist, no global cap', () => {
    const rs = evaluate({ kind: 2, amount: 5_000_000n * M, srcChain: 2, dstChain: 4, recipient: SUI_TREASURY, source: ETH_TREASURY }, ledger);
    expect(policyPasses(rs)).toBe(true);
    expect(rs.map((r) => r.rule)).toEqual(['amount', 'supply', 'chainCap', 'allowlist']);
    const tooBig = evaluate({ kind: 2, amount: 11_000_000n * M, srcChain: 2, dstChain: 4, recipient: SUI_TREASURY, source: ETH_TREASURY }, ledger);
    expect(byRule(tooBig, 'chainCap')?.ok).toBe(false);
    const same = evaluate({ kind: 2, amount: 1n * M, srcChain: 2, dstChain: 2, recipient: ETH_TREASURY, source: ETH_TREASURY }, ledger);
    expect(same.some((r) => !r.ok && r.detail.includes('must differ'))).toBe(true);
  });

  it('flags a proposer outside the approver set', () => {
    const rs = evaluate({ kind: 0, amount: 1n * M, dstChain: 2, recipient: ETH_TREASURY, proposer: stranger }, ledger);
    expect(byRule(rs, 'proposer')?.ok).toBe(false);
  });
});

describe('executionReadiness', () => {
  it('computes threshold and timelock', () => {
    const r = executionReadiness({ approvalCount: 2, threshold: 2, approvedAt: 100n, timelockSecs: 5n, now: 103n });
    expect(r.thresholdMet).toBe(true);
    expect(r.timelockElapsed).toBe(false);
    expect(r.secondsRemaining).toBe(2);
    expect(executionReadiness({ approvalCount: 1, threshold: 2, approvedAt: 0n, timelockSecs: 5n, now: 999n }).thresholdMet).toBe(false);
    expect(executionReadiness({ approvalCount: 2, threshold: 2, approvedAt: 100n, timelockSecs: 5n, now: 105n }).timelockElapsed).toBe(true);
  });
});
