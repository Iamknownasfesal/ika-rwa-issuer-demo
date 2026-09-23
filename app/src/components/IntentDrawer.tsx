"use client";

import { useMemo } from "react";
import { Check, Circle, Lock, Play, Unlock, X } from "lucide-react";
import { demoConfig } from "@/demoConfig";
import { fmtAmount, fmtTime } from "@/lib/format";
import { evaluateExecution } from "@/policy/policy";
import { useLedgerStore } from "@/store/useLedgerStore";
import { ExecutionStepper } from "./ExecutionStepper";
import { IntentActivity } from "./IntentActivity";
import { IntentChains, intentTitle } from "./IntentList";
import { PolicyCheckPanel } from "./PolicyCheckPanel";
import { useTimelock } from "./TimelockCountdown";
import { Avatar, Hash, Property, StatusIcon, statusLabel } from "./ui";

export function IntentDrawer() {
  const { ledger, selectedIntentId, openIntent, approver, approveIntent, executeIntent, executing } = useLedgerStore();
  const intent = ledger?.intents.find((i) => i.id === selectedIntentId);
  const config = ledger?.config;
  const timelock = useTimelock(intent?.approvedAt, config?.timelockSeconds ?? demoConfig.timelockSeconds);
  const execRules = useMemo(() => (intent && config ? evaluateExecution(intent, config) : []), [intent, config]);

  if (!intent || !config || !ledger) return null;

  const name = (id: string) => demoConfig.approvers.find((a) => a.id === id)?.name ?? id;
  const canApprove = intent.status === "pending_approval" && approver !== intent.proposer && !intent.approvals.some((a) => a.approver === approver);
  const canExecute = (intent.status === "approved" || intent.status === "executing") && timelock.elapsed && !executing[intent.id];
  const busy = executing[intent.id];

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[540px] flex-col border-l border-border bg-surface shadow-[-12px_0_32px_-16px_rgba(0,0,0,0.18)]">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="mono text-[12px] text-fg-faint">{intent.id}</span>
        <span className="flex items-center gap-1.5 text-fg-muted">
          <StatusIcon status={intent.status} />
          {statusLabel(intent.status)}
        </span>
        <button className="ml-auto rounded p-1 text-fg-muted hover:bg-hover hover:text-fg" onClick={() => openIntent(null)} aria-label="Close">
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">{intentTitle(intent, ledger.asset.name)}</h1>
          <div className="mt-1.5">
            <IntentChains intent={intent} />
          </div>
          {intent.memo && <p className="mt-2 text-fg-muted">{intent.memo}</p>}
        </div>

        <dl>
          <Property label="Proposer">
            <span className="inline-flex items-center gap-1.5">
              <Avatar id={intent.proposer} name={name(intent.proposer)} />
              {name(intent.proposer)}
            </span>
          </Property>
          <Property label="Approvals">
            <span className="inline-flex items-center gap-3">
              {config.approvers
                .filter((a) => a.id !== intent.proposer)
                .map((a) => {
                  const ok = intent.approvals.some((x) => x.approver === a.id);
                  return (
                    <span key={a.id} className={`inline-flex items-center gap-1 ${ok ? "text-fg" : "text-fg-faint"}`}>
                      {ok ? <Check className="size-3.5 text-ok" /> : <Circle className="size-3 text-fg-faint" />}
                      {a.name}
                    </span>
                  );
                })}
              <span className="num text-fg-faint">
                {intent.approvals.length} of {config.threshold}
              </span>
            </span>
          </Property>
          <Property label="Amount">
            <span className="num">
              {fmtAmount(intent.amount)} {ledger.asset.name}
            </span>
          </Property>
          {intent.source && (
            <Property label="From">
              <Hash value={intent.source} />
            </Property>
          )}
          {intent.recipient && (
            <Property label="To">
              <Hash value={intent.recipient} />
            </Property>
          )}
          <Property label="Created">{fmtTime(intent.createdAt)}</Property>
          <Property label="Timelock">
            {!timelock.started ? (
              <span className="inline-flex items-center gap-1 text-fg-faint">
                <Lock className="size-3" /> Starts at {config.threshold} approvals
              </span>
            ) : timelock.elapsed ? (
              <span className="inline-flex items-center gap-1 text-ok">
                <Unlock className="size-3" /> Elapsed
              </span>
            ) : (
              <span className="num inline-flex items-center gap-1 text-warn">
                <Lock className="size-3" /> {timelock.remaining}s
              </span>
            )}
          </Property>
        </dl>

        {(intent.status === "pending_approval" || intent.status === "approved" || intent.status === "executing") && (
          <div className="flex items-center gap-2">
            {intent.status === "pending_approval" && (
              <button className="btn btn-primary" disabled={!canApprove} onClick={() => void approveIntent(intent.id)}>
                <Check className="size-3.5" /> Approve as {name(approver)}
              </button>
            )}
            {intent.status !== "pending_approval" && (
              <button className="btn btn-primary" disabled={!canExecute} onClick={() => void executeIntent(intent.id)}>
                <Play className="size-3.5" /> {busy ? "Executing" : intent.status === "executing" ? "Resume" : "Execute"}
              </button>
            )}
            {intent.status === "pending_approval" && !canApprove && (
              <span className="text-fg-faint">
                {approver === intent.proposer ? "Proposers cannot approve their own intent." : "Already approved. Switch approver in the sidebar."}
              </span>
            )}
          </div>
        )}
        {(intent.status === "pending_approval" || intent.status === "approved" || intent.status === "executing") && (
          <p className="-mt-3 rounded-md bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-fg-muted">
            {demoConfig.mode === "mock"
              ? "Simulated mode. Nothing is signed or sent."
              : intent.status === "pending_approval"
                ? `Demo shortcut: approving sends approve_intent to Solana devnet, signed with ${name(approver)}'s key held by this server. In production ${name(approver)} signs it in their own Solana wallet.`
                : "Execute sends execute_leg from the executor key on this server. In production that is the issuer's relayer. It pays fees but holds no authority: the program and the dWallet decide what gets signed."}
          </p>
        )}

        {(intent.execution || intent.status !== "pending_approval") && (
          <section>
            <h2 className="mb-2 text-[13px] font-medium text-fg-muted">Execution</h2>
            <ExecutionStepper intent={intent} />
          </section>
        )}

        <IntentActivity intent={intent} />

        <section className="space-y-2">
          <h2 className="text-[13px] font-medium text-fg-muted">Policy</h2>
          {intent.policyResults.length ? (
            <PolicyCheckPanel results={intent.policyResults} title="At creation" />
          ) : (
            <div className="flex h-8 items-center justify-between rounded-md border border-border px-3 text-[12px]">
              <span className="font-medium">At creation</span>
              <span className="text-fg-faint">Passed on-chain at create_intent</span>
            </div>
          )}
          <PolicyCheckPanel results={execRules} title="At execution" />
          {intent.error && <div className="rounded-md bg-bad-soft px-3 py-2 text-bad">{intent.error}</div>}
        </section>
      </div>
    </aside>
  );
}
