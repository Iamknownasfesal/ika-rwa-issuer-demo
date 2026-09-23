//! Ika dWallet CPI for Pinocchio 0.11.
//!
//! Adapted from `ika-dwallet-pinocchio` in
//! <https://github.com/dwallet-labs/ika-pre-alpha> (BSD-3-Clause-Clear,
//! Copyright (c) dWallet Labs, Ltd.). Rewritten without heap allocation and
//! against the `pinocchio 0.11` account types. Wire format is identical.

use pinocchio::{
    AccountView, ProgramResult,
    cpi::{Seed, Signer, invoke_signed},
    instruction::{InstructionAccount, InstructionView},
};

/// Seed for the CPI authority PDA: `find_program_address(&[CPI_AUTHORITY_SEED], caller_program_id)`.
pub const CPI_AUTHORITY_SEED: &[u8] = b"__ika_cpi_authority";

/// `approve_message` discriminator in the Ika dWallet program.
pub const IX_APPROVE_MESSAGE: u8 = 8;
/// `transfer_ownership` discriminator.
pub const IX_TRANSFER_OWNERSHIP: u8 = 24;

/// Ika `DWalletSignatureScheme` values.
pub const SCHEME_ECDSA_KECCAK256: u16 = 0;
pub const SCHEME_EDDSA_SHA512: u16 = 5;
/// Ika `DWalletCurve` values.
pub const CURVE_SECP256K1: u16 = 0;
pub const CURVE_CURVE25519: u16 = 2;

/// Ika account discriminators / offsets used for validation.
pub const DISC_DWALLET: u8 = 2;
pub const DWALLET_AUTHORITY: usize = 2;
pub const DWALLET_STATE: usize = 36;
pub const DWALLET_STATE_ACTIVE: u8 = 1;

pub struct DWalletContext<'a> {
    pub dwallet_program: &'a AccountView,
    pub cpi_authority: &'a AccountView,
    pub caller_program: &'a AccountView,
    pub cpi_authority_bump: u8,
}

impl<'a> DWalletContext<'a> {
    /// CPI `approve_message`: creates a MessageApproval PDA owned by the
    /// dWallet program requesting a signature over `message_digest`.
    ///
    /// Data: `[8, bump, message_digest(32), message_metadata_digest(32), user_pubkey(32), signature_scheme(2)]`
    #[allow(clippy::too_many_arguments)]
    pub fn approve_message(
        &self,
        coordinator: &'a AccountView,
        message_approval: &'a AccountView,
        dwallet: &'a AccountView,
        payer: &'a AccountView,
        system_program: &'a AccountView,
        message_digest: [u8; 32],
        message_metadata_digest: [u8; 32],
        user_pubkey: [u8; 32],
        signature_scheme: u16,
        bump: u8,
    ) -> ProgramResult {
        let mut data = [0u8; 100];
        data[0] = IX_APPROVE_MESSAGE;
        data[1] = bump;
        data[2..34].copy_from_slice(&message_digest);
        data[34..66].copy_from_slice(&message_metadata_digest);
        data[66..98].copy_from_slice(&user_pubkey);
        data[98..100].copy_from_slice(&signature_scheme.to_le_bytes());

        let accounts = [
            InstructionAccount::readonly(coordinator.address()),
            InstructionAccount::writable(message_approval.address()),
            InstructionAccount::readonly(dwallet.address()),
            InstructionAccount::readonly(self.caller_program.address()),
            InstructionAccount::readonly_signer(self.cpi_authority.address()),
            InstructionAccount::writable_signer(payer.address()),
            InstructionAccount::readonly(system_program.address()),
        ];

        let bump_byte = [self.cpi_authority_bump];
        let seeds = [Seed::from(CPI_AUTHORITY_SEED), Seed::from(&bump_byte)];
        let signer = Signer::from(&seeds);

        let ix = InstructionView {
            program_id: self.dwallet_program.address(),
            accounts: &accounts,
            data: &data,
        };

        invoke_signed(
            &ix,
            &[
                coordinator,
                message_approval,
                dwallet,
                self.caller_program,
                self.cpi_authority,
                payer,
                system_program,
                self.dwallet_program,
            ],
            &[signer],
        )
    }

    /// CPI `transfer_ownership`: hand the dWallet to another authority.
    pub fn transfer_dwallet(
        &self,
        dwallet: &'a AccountView,
        new_authority: [u8; 32],
    ) -> ProgramResult {
        let mut data = [0u8; 33];
        data[0] = IX_TRANSFER_OWNERSHIP;
        data[1..33].copy_from_slice(&new_authority);

        let accounts = [
            InstructionAccount::readonly(self.caller_program.address()),
            InstructionAccount::readonly_signer(self.cpi_authority.address()),
            InstructionAccount::writable(dwallet.address()),
        ];
        let bump_byte = [self.cpi_authority_bump];
        let seeds = [Seed::from(CPI_AUTHORITY_SEED), Seed::from(&bump_byte)];
        let signer = Signer::from(&seeds);
        let ix = InstructionView {
            program_id: self.dwallet_program.address(),
            accounts: &accounts,
            data: &data,
        };
        invoke_signed(
            &ix,
            &[
                self.caller_program,
                self.cpi_authority,
                dwallet,
                self.dwallet_program,
            ],
            &[signer],
        )
    }
}
