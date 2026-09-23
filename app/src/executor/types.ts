import type { ApproverId } from "@/demoConfig";
import type { Intent, IntentDraft, LedgerState, RuleResult, StepEvent } from "@/types";

/**
 * The adapter seam. The UI store only ever talks to this interface;
 * `MockExecutor` simulates every chain in memory, `DevnetExecutor` talks to the
 * app's API routes which drive the real Solana program and Ika signing.
 */
export interface Executor {
  getLedger(): Promise<LedgerState>;
  /** Runs the policy; rejects with `IntentRejectedError` when a rule fails (or the program rejects). */
  createIntent(draft: IntentDraft, proposer: ApproverId): Promise<Intent>;
  approve(intentId: string, approver: ApproverId): Promise<Intent>;
  /** Executes every executable leg in order, streaming stepper events. */
  execute(intentId: string, onEvent: (e: StepEvent) => void): Promise<Intent>;
  reset(): Promise<LedgerState>;
}

export class IntentRejectedError extends Error {
  constructor(
    message: string,
    public readonly results: RuleResult[] = [],
  ) {
    super(message);
    this.name = "IntentRejectedError";
  }
}
