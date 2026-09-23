"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { CHAINS, CHAIN_ORDER } from "@/lib/chains";
import { fmtAmount, parseAmount } from "@/lib/format";
import { allOk, evaluate } from "@/policy/policy";
import { buildSeed } from "@/seed";
import type { ChainKey, RuleResult } from "@/types";

const UNKNOWN = "unknown";

function SelectBox({ children }: { children: ReactNode }) {
  return (
    <span className="relative block">
      {children}
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2" strokeWidth={1.5} />
    </span>
  );
}

export function Simulator() {
  const ledger = useMemo(() => buildSeed(), []);
  const [chain, setChain] = useState<ChainKey>("base");
  const [amountText, setAmountText] = useState("2,500,000");
  const [to, setTo] = useState<"treasury" | typeof UNKNOWN>("treasury");
  const [result, setResult] = useState<RuleResult[] | null>(null);

  const c = ledger.asset.chains.find((x) => x.chain === chain)!;
  const check = () => {
    const recipient = to === "treasury" ? ledger.config.allowlist[chain][0].address : chain === "solana" ? "11111111111111111111111111111112" : chain === "sui" ? `0x${"ab".repeat(32)}` : `0x${"ab".repeat(20)}`;
    setResult(evaluate({ type: "mint", amount: parseAmount(amountText) ?? NaN, dstChain: chain, recipient, memo: "" }, ledger));
  };
  const ok = result ? allOk(result) : false;

  const label = "mb-2 block text-[13px]";
  const control = "h-12 w-full appearance-none border border-ink/70 bg-transparent px-3 font-plex text-[15px] outline-none focus:border-signal";

  return (
    <div className="grid border border-ink/80 md:grid-cols-2">
      <div className="p-8 md:p-10">
        <div className="flex justify-between border-b border-rule pb-6 font-plex text-[12px] uppercase tracking-[0.08em]">
          <span>The mint</span>
          <span className="text-stone">Local simulation</span>
        </div>
        <div className="mt-7 space-y-6" onChange={() => setResult(null)}>
          <label className="block">
            <span className={label}>Chain</span>
            <SelectBox>
              <select className={control} value={chain} onChange={(e) => setChain(e.target.value as ChainKey)}>
                {CHAIN_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {CHAINS[k].name}
                  </option>
                ))}
              </select>
            </SelectBox>
          </label>
          <div className="grid grid-cols-2 gap-5">
            <label className="block">
              <span className={label}>Amount · TBILL</span>
              <input className={control} value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" />
            </label>
            <label className="block">
              <span className={label}>Send to</span>
              <SelectBox>
                <select className={control} value={to} onChange={(e) => setTo(e.target.value as typeof to)}>
                  <option value="treasury">Treasury</option>
                  <option value={UNKNOWN}>Someone else</option>
                </select>
              </SelectBox>
            </label>
          </div>
          <p className="border-t border-rule pt-5 text-[13px] text-stone">
            {c.name} holds {fmtAmount(c.authorized)} of a {fmtAmount(c.cap)} cap. The asset is at {fmtAmount(ledger.asset.chains.reduce((s, x) => s + x.authorized, 0))} of{" "}
            {fmtAmount(ledger.asset.globalCap)}.
          </p>
          <button onClick={check} className="flex h-14 w-full items-center justify-between bg-ink px-6 text-[15px] text-paper hover:bg-signal">
            Check this mint <span aria-hidden>↗</span>
          </button>
        </div>
      </div>

      <div className="relative flex min-h-[520px] flex-col overflow-hidden bg-ink p-8 text-paper md:p-10">
        <div className="font-plex text-[12px] uppercase tracking-[0.08em]">The decision</div>
        {!result ? (
          <div className="mt-auto mb-auto">
            <span className="block text-[44px] leading-none text-signal">⟶</span>
            <p className="mt-10 text-[40px] leading-none tracking-[-0.04em]">Nothing checked yet.</p>
            <p className="mt-5 max-w-sm text-[16px] leading-relaxed text-paper/70">Choose a chain and an amount on the left. Try 40,000,000 on Ethereum to see a refusal.</p>
          </div>
        ) : (
          <div className="mt-10">
            <p className="text-[40px] leading-none tracking-[-0.04em]">
              {ok ? (
                <>
                  Cleared. <span className="font-serif italic">Ready for approvers.</span>
                </>
              ) : (
                <>
                  Refused. <span className="font-serif italic text-signal">Nothing to sign.</span>
                </>
              )}
            </p>
            <ul className="mt-8 divide-y divide-paper/15 border-y border-paper/15 font-plex text-[12px]">
              {result.map((r) => (
                <li key={r.rule} className="grid grid-cols-[18px_120px_1fr] gap-3 py-3">
                  <span className={r.ok ? "text-paper/60" : "text-signal"}>{r.ok ? "✓" : "✕"}</span>
                  <span className="uppercase tracking-[0.06em]">{r.label}</span>
                  <span className={r.ok ? "text-paper/60" : "text-paper"}>{r.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-auto pt-8 text-[12px] leading-relaxed text-paper/55">
          Runs the console&apos;s policy engine in your browser against the demo seed. The live program adds approvals, a timelock and a second check at execution.
        </p>
      </div>
    </div>
  );
}
