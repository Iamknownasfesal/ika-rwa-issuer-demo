"use client";

import { ArrowRight } from "lucide-react";
import type { Intent, IntentStatus } from "@/types";
import { demoConfig } from "@/demoConfig";
import { CHAINS } from "@/lib/chains";
import { fmtAmount } from "@/lib/format";
import { useLedgerStore } from "@/store/useLedgerStore";
import { ChainLogo } from "./ChainLogo";
import { Avatar, StatusIcon, statusLabel } from "./ui";

const ORDER: IntentStatus[] = ["executing", "approved", "pending_approval", "executed", "rejected"];
const VERB = { mint: "Mint", burn: "Burn", move: "Move" } as const;

export function intentTitle(i: Intent, symbol = "TBILL") {
  return `${VERB[i.type]} ${fmtAmount(i.amount)} ${symbol}`;
}

export function IntentChains({ intent }: { intent: Intent }) {
  return (
    <span className="inline-flex items-center gap-1 text-fg-muted">
      {intent.legs.map((l, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <ArrowRight className="size-3 text-fg-faint" />}
          <ChainLogo chain={l.chain} size={14} />
          <span>{CHAINS[l.chain].name}</span>
        </span>
      ))}
    </span>
  );
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function IntentRow({ intent }: { intent: Intent }) {
  const { openIntent, selectedIntentId, ledger } = useLedgerStore();
  const threshold = ledger?.config.threshold ?? demoConfig.threshold;
  const proposer = demoConfig.approvers.find((a) => a.id === intent.proposer);
  const active = selectedIntentId === intent.id;
  return (
    <button
      onClick={() => openIntent(intent.id)}
      className={`grid h-10 w-full grid-cols-[16px_76px_1fr_auto] items-center gap-3 border-b border-border px-4 text-left last:border-b-0 hover:bg-hover ${active ? "bg-hover" : ""}`}
    >
      <StatusIcon status={intent.status} />
      <span className="mono text-[12px] text-fg-faint">{intent.id}</span>
      <span className="flex min-w-0 items-center gap-3">
        <span className="truncate font-medium">{intentTitle(intent, ledger?.asset.name)}</span>
        <span className="hidden sm:inline-flex">
          <IntentChains intent={intent} />
        </span>
      </span>
      <span className="flex items-center gap-4 text-fg-faint">
        <span className="num hidden text-[12px] md:inline">
          {intent.approvals.length}/{threshold}
        </span>
        {proposer && <Avatar id={proposer.id} name={proposer.name} />}
        <span className="w-12 text-right text-[12px]">{shortDate(intent.createdAt)}</span>
      </span>
    </button>
  );
}

export function IntentList({ intents, grouped = true }: { intents: Intent[]; grouped?: boolean }) {
  if (intents.length === 0) {
    return <div className="px-4 py-10 text-center text-fg-faint">No intents yet. Press C to create one.</div>;
  }
  if (!grouped) return <div>{intents.map((i) => <IntentRow key={i.id} intent={i} />)}</div>;
  return (
    <div>
      {ORDER.map((status) => {
        const rows = intents.filter((i) => i.status === status);
        if (!rows.length) return null;
        return (
          <section key={status}>
            <header className="sticky top-11 z-[5] flex h-9 items-center gap-2 border-b border-border bg-surface-2 px-4">
              <StatusIcon status={status} />
              <span className="font-medium">{statusLabel(status)}</span>
              <span className="text-fg-faint">{rows.length}</span>
            </header>
            {rows.map((i) => (
              <IntentRow key={i.id} intent={i} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
