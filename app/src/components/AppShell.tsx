"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { ArrowUpRight, KeyRound, Layers, ListTodo, Menu, Moon, RotateCcw, Settings, SquarePen, Sun, X } from "lucide-react";
import { demoConfig } from "@/demoConfig";
import { CHAINS, CHAIN_ORDER, UNAVAILABLE_CHAINS } from "@/lib/chains";
import { fmtAmount } from "@/lib/format";
import { useLedgerStore } from "@/store/useLedgerStore";
import { ChainLogo } from "./ChainLogo";
import { IntentDrawer } from "./IntentDrawer";
import { NewIntentModal } from "./NewIntentModal";
import { Avatar } from "./ui";
import { LogoMark } from "./brand/Logo";

function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

const NAV = [
  { href: "/console", label: "Ledger", icon: Layers },
  { href: "/console/intents", label: "Intents", icon: ListTodo },
  { href: "/console/setup", label: "Setup", icon: Settings },
];

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { init, error, dismissError, setModalOpen, modalOpen, openIntent, notice, notify, navOpen, setNavOpen } = useLedgerStore();
  useEffect(() => {
    void init();
  }, [init]);
  const closeNotice = useCallback(() => notify(null), [notify]);

  // The console is dark unless the viewer switched it to light.
  useEffect(() => {
    try {
      const dark = localStorage.theme !== "light";
      document.documentElement.classList.toggle("dark", dark);
    } catch {}
    return () => document.documentElement.classList.remove("dark");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNavOpen(false);
        setModalOpen(false);
        openIntent(null);
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "c" && !modalOpen) {
        e.preventDefault();
        setModalOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, setModalOpen, openIntent, setNavOpen]);

  // Close the mobile sheet on navigation.
  useEffect(() => setNavOpen(false), [pathname, setNavOpen]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-[232px] shrink-0 flex-col px-2 pb-3 md:flex">
        <Sidebar />
      </aside>

      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-black/50" aria-label="Close navigation" onClick={() => setNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[272px] max-w-[85vw] flex-col border-r border-border bg-bg px-2 pb-[max(12px,env(safe-area-inset-bottom))] shadow-2xl">
            <Sidebar onNavigate={() => setNavOpen(false)} />
          </aside>
        </div>
      )}

      <main className="relative m-2 ml-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface max-md:ml-2">
        {error && (
          <div className="flex items-start gap-3 border-b border-bad/30 bg-bad-soft px-4 py-2 text-bad">
            <span className="flex-1">{error}</span>
            <button onClick={dismissError} aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <IntentDrawer />
      </main>

      <NewIntentModal />
      {notice && <Notice text={notice} onClose={closeNotice} />}
    </div>
  );
}

/** Brand, navigation, chains and the demo approver switch. Desktop aside and mobile sheet. */
function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { ledger, approver, setApprover, setModalOpen } = useLedgerStore();
  const open = ledger?.intents.filter((i) => i.status !== "executed" && i.status !== "rejected").length ?? 0;
  return (
    <>
      <div className="flex h-12 items-center gap-2 px-2">
        <LogoMark size={18} />
        <span className="font-semibold">ledger</span>
        <span className="text-fg-faint">TBILL</span>
      </div>

      <button
        onClick={() => {
          onNavigate?.();
          setModalOpen(true);
        }}
        className="mb-3 flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2 text-left text-fg shadow-[0_1px_1px_rgba(0,0,0,0.03)] hover:bg-hover"
      >
        <SquarePen className="size-3.5 text-fg-muted" />
        <span className="flex-1">New intent</span>
        <span className="kbd">C</span>
      </button>

      <nav className="flex flex-col gap-px">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex h-7 items-center gap-2 rounded-md px-2 ${active ? "bg-hover font-medium text-fg" : "text-fg-muted hover:bg-hover hover:text-fg"}`}
            >
              <Icon className="size-3.5" />
              <span className="flex-1">{label}</span>
              {label === "Intents" && open > 0 && <span className="num text-[12px] text-fg-faint">{open}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="mt-5 px-2 pb-1 text-[12px] font-medium text-fg-faint">Chains</div>
      <ul className="flex flex-col gap-px">
        {CHAIN_ORDER.map((k) => {
          const c = ledger?.asset.chains.find((x) => x.chain === k);
          return (
            <li key={k} className="flex h-7 items-center gap-2 rounded-md px-2 text-fg-muted">
              <ChainLogo chain={k} size={14} />
              <span className="flex-1">{CHAINS[k].name}</span>
              {c && <span className="num text-[12px] text-fg-faint">{fmtAmount(c.authorized, { compact: true })}</span>}
            </li>
          );
        })}
        {UNAVAILABLE_CHAINS.map((u) => (
          <li key={u.key} className="flex h-7 items-center gap-2 rounded-md px-2 text-fg-faint">
            <span className="opacity-60">
              <ChainLogo chain={u.key} size={14} />
            </span>
            <span className="flex-1">{u.name}</span>
            <span className="text-[11px]">Unavailable</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto space-y-3">
        <div>
          <div className="px-2 pb-1 text-[12px] font-medium text-fg-faint">Acting as (demo)</div>
          <div className="flex flex-col gap-px">
            {demoConfig.approvers.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  setApprover(a.id);
                  onNavigate?.();
                }}
                className={`flex h-7 items-center gap-2 rounded-md px-2 text-left ${approver === a.id ? "bg-hover text-fg" : "text-fg-muted hover:bg-hover"}`}
              >
                <Avatar id={a.id} name={a.name} size={16} />
                <span className="flex-1">{a.name}</span>
                {approver === a.id && <span className="size-1.5 rounded-full bg-accent" />}
              </button>
            ))}
          </div>
          <p className="mt-2 px-2 text-[11px] leading-snug text-fg-faint">
            {demoConfig.mode === "devnet"
              ? "The server signs with demo keys. A real deployment connects each approver's own Solana wallet."
              : "Simulated. Nothing is signed."}
          </p>
        </div>
        <div className="flex items-center gap-2 px-2 text-[12px] text-fg-faint">
          <span className={`size-1.5 rounded-full ${demoConfig.mode === "devnet" ? "bg-ok" : "bg-warn"}`} />
          <span className="flex-1">{demoConfig.mode === "devnet" ? "Solana devnet" : "Simulated"}</span>
          <a href={demoConfig.repoUrl} className="inline-flex items-center gap-0.5 hover:text-fg">
            GitHub <ArrowUpRight className="size-3" />
          </a>
          <Link href="/" onClick={onNavigate} className="inline-flex items-center gap-0.5 hover:text-fg">
            Site <ArrowUpRight className="size-3" />
          </Link>
        </div>
      </div>
    </>
  );
}

/** Page header: breadcrumb on the left, actions on the right. */
export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  const { reset, setNavOpen } = useLedgerStore();
  const dark = useSyncExternalStore(subscribeTheme, () => document.documentElement.classList.contains("dark"), () => false);
  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.theme = next ? "dark" : "light";
    } catch {}
  };
  return (
    <header className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-border bg-surface/90 px-3 backdrop-blur md:px-4">
      <button className="btn -ml-1 md:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation">
        <Menu className="size-4" />
      </button>
      <span className="shrink-0 font-medium">{title}</span>
      {sub && <span className="truncate text-fg-faint max-md:hidden">{sub}</span>}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        {children}
        {demoConfig.mode === "mock" && (
          <button className="btn" onClick={() => void reset()} title="Reset the simulated ledger">
            <RotateCcw className="size-3.5" />
          </button>
        )}
        <button className="btn" onClick={toggleTheme} aria-label="Toggle theme">
          {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </button>
      </div>
    </header>
  );
}

/** Bottom-right notice, auto-dismissed. Used to say which demo key signs after an approver switch. */
function Notice({ text, onClose }: { text: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 7000);
    return () => clearTimeout(t);
  }, [text, onClose]);
  return (
    <div role="status" className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-50 flex items-start sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-sm gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-[13px] leading-snug shadow-xl">
      <KeyRound className="mt-0.5 size-4 shrink-0 text-accent" />
      <span className="flex-1">{text}</span>
      <button onClick={onClose} className="text-fg-faint hover:text-fg" aria-label="Dismiss">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
