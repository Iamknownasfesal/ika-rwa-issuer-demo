"use client";

import { Plus } from "lucide-react";
import { IntentList } from "@/components/IntentList";
import { PageHeader } from "@/components/AppShell";
import { ChainLogo } from "@/components/ChainLogo";
import { CHAIN_COLOR, SupplyBar } from "@/components/SupplyBar";
import { Hash, Section } from "@/components/ui";
import { CHAINS, CHAIN_ORDER, UNAVAILABLE_CHAINS } from "@/lib/chains";
import { fmtAmount, pct } from "@/lib/format";
import { useLedgerStore } from "@/store/useLedgerStore";

export default function LedgerPage() {
  const { ledger, setModalOpen, error } = useLedgerStore();
  return (
    <>
      <PageHeader title="Ledger" sub={ledger ? `${ledger.asset.name} · Tokenized US Treasury fund` : undefined}>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
          <Plus className="size-3.5" /> New intent
        </button>
      </PageHeader>
      {!ledger ? (
        <div className="p-6 text-fg-muted">{error ? `Could not load the ledger. ${error}` : "Loading"}</div>
      ) : (
        <div className="mx-auto max-w-5xl space-y-8 px-4 py-5 md:px-6 md:py-6">
          <SupplyBar asset={ledger.asset} />

          <Section title="Chains">
            {/* Phones: one card per chain. */}
            <ul className="divide-y divide-border rounded-lg border border-border md:hidden">
              {CHAIN_ORDER.flatMap((k) => ledger.asset.chains.filter((c) => c.chain === k)).map((c) => (
                <li key={c.chain} className="space-y-1.5 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ChainLogo chain={c.chain} size={16} />
                    <span className="font-medium">{c.name}</span>
                    <span className="text-fg-muted">{c.testnet}</span>
                    <span className="num ml-auto">
                      {fmtAmount(c.authorized, { compact: true })} <span className="text-fg-faint">/ {fmtAmount(c.cap, { compact: true })}</span>
                    </span>
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-[12px] text-fg-faint">{c.authorityKind === "pda" ? "Program PDA" : "Ika dWallet"}</span>
                    <Hash value={c.authority} href={CHAINS[c.chain].explorerAddress(c.authority)} />
                    <span className="ml-auto h-1 w-16 shrink-0 overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full rounded-full" style={{ width: `${pct(c.authorized, c.cap)}%`, background: CHAIN_COLOR[c.chain] }} />
                    </span>
                  </div>
                </li>
              ))}
              {UNAVAILABLE_CHAINS.map((u) => (
                <li key={u.key} className="flex items-center gap-2 px-4 py-3 text-fg-faint">
                  <span className="opacity-60">
                    <ChainLogo chain={u.key} size={16} />
                  </span>
                  <span className="font-medium">{u.name}</span>
                  <span>{u.network}</span>
                  <span className="ml-auto text-[12px]">Unavailable</span>
                </li>
              ))}
            </ul>
            <div className="overflow-x-auto rounded-lg border border-border max-md:hidden">
              <div className="grid min-w-[720px] grid-cols-[170px_110px_1fr_220px] items-center gap-4 border-b border-border bg-surface-2 px-4 py-2 text-[12px] text-fg-faint">
                <span>Chain</span>
                <span>Network</span>
                <span>Mint authority</span>
                <span className="text-right">Authorized of cap</span>
              </div>
              {CHAIN_ORDER.flatMap((k) => ledger.asset.chains.filter((c) => c.chain === k)).map((c) => (
                <div key={c.chain} className="grid min-w-[720px] grid-cols-[170px_110px_1fr_220px] items-center gap-4 border-b border-border px-4 py-2.5 last:border-b-0">
                  <span className="flex items-center gap-2 font-medium">
                    <ChainLogo chain={c.chain} size={16} />
                    {c.name}
                  </span>
                  <span className="text-fg-muted">{c.testnet}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-[12px] text-fg-faint">{c.authorityKind === "pda" ? "Program PDA" : "Ika dWallet"}</span>
                    <Hash value={c.authority} href={CHAINS[c.chain].explorerAddress(c.authority)} />
                  </span>
                  <span className="flex items-center justify-end gap-3">
                    <span className="h-1 w-16 overflow-hidden rounded-full bg-surface-2">
                      <span className="block h-full rounded-full" style={{ width: `${pct(c.authorized, c.cap)}%`, background: CHAIN_COLOR[c.chain] }} />
                    </span>
                    <span className="num w-32 text-right">
                      {fmtAmount(c.authorized)} <span className="text-fg-faint">/ {fmtAmount(c.cap, { compact: true })}</span>
                    </span>
                  </span>
                </div>
              ))}
              {UNAVAILABLE_CHAINS.map((u) => (
                <div key={u.key} className="grid min-w-[720px] grid-cols-[170px_110px_1fr_220px] items-center gap-4 px-4 py-2.5 text-fg-faint">
                  <span className="flex items-center gap-2 font-medium">
                    <span className="opacity-60">
                      <ChainLogo chain={u.key} size={16} />
                    </span>
                    {u.name}
                  </span>
                  <span>{u.network}</span>
                  <span className="text-[12px]">Unavailable</span>
                  <span className="text-right text-[12px]">Unavailable</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Recent intents">
            <div className="overflow-hidden rounded-lg border border-border">
              <IntentList intents={ledger.intents.slice(0, 6)} grouped={false} />
            </div>
          </Section>
        </div>
      )}
    </>
  );
}
