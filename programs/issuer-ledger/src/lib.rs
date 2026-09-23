//! # Issuer Ledger
//!
//! A Solana program (Pinocchio) that acts as the single policy ledger for a
//! tokenized real-world asset issued on many chains. It owns the Ika dWallets
//! that are the mint/burn authority on every foreign chain and the Token-2022
//! mint authority on Solana. No mint or burn on any chain can happen unless an
//! intent passed the on-chain policy, collected M-of-N approvals, and cleared
//! the timelock.
//!
//! ## Instructions
//!
//! | disc | name            | effect |
//! |------|-----------------|--------|
//! | 0    | `InitAsset`     | create the Asset PDA (caps, approvers, threshold, timelock, executor, Ika program) |
//! | 1    | `AddChain`      | register a ChainDeployment (dWallet, contract, cap, allowlist, seed supply) |
//! | 2    | `CreateIntent`  | run policy rules; create an Intent PDA (mint / burn / move) |
//! | 3    | `ApproveIntent` | approver signs; distinct, not proposer; sets `approved_at` at threshold |
//! | 4    | `ExecuteLeg`    | threshold + timelock; Solana leg → Token-2022 CPI; foreign leg → Ika `approve_message` CPI |
//! | 5    | `ConfirmLeg`    | executor records the destination tx hash; gates the second leg of a move |
//!
//! Account layouts live in [`state`], error codes in [`error`], the signed
//! authorization message in [`digest`], and the Ika CPI in [`ika`].

#![no_std]

pub mod digest;
pub mod error;
pub mod ika;
pub mod instructions;
pub mod state;

use pinocchio::{AccountView, Address, ProgramResult, error::ProgramError};

#[cfg(target_os = "solana")]
pinocchio::entrypoint!(process_instruction);
#[cfg(target_os = "solana")]
pinocchio::nostd_panic_handler!();

pub const IX_INIT_ASSET: u8 = 0;
pub const IX_ADD_CHAIN: u8 = 1;
pub const IX_CREATE_INTENT: u8 = 2;
pub const IX_APPROVE_INTENT: u8 = 3;
pub const IX_EXECUTE_LEG: u8 = 4;
pub const IX_CONFIRM_LEG: u8 = 5;

pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let (disc, rest) = data
        .split_first()
        .ok_or(ProgramError::InvalidInstructionData)?;
    match *disc {
        IX_INIT_ASSET => instructions::init_asset(program_id, accounts, rest),
        IX_ADD_CHAIN => instructions::add_chain(program_id, accounts, rest),
        IX_CREATE_INTENT => instructions::create_intent(program_id, accounts, rest),
        IX_APPROVE_INTENT => instructions::approve_intent(program_id, accounts, rest),
        IX_EXECUTE_LEG => instructions::execute_leg(program_id, accounts, rest),
        IX_CONFIRM_LEG => instructions::confirm_leg(program_id, accounts, rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
