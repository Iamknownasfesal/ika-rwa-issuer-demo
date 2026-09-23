const DECIMALS = 6;
export const ONE = 10 ** DECIMALS;

/** Format base units as whole tokens with thousands separators. */
export function fmtAmount(base: number, opts: { compact?: boolean } = {}): string {
  const whole = base / ONE;
  if (opts.compact) {
    if (Math.abs(whole) >= 1_000_000) return `${trim(whole / 1_000_000)}M`;
    if (Math.abs(whole) >= 1_000) return `${trim(whole / 1_000)}K`;
  }
  return whole.toLocaleString("en-US", { maximumFractionDigits: DECIMALS });
}

function trim(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Parse a user-entered token amount into base units (integer). */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[,\s_]/g, "");
  if (!/^\d+(\.\d{0,6})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return Number(w) * ONE + Number((f + "000000").slice(0, 6));
}

export function toBase(tokens: number): number {
  return Math.round(tokens * ONE);
}

export function short(s: string, head = 6, tail = 4): string {
  if (!s) return "";
  if (s.includes("::")) {
    const [name, id] = s.split("::");
    return `${name}::${id.slice(0, 6)}…${id.slice(-4)}`;
  }
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function fmtTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}
