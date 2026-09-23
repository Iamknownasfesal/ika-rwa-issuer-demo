/** Mirror of `programs/issuer-ledger/src/error.rs` (`ProgramError::Custom(code)`). */
export const LedgerError = {
  ZeroAmount: 0,
  GlobalCapExceeded: 1,
  ChainCapExceeded: 2,
  InsufficientSupply: 3,
  RecipientNotAllowlisted: 4,
  NotApprover: 5,
  ProposerCannotApprove: 6,
  AlreadyApproved: 7,
  ThresholdNotMet: 8,
  TimelockActive: 9,
  InvalidStatus: 10,
  LegNotReady: 11,
  ChainMismatch: 12,
  Unauthorized: 13,
  InvalidChainKind: 14,
  AccountMismatch: 15,
  InvalidChain: 16,
  InvalidConfig: 17,
  InvalidLength: 18,
  InvalidIntentKind: 19,
  InvalidAccount: 20,
  Overflow: 21,
  SameChain: 22,
} as const;
export type LedgerErrorCode = (typeof LedgerError)[keyof typeof LedgerError];

const MESSAGES: Record<number, { rule: string; message: string }> = {
  0: { rule: 'amount', message: 'Amount must be greater than zero.' },
  1: { rule: 'globalCap', message: 'Global cap exceeded: authorized total + amount is above the asset cap.' },
  2: { rule: 'chainCap', message: 'Per-chain cap exceeded on the destination chain.' },
  3: { rule: 'supply', message: 'Insufficient authorized supply on the source chain.' },
  4: { rule: 'allowlist', message: 'Recipient is not on the destination chain allowlist.' },
  5: { rule: 'proposer', message: 'Signer is not in the approver set.' },
  6: { rule: 'approval', message: 'The proposer cannot approve their own intent.' },
  7: { rule: 'approval', message: 'This approver already approved the intent.' },
  8: { rule: 'threshold', message: 'Approval threshold not met.' },
  9: { rule: 'timelock', message: 'Timelock has not elapsed since approval.' },
  10: { rule: 'status', message: 'Intent or leg is not in the right status for this action.' },
  11: { rule: 'leg', message: 'The burn leg must be confirmed before the mint leg can execute.' },
  12: { rule: 'chain', message: 'Chain account does not match the leg.' },
  13: { rule: 'auth', message: 'Signer is not admin, executor or an approver.' },
  14: { rule: 'chain', message: 'Chain kind does not match the supplied accounts.' },
  15: { rule: 'account', message: 'Token account does not match the intent recipient / source.' },
  16: { rule: 'chain', message: 'Unknown or duplicate chain id.' },
  17: { rule: 'config', message: 'Invalid configuration (approvers, threshold, allowlist).' },
  18: { rule: 'length', message: 'Byte string too long.' },
  19: { rule: 'kind', message: 'Unknown intent kind.' },
  20: { rule: 'account', message: 'Account has the wrong owner or discriminator.' },
  21: { rule: 'overflow', message: 'Arithmetic overflow.' },
  22: { rule: 'chain', message: 'Source and destination chains must differ for a move.' },
};

export function explainError(code: number): { rule: string; message: string } {
  return MESSAGES[code] ?? { rule: 'unknown', message: `Program error ${code}` };
}

/** Pull a `Custom(n)` ledger error code out of an RPC / kit error, if present. */
export function extractLedgerErrorCode(err: unknown): number | null {
  const safe = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
  const s = err instanceof Error ? `${err.message} ${safe((err as { context?: unknown }).context ?? '')} ${safe((err as { cause?: unknown }).cause ?? '')}` : String(err);
  const m = s.match(/Custom(?:\D{0,4})(\d+)/) ?? s.match(/custom program error: (0x[0-9a-f]+)/i);
  if (!m) return null;
  return Number(m[1]);
}
