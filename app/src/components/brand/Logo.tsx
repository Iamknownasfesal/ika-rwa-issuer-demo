/**
 * The ledger mark: a disc cut into five bars, one per chain, with the red
 * square that ends the wordmark. Drawn on a 32 unit grid so it stays crisp
 * down to 16px.
 */
/** `dot={false}` when the red-dotted wordmark sits right next to it. */
export function LogoMark({ size = 24, className = "", dot = true }: { size?: number; className?: string; dot?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <clipPath id="ledger-disc">
          <circle cx="14" cy="16" r="12" />
        </clipPath>
      </defs>
      <g clipPath="url(#ledger-disc)" fill="currentColor">
        <rect x="0" y="4" width="28" height="3.4" />
        <rect x="0" y="9.2" width="28" height="3.4" />
        <rect x="0" y="14.4" width="28" height="3.4" />
        <rect x="0" y="19.6" width="28" height="3.4" />
        <rect x="0" y="24.8" width="28" height="3.4" />
      </g>
      {dot && <rect x="26" y="24.6" width="4.4" height="4.4" fill="var(--color-signal, #c1332b)" />}
    </svg>
  );
}
