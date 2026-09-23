import type { UnavailableChainKey } from "@/lib/chains";
import type { ChainKey } from "@/types";

/** Network logo as a round badge. Files live in public/chains. */
export function ChainLogo({ chain, size = 24 }: { chain: ChainKey | UnavailableChainKey; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny static SVGs; next/image adds nothing here
    <img src={`/chains/${chain}.svg`} width={size} height={size} alt="" aria-hidden className="shrink-0 rounded-full ring-1 ring-border-strong" />
  );
}
