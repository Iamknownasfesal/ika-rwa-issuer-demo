import { Check, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Intent, LegExecution } from "@/types";
import { CHAINS } from "@/lib/chains";
import { fmtAmount } from "@/lib/format";
import { useLedgerStore } from "@/store/useLedgerStore";
import { ChainLogo } from "./ChainLogo";
import { Hash } from "./ui";

type StepState = "todo" | "active" | "done";

function stepStates(ex: LegExecution | undefined): [StepState, StepState, StepState] {
  const s = ex?.status ?? "pending";
  if (s === "pending") return ["todo", "todo", "todo"];
  if (s === "policy") return ["active", "todo", "todo"];
  if (s === "signing") return ["done", "active", "todo"];
  if (s === "broadcast") return ["done", "done", "active"];
  return ["done", "done", "done"];
}

function Step({ state, title, last, children }: { state: StepState; title: string; last?: boolean; children?: ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-3">
      {!last && <span className="absolute left-[7px] top-4 bottom-0 w-px bg-border" />}
      <span
        className={`relative mt-0.5 grid size-[15px] shrink-0 place-items-center rounded-full ${
          state === "done" ? "bg-accent text-accent-fg" : state === "active" ? "text-accent" : "border border-border-strong"
        }`}
      >
        {state === "done" ? <Check className="size-2.5" strokeWidth={3} /> : state === "active" ? <Loader2 className="size-3.5 animate-spin" /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className={state === "todo" ? "text-fg-faint" : "text-fg"}>{title}</div>
        {state !== "todo" && children && <div className="mt-0.5 space-y-0.5 text-[12px] text-fg-muted">{children}</div>}
      </div>
    </li>
  );
}

export function ExecutionStepper({ intent }: { intent: Intent }) {
  const meta = useLedgerStore((s) => s.ledger?.meta);
  const devnet = meta?.mode === "devnet";
  return (
    <div className="space-y-3">
      {intent.legs.map((leg, i) => {
        const ex = intent.execution?.legs[i];
        const [s1, s2, s3] = stepStates(ex);
        const cm = CHAINS[leg.chain];
        const isSolana = leg.chain === "solana";
        return (
          <div key={i} className="rounded-md border border-border px-3 pt-2.5">
            <div className="mb-2.5 flex items-center gap-2">
              <ChainLogo chain={leg.chain} size={14} />
              <span className="font-medium">
                {leg.action === "mint" ? "Mint" : "Burn"} {fmtAmount(leg.amount)} on {cm.name}
              </span>
              {i > 0 && <span className="text-[12px] text-fg-faint">after leg {i} confirms</span>}
            </div>
            <ol>
              <Step state={s1} title="Approved by the Solana ledger">
                {ex?.policyTxHash && (
                  <div>
                    execute_leg <Hash value={ex.policyTxHash} href={devnet ? CHAINS.solana.explorerTx(ex.policyTxHash) : undefined} />
                  </div>
                )}
              </Step>
              <Step state={s2} title={isSolana ? "Token-2022 by the program PDA" : "Signed by the Ika dWallet"}>
                {isSolana ? (
                  <div>No external signer.</div>
                ) : (
                  <>
                    <div>
                      MessageApproval{" "}
                      <Hash value={ex?.messageApproval} href={ex?.messageApproval && devnet ? CHAINS.solana.explorerAddress(ex.messageApproval) : undefined} />
                    </div>
                    <div>
                      {ex?.dwalletId} · {ex?.curve}
                    </div>
                  </>
                )}
              </Step>
              <Step state={s3} title={`Confirmed on ${cm.name}`} last>
                {ex?.destTxHash ? (
                  <div>
                    tx <Hash value={ex.destTxHash} href={!isSolana || devnet ? cm.explorerTx(ex.destTxHash) : undefined} />
                    {ex.block ? <span className="num text-fg-faint"> · block {ex.block.toLocaleString()}</span> : null}
                  </div>
                ) : s3 === "active" ? (
                  <div className="text-fg-faint">Submitting to {cm.name}</div>
                ) : null}
                {ex?.error && <div className="text-bad">{ex.error}</div>}
              </Step>
            </ol>
          </div>
        );
      })}
    </div>
  );
}
