/**
 * Pure mirror of the on-chain policy in `create_intent` / `execute_leg`.
 * Returns EVERY rule with a pass/fail and a numeric explanation so the
 * console can show all failures at once (the program aborts on the first).
 */
import { formatAmount } from './format.js';
import { bytesEqual } from './layout.js';
import { chainById } from './chains.js';
import { explainError } from './errors.js';
import type { Address, Asset, ChainDeployment, Ledger } from './types.js';

export { explainError };

export type RuleName = 'amount' | 'globalCap' | 'chainCap' | 'supply' | 'allowlist' | 'proposer';

export interface RuleResult {
  rule: RuleName;
  ok: boolean;
  detail: string;
}

export interface IntentDraft {
  /** 0 mint, 1 burn, 2 move */
  kind: number;
  amount: bigint;
  srcChain?: number;
  dstChain?: number;
  recipient?: Uint8Array;
  source?: Uint8Array;
  proposer?: Address;
}

const fmt = (v: bigint, a: Asset) => formatAmount(v, a.decimals);

function chainOf(ledger: Ledger, id: number | undefined): ChainDeployment | undefined {
  return id === undefined ? undefined : ledger.chains.find((c) => c.chainId === id);
}

export function evaluate(draft: IntentDraft, ledger: Ledger): RuleResult[] {
  const { asset } = ledger;
  const out: RuleResult[] = [];
  const amount = draft.amount;
  const src = chainOf(ledger, draft.srcChain);
  const dst = chainOf(ledger, draft.dstChain);
  const isMint = draft.kind === 0;
  const isBurn = draft.kind === 1;
  const isMove = draft.kind === 2;

  out.push({
    rule: 'amount',
    ok: amount > 0n,
    detail: amount > 0n ? `Amount ${fmt(amount, asset)} > 0` : 'Amount must be greater than 0',
  });

  if (draft.proposer !== undefined) {
    const ok = asset.approvers.includes(draft.proposer);
    out.push({ rule: 'proposer', ok, detail: ok ? 'Proposer is an issuer operator' : 'Proposer is not in the approver set' });
  }

  if (isBurn || isMove) {
    if (!src) {
      out.push({ rule: 'supply', ok: false, detail: 'Source chain not selected' });
    } else {
      const ok = src.authorized >= amount;
      const name = chainById(src.chainId).name;
      out.push({
        rule: 'supply',
        ok,
        detail: `${name} supply: ${fmt(src.authorized, asset)} ${ok ? '≥' : '<'} ${fmt(amount, asset)}`,
      });
    }
  }

  if (isMint || isMove) {
    if (isMint) {
      const total = asset.authorizedTotal + amount;
      const ok = total <= asset.globalCap;
      out.push({
        rule: 'globalCap',
        ok,
        detail: `Global cap: ${fmt(asset.authorizedTotal, asset)} + ${fmt(amount, asset)} = ${fmt(total, asset)} ${ok ? '≤' : '>'} ${fmt(asset.globalCap, asset)}`,
      });
    }
    if (!dst) {
      out.push({ rule: 'chainCap', ok: false, detail: 'Destination chain not selected' });
      out.push({ rule: 'allowlist', ok: false, detail: 'Destination chain not selected' });
    } else {
      const name = chainById(dst.chainId).name;
      const newChain = dst.authorized + amount;
      const capOk = newChain <= dst.cap;
      out.push({
        rule: 'chainCap',
        ok: capOk,
        detail: `${name} cap: ${fmt(dst.authorized, asset)} + ${fmt(amount, asset)} = ${fmt(newChain, asset)} ${capOk ? '≤' : '>'} ${fmt(dst.cap, asset)}`,
      });
      const recipient = draft.recipient ?? new Uint8Array();
      const allowOk = recipient.length > 0 && dst.allowlist.some((a) => bytesEqual(a, recipient));
      out.push({
        rule: 'allowlist',
        ok: allowOk,
        detail: allowOk ? `Recipient is allowlisted on ${name}` : recipient.length === 0 ? 'Recipient required' : `Recipient is not on the ${name} allowlist`,
      });
    }
  }

  if (isMove && draft.srcChain !== undefined && draft.srcChain === draft.dstChain) {
    out.push({ rule: 'chainCap', ok: false, detail: 'Source and destination chains must differ' });
  }

  return out;
}

export function policyPasses(results: RuleResult[]): boolean {
  return results.every((r) => r.ok);
}

/** Execution-time checks (threshold + timelock) for display. */
export function executionReadiness(x: { approvalCount: number; threshold: number; approvedAt: bigint; timelockSecs: bigint; now: bigint }): {
  thresholdMet: boolean;
  unlockAt: bigint;
  timelockElapsed: boolean;
  secondsRemaining: number;
} {
  const thresholdMet = x.approvalCount >= x.threshold;
  const unlockAt = x.approvedAt + x.timelockSecs;
  const timelockElapsed = thresholdMet && x.now >= unlockAt;
  const secondsRemaining = thresholdMet ? Math.max(0, Number(unlockAt - x.now)) : 0;
  return { thresholdMet, unlockAt, timelockElapsed, secondsRemaining };
}
