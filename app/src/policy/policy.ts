/**
 * Pure policy evaluation. Mirrors the on-chain rules in
 * `programs/issuer-ledger/src/instructions.rs` (create_intent / execute_leg).
 *
 * Every rule that applies to the intent is returned, pass or fail, with the
 * numbers in the explanation. Rules never collapse into a single "invalid".
 */
import type { Asset, ChainKey, Intent, IntentDraft, PolicyConfig, RuleResult } from "@/types";
import { fmtAmount } from "@/lib/format";
import { CHAINS } from "@/lib/chains";

export interface LedgerView {
  asset: Asset;
  config: PolicyConfig;
}

const f = (n: number) => fmtAmount(n);

function chainOf(asset: Asset, key: ChainKey | undefined) {
  return asset.chains.find((c) => c.chain === key);
}

export function authorizedTotal(asset: Asset): number {
  return asset.chains.reduce((s, c) => s + c.authorized, 0);
}

/** Draft-time rules: amount, global cap, per-chain cap, sufficient supply, recipient allowlist. */
export function evaluate(draft: IntentDraft, ledger: LedgerView): RuleResult[] {
  const { asset, config } = ledger;
  const out: RuleResult[] = [];
  const amount = Number.isFinite(draft.amount) ? draft.amount : 0;
  const total = authorizedTotal(asset);

  out.push({
    rule: "amount",
    label: "Amount > 0",
    ok: Number.isInteger(amount) && amount > 0,
    detail: amount > 0 ? `${f(amount)} ${asset.name}` : "Amount must be greater than zero",
  });

  const src = draft.type === "mint" ? undefined : chainOf(asset, draft.srcChain);
  const dst = draft.type === "burn" ? undefined : chainOf(asset, draft.dstChain);

  if (draft.type === "mint") {
    const next = total + amount;
    out.push({
      rule: "globalCap",
      label: "Global cap",
      ok: next <= config.globalCap,
      detail: `Global cap: ${f(total)} + ${f(amount)} = ${f(next)} ${next <= config.globalCap ? "≤" : ">"} ${f(config.globalCap)}`,
    });
  }

  if (draft.type === "burn" || draft.type === "move") {
    if (!src) {
      out.push({ rule: "supply", label: "Sufficient supply", ok: false, detail: "Select a source chain" });
    } else {
      out.push({
        rule: "supply",
        label: "Sufficient supply",
        ok: src.authorized >= amount,
        detail: `${src.name} supply: ${f(src.authorized)} ${src.authorized >= amount ? "≥" : "<"} ${f(amount)}`,
      });
    }
  }

  if (draft.type === "mint" || draft.type === "move") {
    if (!dst) {
      out.push({ rule: "chainCap", label: "Per-chain cap", ok: false, detail: "Select a destination chain" });
      out.push({ rule: "allowlist", label: "Recipient allowlist", ok: false, detail: "Select a destination chain" });
    } else {
      if (draft.type === "move" && src && src.chain === dst.chain) {
        out.push({ rule: "chainCap", label: "Per-chain cap", ok: false, detail: "Source and destination must differ" });
      } else {
        const next = dst.authorized + amount;
        out.push({
          rule: "chainCap",
          label: "Per-chain cap",
          ok: next <= dst.cap,
          detail: `${dst.name} cap: ${f(dst.authorized)} + ${f(amount)} = ${f(next)} ${next <= dst.cap ? "≤" : ">"} ${f(dst.cap)}`,
        });
      }
      const list = config.allowlist[dst.chain] ?? [];
      const recipient = (draft.recipient ?? "").trim();
      const hit = list.find((e) => e.address.toLowerCase() === recipient.toLowerCase());
      const meta = CHAINS[dst.chain];
      out.push({
        rule: "allowlist",
        label: "Recipient allowlist",
        ok: !!hit,
        detail: hit
          ? `${hit.label} is allowlisted`
          : recipient
            ? meta.isValidAddress(recipient)
              ? `Recipient ${recipient} is not in the ${dst.name} allowlist (${list.length} allowed)`
              : `Recipient is not a valid ${dst.name} ${meta.addressPlaceholder}`
            : `Choose a recipient from the ${dst.name} allowlist`,
      });
    }
  }

  return out;
}

/** Execute-time rules: approval threshold and timelock. */
export function evaluateExecution(intent: Intent, config: PolicyConfig, now = Date.now()): RuleResult[] {
  const distinct = new Set(intent.approvals.map((a) => a.approver));
  const notProposer = intent.approvals.every((a) => a.approver !== intent.proposer);
  const okThreshold = distinct.size >= config.threshold && notProposer;
  const out: RuleResult[] = [
    {
      rule: "threshold",
      label: "Approval threshold",
      ok: okThreshold,
      detail: `${distinct.size} of ${config.threshold} required approvals` + (notProposer ? "" : " · proposer cannot approve"),
    },
  ];
  if (intent.approvedAt) {
    const unlock = new Date(intent.approvedAt).getTime() + config.timelockSeconds * 1000;
    const remaining = Math.max(0, Math.ceil((unlock - now) / 1000));
    out.push({
      rule: "timelock",
      label: "Timelock",
      ok: now >= unlock,
      detail: now >= unlock ? `Timelock of ${config.timelockSeconds}s elapsed` : `Timelock: ${remaining}s remaining of ${config.timelockSeconds}s`,
    });
  } else {
    out.push({ rule: "timelock", label: "Timelock", ok: false, detail: `Starts after ${config.threshold} approvals (${config.timelockSeconds}s)` });
  }
  return out;
}

export function allOk(results: RuleResult[]): boolean {
  return results.every((r) => r.ok);
}

/** Program error codes (programs/issuer-ledger/src/error.rs) → text. */
export const PROGRAM_ERRORS: Record<number, { rule: string; message: string }> = {
  0: { rule: "amount", message: "Amount must be greater than zero" },
  1: { rule: "globalCap", message: "Global cap exceeded" },
  2: { rule: "chainCap", message: "Per-chain cap exceeded" },
  3: { rule: "supply", message: "Insufficient authorized supply on the source chain" },
  4: { rule: "allowlist", message: "Recipient is not allowlisted on the destination chain" },
  5: { rule: "threshold", message: "Signer is not an approver" },
  6: { rule: "threshold", message: "Proposer cannot approve their own intent" },
  7: { rule: "threshold", message: "Approver already approved this intent" },
  8: { rule: "threshold", message: "Approval threshold not met" },
  9: { rule: "timelock", message: "Timelock still active" },
  10: { rule: "status", message: "Intent or leg is not in a state that allows this action" },
  11: { rule: "status", message: "Burn leg must be confirmed before the mint leg" },
  12: { rule: "status", message: "Chain account does not match the leg" },
  13: { rule: "auth", message: "Signer is not admin, executor or approver" },
  14: { rule: "status", message: "Chain kind does not match the accounts supplied" },
  15: { rule: "status", message: "Token account does not match the intent recipient/source" },
  16: { rule: "status", message: "Unknown chain" },
  17: { rule: "status", message: "Invalid configuration" },
  18: { rule: "status", message: "Address too long" },
  19: { rule: "status", message: "Unknown intent kind" },
  20: { rule: "status", message: "Invalid account" },
  21: { rule: "status", message: "Arithmetic overflow" },
  22: { rule: "chainCap", message: "Source and destination chains must differ" },
};

export function explainProgramError(codeOrMessage: number | string): string {
  const m = typeof codeOrMessage === "string" ? codeOrMessage.match(/Custom\((\d+)\)|custom program error: 0x([0-9a-f]+)/i) : null;
  const code = typeof codeOrMessage === "number" ? codeOrMessage : m ? (m[1] ? Number(m[1]) : parseInt(m[2], 16)) : NaN;
  const e = PROGRAM_ERRORS[code];
  return e ? `Program rejected: ${e.message} (error ${code})` : String(codeOrMessage);
}
