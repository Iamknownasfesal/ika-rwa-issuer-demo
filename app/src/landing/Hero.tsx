"use client";

import Link from "next/link";
import { demoConfig } from "@/demoConfig";
import { useState } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { LineField } from "./LineField";

const NAV = [
  { href: "#idea", label: "The idea" },
  { href: "#thread", label: "How it works" },
  { href: "#try", label: "Try it" },
];

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline font-display font-medium tracking-[-0.06em] ${className}`}>
      ledger
      <span className="ml-[0.04em] inline-block size-[0.16em] bg-signal" aria-hidden />
    </span>
  );
}

export function Hero() {
  const [motion, setMotion] = useState(true);
  return (
    <section className="relative min-h-[100svh] overflow-hidden">
      <LineField running={motion} tone="paper" ax={0.7} ay={0.36} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_18%_62%,rgba(15,15,14,0.94),rgba(15,15,14,0)_58%)]" />

      <div className="relative mx-auto flex min-h-[100svh] max-w-[1440px] flex-col px-6 md:px-14">
        <header className="flex items-center justify-between border-b border-rule py-7">
          <Link href="/" aria-label="Ledger home" className="flex items-center gap-3">
            <LogoMark size={30} dot={false} />
            <Wordmark className="text-[34px]" />
          </Link>
          <nav className="flex items-center gap-7 text-[15px]">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="hidden underline-offset-[10px] hover:underline sm:inline">
                {n.label}
              </a>
            ))}
            <a href={demoConfig.repoUrl} className="hidden underline-offset-[10px] hover:underline sm:inline">
              GitHub
            </a>
            <Link href="/console" className="border-b border-ink pb-0.5">
              Console
            </Link>
          </nav>
        </header>

        <div className="mt-6 flex items-start justify-between font-plex text-[12px] uppercase tracking-[0.08em]">
          <div className="rise">
            <span className="mr-3 inline-block size-1.5 -translate-y-px rounded-full bg-signal" />
            TBILL<span className="max-sm:hidden"> · a tokenized treasury fund</span>
            <span className="sm:hidden"> · tokenized treasury</span>
          </div>
          <button onClick={() => setMotion((m) => !m)} className="flex items-center gap-2 uppercase tracking-[0.08em]" aria-pressed={motion}>
            <span className="text-signal">{motion ? "II" : "▶"}</span> {motion ? "Pause" : "Play"}
          </button>
        </div>

        <div className="mt-auto pb-10 pt-24">
          <h1
            className="rise font-display text-[clamp(72px,12.6vw,196px)] font-medium leading-[0.86] tracking-[-0.065em]"
            style={{ animationDelay: "200ms" }}
          >
            Mint anywhere
            <span className="ml-[0.03em] inline-block size-[0.14em] bg-signal align-baseline" aria-hidden />
          </h1>
          <div className="mt-8 grid items-end gap-8 md:grid-cols-[1fr_auto]">
            <p className="rise text-[clamp(38px,5vw,68px)] leading-none tracking-[-0.04em]" style={{ animationDelay: "320ms" }}>
              On <span className="font-serif italic tracking-[-0.02em]">one ledger.</span>
            </p>
            <p className="rise max-w-[340px] text-[17px] leading-snug" style={{ animationDelay: "420ms" }}>
              Issued on Solana, Ethereum, Base, Sui and Tempo. A Solana program approves every mint and burn, and Ika dWallets sign only what it approves.
            </p>
          </div>

          <div className="mt-10 flex justify-end sm:mt-14">
            <Link href="/console" className="flex w-full items-center justify-between border-b border-ink pb-2 font-plex text-[12px] hover:text-signal sm:w-60">
              Open the console <span aria-hidden>↗</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
