//! Program error codes. Surfaced as `ProgramError::Custom(code)` so the
//! TypeScript SDK can map each code back to a policy rule with a human
//! readable explanation.

use pinocchio::error::ProgramError;

#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LedgerError {
    /// Amount must be > 0.
    ZeroAmount = 0,
    /// authorized_total + amount > global_cap.
    GlobalCapExceeded = 1,
    /// chain.authorized + amount > chain.cap.
    ChainCapExceeded = 2,
    /// chain.authorized < amount for a burn / move source leg.
    InsufficientSupply = 3,
    /// Recipient is not in the destination chain allowlist.
    RecipientNotAllowlisted = 4,
    /// Signer is not in the approver set.
    NotApprover = 5,
    /// The proposer of an intent cannot approve it.
    ProposerCannotApprove = 6,
    /// This approver already approved the intent.
    AlreadyApproved = 7,
    /// approvals < threshold.
    ThresholdNotMet = 8,
    /// now < approved_at + timelock.
    TimelockActive = 9,
    /// Intent / leg is not in the right status for this action.
    InvalidStatus = 10,
    /// For a move, the burn leg must be confirmed before the mint leg.
    LegNotReady = 11,
    /// The chain account passed does not match the leg's chain.
    ChainMismatch = 12,
    /// Signer is not admin / executor / approver.
    Unauthorized = 13,
    /// Chain kind does not match the accounts supplied.
    InvalidChainKind = 14,
    /// Token account does not match the intent's recipient / source.
    AccountMismatch = 15,
    /// Chain id is unknown or already registered.
    InvalidChain = 16,
    /// Too many approvers / allowlist entries / invalid threshold.
    InvalidConfig = 17,
    /// Address / byte-string too long.
    InvalidLength = 18,
    /// Intent kind is unknown.
    InvalidIntentKind = 19,
    /// Account has the wrong discriminator or owner.
    InvalidAccount = 20,
    /// Arithmetic overflow.
    Overflow = 21,
    /// Source and destination chains must differ for a move.
    SameChain = 22,
}

impl From<LedgerError> for ProgramError {
    fn from(e: LedgerError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
