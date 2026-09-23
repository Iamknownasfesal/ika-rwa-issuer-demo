"use client";

import Link from "next/link";
import { LineField } from "./LineField";

export function LightBand() {
  return (
    <section className="relative overflow-hidden bg-ink text-paper">
      <div className="absolute inset-y-0 right-0 w-full md:w-[70%]">
        <LineField tone="ink" ax={0.62} ay={0.5} interactive={false} />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,#f1f0ea_28%,rgba(241,240,234,0)_70%)]" />
      <div className="relative mx-auto max-w-[1440px] px-6 py-32 md:px-14 md:py-40">
        <div className="font-plex text-[12px] uppercase tracking-[0.08em] text-paper/60">Live</div>
        <h2 className="mt-14 max-w-[900px] font-display text-[clamp(48px,7vw,104px)] font-medium leading-[0.95] tracking-[-0.06em]">
          Every mint in the console is a real transaction.
        </h2>
        <p className="mt-8 max-w-[480px] text-[17px] leading-relaxed text-paper/70">
          Five chains, one ledger on Solana, every signature from Ika. Open the console and move supply yourself.
        </p>
        <Link href="/console" className="mt-12 flex w-60 items-center justify-between border-b border-paper/60 pb-2 text-[15px] hover:text-signal">
          Open the console <span aria-hidden>↗</span>
        </Link>
      </div>
    </section>
  );
}
