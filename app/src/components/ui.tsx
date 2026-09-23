"use client";

import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { IntentStatus } from "@/types";
import { short } from "@/lib/format";

export function Hash({ value, href, full = false, className = "" }: { value?: string; href?: string; full?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-fg-faint">None</span>;
  const copy = () => {
    void navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const text = full ? value : short(value, 6, 4);
  return (
    <span className={`group inline-flex max-w-full items-center gap-1 ${className}`}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="mono truncate text-[12px] text-fg hover:text-accent" title={value}>
          {text}
        </a>
      ) : (
        <span className="mono truncate text-[12px]" title={value}>
          {text}
        </span>
      )}
      <button onClick={copy} className="text-fg-faint opacity-0 transition-opacity hover:text-fg focus:opacity-100 group-hover:opacity-100" aria-label="Copy">
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </span>
  );
}

const STATUS: Record<IntentStatus, { label: string; color: string; fill: number }> = {
  rejected: { label: "Rejected", color: "var(--fg-faint)", fill: -1 },
  pending_approval: { label: "Pending approval", color: "var(--fg-muted)", fill: 0 },
  approved: { label: "Approved", color: "var(--warn)", fill: 0.5 },
  executing: { label: "Executing", color: "var(--warn)", fill: 0.75 },
  executed: { label: "Executed", color: "var(--accent)", fill: 1 },
};

export const statusLabel = (s: IntentStatus) => STATUS[s].label;

/** Linear-style progress circle: outline, partial pie, or filled check. */
export function StatusIcon({ status, size = 14 }: { status: IntentStatus; size?: number }) {
  const { color, fill } = STATUS[status];
  const r = 3.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-label={STATUS[status].label} className="shrink-0">
      {fill === 1 ? (
        <>
          <circle cx="7" cy="7" r="6" fill={color} />
          <path d="M4.3 7.2 6.2 9 9.7 5.3" fill="none" stroke="var(--surface)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : fill === -1 ? (
        <>
          <circle cx="7" cy="7" r="6" fill={color} />
          <path d="M5 5l4 4M9 5 5 9" stroke="var(--surface)" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray={fill === 0 ? "2 1.6" : undefined} />
          {fill > 0 && (
            <circle cx="7" cy="7" r={r} fill="none" stroke={color} strokeWidth={r * 2} strokeDasharray={`${c * fill} ${c}`} transform="rotate(-90 7 7)" />
          )}
        </>
      )}
    </svg>
  );
}

const AVATAR_BG: Record<string, string> = { alice: "#5e6ad2", bob: "#26a269", carol: "#d9822b" };

export function Avatar({ id, name, size = 18 }: { id: string; name: string; size?: number }) {
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full font-medium text-white"
      style={{ width: size, height: size, background: AVATAR_BG[id] ?? "#8f8f9a", fontSize: size * 0.5 }}
      aria-hidden
    >
      {name[0]}
    </span>
  );
}

export function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] items-center gap-3 py-1">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-fg-muted">{title}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[12px] text-fg-muted">{label}</span>
        {hint && <span className="text-[11px] text-fg-faint">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
