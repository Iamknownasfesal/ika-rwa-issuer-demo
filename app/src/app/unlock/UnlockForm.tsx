"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

export function UnlockForm() {
  const next = useSearchParams().get("next");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setError(body.error ?? "Something went wrong.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mt-8">
      <label htmlFor="password" className="font-plex text-[11px] uppercase tracking-[0.08em] text-stone">
        Password
      </label>
      <div className="mt-2 flex border border-rule focus-within:border-ink">
        <input
          id="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="min-w-0 flex-1 bg-transparent px-3.5 py-3 font-display text-[15px] outline-none"
        />
        <button
          type="submit"
          disabled={busy || !password}
          className="bg-signal px-5 font-display text-[14px] font-medium text-ink transition-opacity disabled:opacity-40"
        >
          {busy ? "Checking" : "Enter"}
        </button>
      </div>
      <p role="alert" className="mt-3 h-5 font-display text-[13px] text-signal">
        {error}
      </p>
    </form>
  );
}
