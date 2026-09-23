"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { demoConfig } from "@/demoConfig";
import { CHAINS, CHAIN_ORDER, UNAVAILABLE_CHAINS } from "@/lib/chains";
import { parseAmount, short } from "@/lib/format";
import { allOk, evaluate } from "@/policy/policy";
import { useLedgerStore } from "@/store/useLedgerStore";
import { IntentRejectedError } from "@/executor";
import type { ChainKey, IntentDraft, IntentType, RuleResult } from "@/types";
import { ChainLogo } from "./ChainLogo";
import { PolicyCheckPanel } from "./PolicyCheckPanel";
import { Avatar } from "./ui";

const TYPES: { id: IntentType; label: string }[] = [
  { id: "mint", label: "Mint" },
  { id: "burn", label: "Burn" },
  { id: "move", label: "Move" },
];

export function NewIntentModal() {
  const modalOpen = useLedgerStore((s) => s.modalOpen);
  // Mounting only while open resets the form on every close.
  return modalOpen ? <NewIntentForm /> : null;
}

function Pill({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <label className="relative inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-[12px] hover:bg-hover">
      <span className="text-fg-faint">{label}</span>
      {icon}
      {children}
      <ChevronDown className="pointer-events-none size-3 text-fg-faint" />
    </label>
  );
}

function ChainPill({ label, value, onChange }: { label: string; value: ChainKey; onChange: (k: ChainKey) => void }) {
  return (
    <Pill label={label} icon={<ChainLogo chain={value} size={13} />}>
      <select className="appearance-none bg-transparent pr-1 font-medium outline-none" value={value} onChange={(e) => onChange(e.target.value as ChainKey)}>
        {CHAIN_ORDER.map((k) => (
          <option key={k} value={k}>
            {CHAINS[k].name}
          </option>
        ))}
        {UNAVAILABLE_CHAINS.map((u) => (
          <option key={u.key} value={u.key} disabled>
            {u.name} (unavailable)
          </option>
        ))}
      </select>
    </Pill>
  );
}

function NewIntentForm() {
  const { setModalOpen, ledger, createIntent, approver } = useLedgerStore();
  const [type, setType] = useState<IntentType>("mint");
  const [srcChain, setSrcChain] = useState<ChainKey>("ethereum");
  const [dstChain, setDstChainRaw] = useState<ChainKey>("base");
  const [amountText, setAmountText] = useState("2,500,000");
  const [recipientOverride, setRecipientOverride] = useState<string | null>(null);
  const [customRecipient, setCustomRecipient] = useState(false);
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverResults, setServerResults] = useState<RuleResult[] | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => amountRef.current?.select(), []);

  const allow = ledger?.config.allowlist;
  const dstList = useMemo(() => allow?.[dstChain] ?? [], [allow, dstChain]);
  const srcList = useMemo(() => allow?.[srcChain] ?? [], [allow, srcChain]);
  const recipient = recipientOverride ?? dstList[0]?.address ?? "";
  const setDstChain = (k: ChainKey) => {
    setDstChainRaw(k);
    setRecipientOverride(null);
  };

  const amount = parseAmount(amountText) ?? NaN;
  const draft: IntentDraft = useMemo(
    () => ({
      type,
      amount,
      srcChain: type === "mint" ? undefined : srcChain,
      dstChain: type === "burn" ? undefined : dstChain,
      recipient: type === "burn" ? undefined : recipient,
      source: type === "mint" ? undefined : srcList[0]?.address,
      memo,
    }),
    [type, amount, srcChain, dstChain, recipient, srcList, memo],
  );
  const results = useMemo(() => (ledger ? evaluate(draft, ledger) : []), [draft, ledger]);
  const ok = allOk(results) && Number.isFinite(amount);
  const devnet = demoConfig.mode === "devnet";
  const proposer = demoConfig.approvers.find((a) => a.id === approver)!;

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await createIntent(draft);
    } catch (e) {
      if (e instanceof IntentRejectedError) {
        setServerError(e.message);
        if (e.results.length) setServerResults(e.results);
      } else setServerError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!ledger) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/25 p-2 pt-[max(8px,env(safe-area-inset-top))] sm:p-4 sm:pt-[10vh]" onMouseDown={() => setModalOpen(false)}>
      <div
        role="dialog"
        aria-modal
        className="flex max-h-[calc(100dvh-16px)] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl sm:max-h-[80vh]"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ok) void submit();
        }}
      >
        <header className="flex h-11 shrink-0 items-center gap-1.5 px-4 text-[12px]">
          <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium">{ledger.asset.name}</span>
          <ChevronRight className="size-3 text-fg-faint" />
          <span className="text-fg-muted">New intent</span>
          <button className="ml-auto rounded p-1 text-fg-muted hover:bg-hover hover:text-fg" onClick={() => setModalOpen(false)} aria-label="Close">
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
          <div className="inline-flex rounded-md bg-surface-2 p-0.5">
            {TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => setType(t.id)}
                className={`h-6 rounded px-3 text-[12px] font-medium ${type === t.id ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-baseline gap-2">
            <input
              ref={amountRef}
              className="num w-full bg-transparent text-[26px] font-semibold tracking-tight outline-none placeholder:text-fg-faint"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              inputMode="decimal"
              placeholder="Amount"
              aria-label={`Amount in ${ledger.asset.name}`}
            />
            <span className="text-[15px] font-medium text-fg-faint">{ledger.asset.name}</span>
          </div>

          <textarea
            className="block w-full resize-none bg-transparent text-fg outline-none placeholder:text-fg-faint"
            rows={1}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Add a memo for the audit trail"
            maxLength={32}
          />

          <div className="flex flex-wrap items-center gap-1.5">
            {type !== "mint" && <ChainPill label={type === "move" ? "From" : "Chain"} value={srcChain} onChange={setSrcChain} />}
            {type !== "burn" && <ChainPill label={type === "move" ? "To" : "Chain"} value={dstChain} onChange={setDstChain} />}
            {type !== "burn" &&
              (customRecipient ? (
                <input
                  className="input mono h-7 w-full text-[12px] sm:w-72"
                  value={recipient}
                  onChange={(e) => setRecipientOverride(e.target.value)}
                  placeholder={CHAINS[dstChain].addressPlaceholder}
                  autoFocus
                />
              ) : (
                <Pill label="Recipient">
                  <select className="mono appearance-none bg-transparent pr-1 outline-none" value={recipient} onChange={(e) => setRecipientOverride(e.target.value)}>
                    {dstList.map((e) => (
                      <option key={e.address} value={e.address}>
                        {e.label} {short(e.address)}
                      </option>
                    ))}
                  </select>
                </Pill>
              ))}
            {type !== "burn" && (
              <button
                className="h-7 px-1.5 text-[12px] text-fg-muted hover:text-fg"
                onClick={() => {
                  setCustomRecipient((v) => !v);
                  setRecipientOverride(customRecipient ? null : "");
                }}
              >
                {customRecipient ? "Use allowlist" : "Other address"}
              </button>
            )}
            {type !== "mint" && (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-border px-2 text-[12px] text-fg-muted">
                From treasury <span className="mono">{short(srcList[0]?.address ?? "")}</span>
              </span>
            )}
          </div>

          <PolicyCheckPanel results={serverResults ?? results} />
          {serverError && <div className="rounded-md bg-bad-soft px-3 py-2 text-bad">{serverError}</div>}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-fg-muted">
            <Avatar id={proposer.id} name={proposer.name} size={16} />
            {devnet ? `Signed with ${proposer.name}'s demo key` : `${proposer.name} proposes`}
          </span>
          <span className="ml-auto hidden items-center gap-1 text-[12px] text-fg-faint sm:inline-flex">
            <span className="kbd">⌘</span>
            <span className="kbd">↵</span>
          </span>
          {devnet && !ok && (
            <button className="btn" disabled={submitting || !Number.isFinite(amount)} onClick={submit} title="The program will reject it on-chain">
              Submit anyway
            </button>
          )}
          <button className="btn btn-primary" disabled={!ok || submitting} onClick={submit}>
            {submitting ? "Creating" : "Create intent"}
          </button>
        </footer>
      </div>
    </div>
  );
}
