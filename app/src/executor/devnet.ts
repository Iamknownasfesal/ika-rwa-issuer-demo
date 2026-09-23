import type { ApproverId } from "@/demoConfig";
import type { Intent, IntentDraft, LedgerState, StepEvent } from "@/types";
import { IntentRejectedError, type Executor } from "./types";

/**
 * Talks to the app's API routes, which run server-side against the real
 * Solana devnet program and the Ika pre-alpha signing service.
 */
export class DevnetExecutor implements Executor {
  private async call<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      if (json?.results) throw new IntentRejectedError(json.error ?? "Rejected", json.results);
      throw new Error(json?.error ?? `HTTP ${res.status}`);
    }
    return json as T;
  }

  getLedger() {
    return this.call<LedgerState>("/api/ledger");
  }

  reset() {
    return this.getLedger();
  }

  createIntent(draft: IntentDraft, proposer: ApproverId) {
    return this.call<Intent>("/api/intents", { draft, approver: proposer });
  }

  approve(intentId: string, approver: ApproverId) {
    return this.call<Intent>(`/api/intents/${encodeURIComponent(intentId)}/approve`, { approver });
  }

  async execute(intentId: string, onEvent: (e: StepEvent) => void): Promise<Intent> {
    const res = await fetch(`/api/intents/${encodeURIComponent(intentId)}/execute`, { method: "POST" });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error ?? `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let last: Intent | undefined;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as StepEvent | { error: string } | { done: true; intent: Intent };
        if ("error" in msg) throw new Error(msg.error);
        if ("done" in msg) {
          last = msg.intent;
          continue;
        }
        onEvent(msg);
        if (msg.intent) last = msg.intent;
      }
    }
    if (!last) throw new Error("Execution ended without a result");
    return last;
  }
}
