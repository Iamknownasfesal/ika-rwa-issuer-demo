/**
 * Single place for demo knobs. Timers are real `setTimeout`s in mock mode.
 */
export type LedgerMode = "mock" | "devnet";

export const demoConfig = {
  /** `mock` = in-browser simulated chain state; `devnet` = real Solana ledger via API routes. */
  mode: (process.env.NEXT_PUBLIC_LEDGER_MODE === "devnet" ? "devnet" : "mock") as LedgerMode,
  /** Seconds between the approval threshold being reached and Execute becoming available. */
  timelockSeconds: Number(process.env.NEXT_PUBLIC_TIMELOCK_SECONDS ?? 5),
  /** Delay between execution stepper steps in mock mode. */
  stepDelayMs: Number(process.env.NEXT_PUBLIC_STEP_DELAY_MS ?? 1500),
  /** Approver display names (ids are stable: alice | bob | carol). */
  approvers: [
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
    { id: "carol", name: "Carol" },
  ] as const,
  /** M-of-N approval threshold. */
  threshold: 2,
  /** Public source repository. */
  repoUrl: "https://github.com/Iamknownasfesal/ika-rwa-issuer-demo",
  /** Solana explorer cluster query for devnet links. */
  solanaExplorer: "https://explorer.solana.com",
} as const;

export type ApproverId = (typeof demoConfig.approvers)[number]["id"];
