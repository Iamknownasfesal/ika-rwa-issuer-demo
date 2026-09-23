import { demoConfig, type ApproverId } from "@/demoConfig";
import { CHAINS } from "@/lib/chains";
import { fake } from "@/lib/hashes";
import { allOk, evaluate, evaluateExecution } from "@/policy/policy";
import { buildSeed } from "@/seed";
import type { Intent, IntentDraft, LedgerState, Leg, LegExecution, StepEvent } from "@/types";
import { IntentRejectedError, type Executor } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => structuredClone(v);

/**
 * In-memory executor. Chain state is simulated; timers are real so the
 * timelock countdown and the execution stepper behave like the live version.
 */
export class MockExecutor implements Executor {
  private state: LedgerState = buildSeed();
  private counter = this.state.intents.length;

  async getLedger() {
    return clone(this.state);
  }

  async reset() {
    this.state = buildSeed();
    this.counter = this.state.intents.length;
    return clone(this.state);
  }

  async createIntent(draft: IntentDraft, proposer: ApproverId): Promise<Intent> {
    const results = evaluate(draft, this.state);
    if (!allOk(results)) {
      throw new IntentRejectedError(
        `Policy rejected: ${results
          .filter((r) => !r.ok)
          .map((r) => r.label)
          .join(", ")}`,
        results,
      );
    }
    const legs: Leg[] = [];
    if (draft.type === "burn" || draft.type === "move") legs.push({ action: "burn", chain: draft.srcChain!, amount: draft.amount, account: draft.source ?? "" });
    if (draft.type === "mint" || draft.type === "move") legs.push({ action: "mint", chain: draft.dstChain!, amount: draft.amount, account: draft.recipient ?? "" });
    const index = this.counter++;
    const intent: Intent = {
      id: `INT-${String(index + 1).padStart(4, "0")}`,
      index,
      type: draft.type,
      legs,
      amount: draft.amount,
      recipient: draft.recipient,
      source: draft.source,
      memo: draft.memo,
      proposer,
      status: "pending_approval",
      policyResults: results,
      approvals: [],
      createdAt: new Date().toISOString(),
    };
    this.state.intents.unshift(intent);
    return clone(intent);
  }

  async approve(intentId: string, approver: ApproverId): Promise<Intent> {
    const intent = this.find(intentId);
    if (intent.status !== "pending_approval") throw new Error("Intent is not pending approval");
    if (!this.state.config.approvers.some((a) => a.id === approver)) throw new Error("Not an approver");
    if (approver === intent.proposer) throw new Error("Proposer cannot approve their own intent");
    if (intent.approvals.some((a) => a.approver === approver)) throw new Error("Already approved by this approver");
    intent.approvals.push({ approver, at: new Date().toISOString() });
    if (intent.approvals.length >= this.state.config.threshold) {
      intent.status = "approved";
      intent.approvedAt = new Date().toISOString();
    }
    return clone(intent);
  }

  async execute(intentId: string, onEvent: (e: StepEvent) => void): Promise<Intent> {
    const intent = this.find(intentId);
    if (intent.status !== "approved" && intent.status !== "executing") throw new Error("Intent is not approved");
    const exec = evaluateExecution(intent, this.state.config);
    const failed = exec.find((r) => !r.ok);
    if (failed) throw new Error(failed.detail);

    intent.status = "executing";
    intent.execution ??= { legs: intent.legs.map(() => ({ status: "pending" })) };
    const delay = demoConfig.stepDelayMs;

    for (let i = 0; i < intent.legs.length; i++) {
      const leg = intent.legs[i];
      const ex = intent.execution.legs[i];
      if (ex.status === "confirmed") continue;
      const dep = this.state.asset.chains.find((c) => c.chain === leg.chain)!;
      const meta = CHAINS[leg.chain];
      const tag = `${intent.id}-leg${i}`;
      const isSolana = leg.chain === "solana";
      const emit = (step: 1 | 2 | 3, status: StepEvent["status"], detail?: string) =>
        onEvent({ intentId, leg: i, step, status, detail, execution: clone(ex), intent: clone(intent), asset: clone(this.state.asset) });

      // Step 1: Solana policy approval (execute_leg). Supply moves at authorization time.
      ex.status = "policy";
      emit(1, "start", "Solana ledger re-checks caps and records the authorization");
      await sleep(delay);
      ex.policyTxHash = fake.solanaTx(`${tag}-policy`);
      ex.dwalletId = dep.dwalletId;
      ex.curve = meta.curve;
      if (leg.action === "mint") dep.authorized += leg.amount;
      else dep.authorized -= leg.amount;
      dep.lastActivity = new Date().toISOString();
      emit(1, "ok", isSolana ? "Token-2022 mint authority CPI executed" : "MessageApproval created via CPI to the Ika dWallet program");

      // Step 2: Ika signature (foreign chains). The Solana leg is signed by the program PDA itself.
      ex.status = "signing";
      emit(2, "start", isSolana ? "No external signature needed" : `Ika network signs with the ${meta.curve} dWallet`);
      await sleep(isSolana ? Math.min(delay, 400) : delay);
      if (!isSolana) {
        ex.messageApproval = fake.solanaAddress(`${tag}-ma`);
        ex.messageDigest = fake.digest(`${tag}-digest`);
        ex.ikaSignatureId = `sig-${fake.pubkeyHex(`${tag}-sig`, 6)}`;
        ex.signature = "0x" + fake.pubkeyHex(`${tag}-sigbytes`, 64);
      }
      emit(2, "ok", isSolana ? "Program PDA is the mint authority" : "Signature committed on the MessageApproval PDA");

      // Step 3: destination confirmation.
      ex.status = "broadcast";
      emit(3, "start", isSolana ? "Confirmed in the same Solana transaction" : `Relayer delivers the signed authorization to ${meta.name}`);
      await sleep(isSolana ? Math.min(delay, 400) : delay);
      ex.destTxHash = isSolana ? ex.policyTxHash : meta.fakeTx(`${tag}-dest`);
      ex.block = fake.block(`${tag}-block`);
      ex.status = "confirmed";
      emit(3, "ok", `${meta.name} ${leg.action} confirmed`);
    }

    intent.status = "executed";
    return clone(intent);
  }

  private find(id: string): Intent {
    const i = this.state.intents.find((x) => x.id === id);
    if (!i) throw new Error(`Unknown intent ${id}`);
    return i;
  }
}

export type { LegExecution };
