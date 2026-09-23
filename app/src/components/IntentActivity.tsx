"use client";

import { useEffect, useState } from "react";
import { demoConfig } from "@/demoConfig";
import { CHAINS } from "@/lib/chains";
import { fmtTime } from "@/lib/format";
import type { ActivityEntry, Intent } from "@/types";
import { Avatar, Hash } from "./ui";

const TEXT: Record<ActivityEntry["kind"], (e: ActivityEntry, legs: number) => string> = {
  create: () => "created the intent with create_intent",
  approve: () => "approved with approve_intent",
  execute: (e, n) => `ran execute_leg${n > 1 ? ` for leg ${(e.leg ?? 0) + 1}` : ""}. The program checked the rules and asked Ika to sign`,
  "ika-sign": (e, n) => `committed the dWallet signature on Solana${n > 1 ? ` for leg ${(e.leg ?? 0) + 1}` : ""}`,
  confirm: (e, n) => `recorded the destination transaction with confirm_leg${n > 1 ? ` for leg ${(e.leg ?? 0) + 1}` : ""}`,
};

/** Mock mode has no chain; derive the same timeline from local state, without signatures. */
function simulated(intent: Intent): ActivityEntry[] {
  const name = (id: string) => demoConfig.approvers.find((a) => a.id === id)?.name ?? id;
  const out: ActivityEntry[] = [{ kind: "create", signer: intent.proposer, signerName: name(intent.proposer), at: intent.createdAt }];
  for (const a of intent.approvals) out.push({ kind: "approve", signer: a.approver, signerName: name(a.approver), at: a.at });
  intent.execution?.legs.forEach((l, leg) => {
    if (l.status === "pending") return;
    out.push({ kind: "execute", signer: "executor", signerName: "Executor", leg });
    if (intent.legs[leg].chain !== "solana" && l.status !== "policy") out.push({ kind: "ika-sign", signer: "ika", signerName: "Ika network", leg });
    if (l.status === "confirmed" && intent.legs[leg].chain !== "solana") out.push({ kind: "confirm", signer: "executor", signerName: "Executor", leg });
  });
  return out;
}

export function IntentActivity({ intent }: { intent: Intent }) {
  const devnet = demoConfig.mode === "devnet";
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${intent.id}:${intent.status}:${intent.approvals.length}:${intent.execution?.legs.map((l) => l.status).join(",")}`;

  useEffect(() => {
    if (!devnet) return;
    let live = true;
    fetch(`/api/intents/${intent.id}/activity`)
      .then((r) => r.json())
      .then((j: ActivityEntry[] | { error: string }) => {
        if (!live) return;
        if (Array.isArray(j)) {
          setEntries(j);
          setError(null);
        } else setError(j.error);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [devnet, key, intent.id, attempt]);

  const list = devnet ? entries : simulated(intent);

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[13px] font-medium text-fg-muted">On Solana</h2>
        <span className="text-[12px] text-fg-faint">{devnet ? "Read from devnet" : "Simulated"}</span>
      </div>
      {!list ? (
        error ? (
          <div className="flex items-center gap-2 text-fg-muted">
            <span className="text-bad">Could not read devnet.</span>
            <button className="text-accent hover:underline" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </button>
          </div>
        ) : (
          <div className="text-fg-faint">Reading transactions from devnet</div>
        )
      ) : (
        <ol className="space-y-2.5">
          {list.map((e, i) => {
            const isPerson = demoConfig.approvers.some((a) => a.name === e.signerName);
            const id = demoConfig.approvers.find((a) => a.name === e.signerName)?.id ?? "x";
            return (
              <li key={e.signature ?? i} className="flex items-start gap-2.5">
                {isPerson ? (
                  <Avatar id={id} name={e.signerName} size={16} />
                ) : (
                  <span className="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-surface-2 text-[9px] font-semibold text-fg-muted">
                    {e.signerName === "Ika network" ? "I" : "E"}
                  </span>
                )}
                <div className="min-w-0 flex-1 leading-snug">
                  <span className="font-medium">{e.signerName}</span> <span className="text-fg-muted">{TEXT[e.kind](e, intent.legs.length)}</span>
                  <div className="mt-0.5 flex items-center gap-2 text-[12px] text-fg-faint">
                    {e.signature ? <Hash value={e.signature} href={CHAINS.solana.explorerTx(e.signature)} /> : <span>No transaction in simulated mode</span>}
                    {e.at && <span>{fmtTime(e.at)}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
