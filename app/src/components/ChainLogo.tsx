import type { ChainKey } from "@/types";

const STYLE: Record<ChainKey, { bg: string; fg: string; glyph: string }> = {
  solana: { bg: "#111", fg: "#14f195", glyph: "S" },
  ethereum: { bg: "#627eea", fg: "#fff", glyph: "Ξ" },
  base: { bg: "#0052ff", fg: "#fff", glyph: "B" },
  sui: { bg: "#4da2ff", fg: "#fff", glyph: "◇" },
  tempo: { bg: "#1b1b1f", fg: "#f5c518", glyph: "T" },
};

export function ChainLogo({ chain, size = 24 }: { chain: ChainKey; size?: number }) {
  const s = STYLE[chain];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0 rounded-full">
      <circle cx="12" cy="12" r="11.5" fill={s.bg} stroke="var(--border-strong)" strokeWidth="1" />
      <text x="12" y="16" textAnchor="middle" fontSize="12" fontWeight="700" fill={s.fg} fontFamily="ui-sans-serif, system-ui">
        {s.glyph}
      </text>
    </svg>
  );
}
