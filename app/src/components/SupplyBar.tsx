import type { Asset } from "@/types";
import { CHAIN_ORDER } from "@/lib/chains";
import { fmtAmount, pct } from "@/lib/format";
import { authorizedTotal } from "@/policy/policy";

export const CHAIN_COLOR: Record<string, string> = {
  solana: "#1fbf8f",
  ethereum: "#6272e8",
  base: "#1f5eff",
  sui: "#56a6f5",
  tempo: "#e0a526",
};

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[12px] text-fg-muted">{label}</div>
      <div className="num mt-0.5 text-[17px] font-semibold tracking-tight sm:text-[20px]">{value}</div>
      {sub && <div className="text-[12px] text-fg-faint">{sub}</div>}
    </div>
  );
}

export function SupplyBar({ asset }: { asset: Asset }) {
  const total = authorizedTotal(asset);
  return (
    <section className="rounded-lg border border-border p-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Figure label="Authorized" value={fmtAmount(total)} sub={`${pct(total, asset.globalCap).toFixed(1)}% of cap`} />
        <Figure label="Headroom" value={fmtAmount(asset.globalCap - total)} />
        <Figure label="Global cap" value={fmtAmount(asset.globalCap)} />
      </div>
      <div className="mt-4 flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-surface-2" role="img" aria-label="Authorized supply by chain">
        {CHAIN_ORDER.map((k) => {
          const c = asset.chains.find((x) => x.chain === k);
          if (!c) return null;
          return <div key={k} className="h-full transition-[width] duration-500" style={{ width: `${pct(c.authorized, asset.globalCap)}%`, background: CHAIN_COLOR[k] }} />;
        })}
      </div>
    </section>
  );
}
