import Link from "next/link";
import { demoConfig } from "@/demoConfig";
import type { ReactNode } from "react";
import { LightBand } from "@/landing/LightBand";
import { Hero, Wordmark } from "@/landing/Hero";
import { Reveal } from "@/landing/Reveal";
import { Simulator } from "@/landing/Simulator";

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="font-plex text-[12px] uppercase tracking-[0.08em] text-signal">{children}</div>;
}

function Headline({ children, size = "md" }: { children: ReactNode; size?: "lg" | "md" }) {
  const cls = size === "lg" ? "text-[clamp(44px,6.4vw,92px)]" : "text-[clamp(36px,4.6vw,64px)]";
  return <h2 className={`max-w-[1000px] font-display font-medium leading-[0.95] tracking-[-0.055em] ${cls}`}>{children}</h2>;
}

const STEPS = [
  {
    n: "01",
    title: "Propose",
    body: "An operator drafts a mint, burn or move. The program checks the caps, the supply and the allowlist before anyone is asked to approve.",
  },
  {
    n: "02",
    title: "Approve",
    body: "Two of three approvers sign on Solana. A proposer cannot approve their own intent. A timelock starts at the second signature.",
  },
  {
    n: "03",
    title: "Sign",
    body: "The program computes the exact message and asks Ika to sign it. The dWallet answers to the program and to nothing else.",
  },
  {
    n: "04",
    title: "Deliver",
    body: "Any relayer can carry the signature to the destination chain. The contract there checks it, mints, and the ledger records the receipt.",
  },
];

const CHAINS_LIST = [
  { name: "Solana", how: "The ledger program itself holds the mint authority." },
  { name: "Ethereum", how: "MintController verifies an EIP-712 authorization from the secp256k1 dWallet." },
  { name: "Base", how: "Same controller, same dWallet, its own domain separator." },
  { name: "Sui", how: "A Move package verifies an Ed25519 signature over the raw authorization." },
  { name: "Tempo", how: "MintController on Tempo. The relayer pays fees in stablecoin." },
  { name: "Canton", how: "Unavailable.", unavailable: true },
];

const FAQ = [
  {
    q: "Who holds the keys?",
    a: "Nobody holds a whole one. Each dWallet key is split between the issuer's encrypted share and the Ika network, and the network's half only signs what the Solana program approves.",
  },
  {
    q: "What stops a stolen operator key?",
    a: "Policy. The program refuses mints over the cap, to addresses off the allowlist, without two approvals, or before the timelock ends. A refused intent never produces anything to sign.",
  },
  {
    q: "What exactly gets signed?",
    a: "A short authorization: action, amount, account, nonce and the ledger address. EIP-712 on EVM chains, a fixed 161 byte message on Sui. The program computes it, so nobody can swap the payload on the way.",
  },
  {
    q: "Why doesn't the console ask for a wallet?",
    a: "To keep the demo to one screen. The server holds demo keys for Alice, Bob, Carol and the executor, and signs real devnet transactions with whichever one you pick. In production each approver signs create_intent and approve_intent from their own Solana wallet, and every transaction still shows up in the intent's history.",
  },
  {
    q: "Is this production MPC?",
    a: "Not yet. The Ika Solana pre-alpha signs with a single mock signer and wipes its state from time to time. The control flow is the real one.",
  },
  {
    q: "Where does it run today?",
    a: "Solana devnet, Ethereum Sepolia, Base Sepolia, Sui testnet and Tempo Moderato. Every mint and burn in the console lands on those networks.",
  },
];

export default function Home() {
  return (
    <div className="site">
      <Hero />

      <main className="mx-auto max-w-[1440px] px-6 md:px-14">
        <section id="idea" className="border-b border-rule py-32 md:py-44">
          <Reveal>
            <Eyebrow>The idea</Eyebrow>
          </Reveal>
          <Reveal delay={80} className="mt-16">
            <Headline size="lg">The issuer never holds a whole key on any chain.</Headline>
          </Reveal>
          <div className="mt-20 grid gap-12 md:grid-cols-[1fr_1.2fr_1fr]">
            <div />
            <Reveal delay={120}>
              <p className="text-[clamp(20px,1.7vw,24px)] leading-[1.6]">
                On each chain, the right to mint belongs to an Ika dWallet. Its key is split between the issuer and the Ika network, and the network&apos;s half signs only
                what one Solana program approves. The program approves only what fits the issuer&apos;s caps, allowlist, approvals and timelock.
              </p>
            </Reveal>
            <Reveal delay={200} className="self-end">
              <div className="border-l border-rule pl-6 text-[14px] leading-relaxed text-stone">
                <Link href="/console/setup" className="block text-ink hover:text-signal">
                  See the setup ↗
                </Link>
                <a href={demoConfig.repoUrl} className="mt-3 block text-ink hover:text-signal">
                  Read the source ↗
                </a>
              </div>
            </Reveal>
          </div>
        </section>

        <section id="thread" className="border-b border-rule py-32 md:py-40">
          <div className="grid gap-10 md:grid-cols-[1fr_auto] md:items-end">
            <Reveal>
              <Eyebrow>How it works</Eyebrow>
              <div className="mt-8">
                <Headline>From request to mint.</Headline>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <p className="max-w-[330px] text-[17px] leading-snug">Mints, burns and cross-chain moves all take this path.</p>
            </Reveal>
          </div>
          <ol className="mt-20 grid gap-10 md:grid-cols-4 md:gap-8">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 90}>
                <li className="border-t border-ink pt-6">
                  <div className="font-plex text-[12px] text-signal">{s.n}</div>
                  <div className="mt-8 text-[28px] font-medium tracking-[-0.04em]">{s.title}</div>
                  <p className="mt-4 text-[15px] leading-relaxed text-stone">{s.body}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </section>

        <section id="try" className="border-b border-rule py-32 md:py-40">
          <div className="grid gap-10 md:grid-cols-[1fr_auto] md:items-end">
            <Reveal>
              <Eyebrow>Try the policy</Eyebrow>
              <div className="mt-8">
                <Headline>Check a mint against the rules.</Headline>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <p className="max-w-[360px] text-[17px] leading-snug">The same checks the program runs, shown one rule at a time.</p>
            </Reveal>
          </div>
          <Reveal delay={160} className="mt-16">
            <Simulator />
          </Reveal>
        </section>

        <section className="border-b border-rule py-32 md:py-40">
          <Reveal>
            <Eyebrow>Where it runs</Eyebrow>
            <div className="mt-8">
              <Headline>How each chain checks the signature.</Headline>
            </div>
          </Reveal>
          <ul className="mt-16 border-t border-rule">
            {CHAINS_LIST.map((c, i) => (
              <Reveal key={c.name} delay={i * 60}>
                <li className={`grid items-baseline gap-2 border-b border-rule py-7 md:grid-cols-[80px_1fr_1.4fr] md:gap-8 ${"unavailable" in c ? "opacity-45" : ""}`}>
                  <span className="font-plex text-[12px] text-signal">0{i + 1}</span>
                  <span className="text-[clamp(28px,3vw,40px)] font-medium tracking-[-0.045em]">{c.name}</span>
                  <span className="text-[15px] leading-relaxed text-stone">{c.how}</span>
                </li>
              </Reveal>
            ))}
          </ul>
        </section>

        <section className="grid gap-14 py-32 md:grid-cols-[1fr_1.4fr] md:py-40">
          <Reveal>
            <Eyebrow>Questions</Eyebrow>
            <div className="mt-8">
              <Headline>What people ask first.</Headline>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="border-t border-rule">
              {FAQ.map((f) => (
                <details key={f.q} className="group border-b border-rule">
                  <summary className="flex cursor-pointer list-none items-center justify-between py-6 text-[17px] [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span className="text-[22px] font-light text-signal transition-transform duration-300 group-open:rotate-45">+</span>
                  </summary>
                  <p className="max-w-[560px] pb-7 text-[15px] leading-relaxed text-stone">{f.a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </section>
      </main>

      <LightBand />

      <footer className="mx-auto max-w-[1440px] px-6 md:px-14">
        <div className="pt-24" />
        <Wordmark className="block pb-[0.22em] text-[clamp(120px,24vw,360px)] leading-[0.8]" />
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-rule py-7 font-plex text-[12px]">
          <span>TBILL issuer ledger</span>
          <span className="flex gap-6">
            <Link href="/console" className="hover:text-signal">
              Console
            </Link>
            <Link href="/console/intents" className="hover:text-signal">
              Intents
            </Link>
            <Link href="/console/setup" className="hover:text-signal">
              Setup
            </Link>
            <a href={demoConfig.repoUrl} className="hover:text-signal">
              GitHub
            </a>
          </span>
          <span className="text-stone">Ika Solana pre-alpha. Not production MPC.</span>
        </div>
      </footer>
    </div>
  );
}
