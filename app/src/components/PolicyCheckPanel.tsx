import { CircleCheck, CircleX } from "lucide-react";
import type { RuleResult } from "@/types";

export function PolicyCheckPanel({ results, title = "Policy checks" }: { results: RuleResult[]; title?: string }) {
  const failed = results.filter((r) => !r.ok).length;
  return (
    <section className="rounded-md border border-border">
      <header className="flex h-8 items-center justify-between border-b border-border px-3">
        <span className="text-[12px] font-medium">{title}</span>
        <span className={`text-[12px] ${failed ? "text-bad" : "text-fg-faint"}`}>{failed ? `${failed} of ${results.length} failing` : "All passing"}</span>
      </header>
      <ul>
        {results.map((r) => (
          <li key={r.rule} className="flex flex-wrap items-start gap-x-2 gap-y-0.5 border-b border-border px-3 py-2 last:border-b-0 sm:flex-nowrap">
            {r.ok ? <CircleCheck className="mt-px size-3.5 shrink-0 text-ok" /> : <CircleX className="mt-px size-3.5 shrink-0 text-bad" />}
            <span className="flex-1 font-medium sm:w-36 sm:flex-none sm:shrink-0">{r.label}</span>
            <span className={`num min-w-0 basis-full break-words pl-[22px] text-[12px] sm:basis-auto sm:pl-0 ${r.ok ? "text-fg-muted" : "text-bad"}`}>{r.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
