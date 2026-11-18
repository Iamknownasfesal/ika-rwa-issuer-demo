//! Ika dWallet integration.
//!
//! The CPI itself is `ika-dwallet-pinocchio` from
//! <https://github.com/dwallet-labs/ika-pre-alpha>. Its `ID` is the Ika
//! program of the network this ledger was built for, and `DWalletContext`
//! refuses to call any other program. This module adds the account offsets
//! the ledger reads to bind a signature voucher to the right dWallet.

use pinocchio::{AccountView, Address};

pub use ika_dwallet_pinocchio::{CPI_AUTHORITY_SEED, DWalletContext, ID as IKA_PROGRAM_ID};

use crate::error::LedgerError;

/// Ika `DWalletSignatureScheme` values.
pub const SCHEME_ECDSA_KECCAK256: u16 = 0;
pub const SCHEME_EDDSA_SHA512: u16 = 5;
/// Ika `DWalletCurve` values.
pub const CURVE_SECP256K1: u16 = 0;
pub const CURVE_CURVE25519: u16 = 2;

/// `DWallet` account: tag, length and the offsets the ledger checks.
pub const DISC_DWALLET: u8 = 97;
pub const DWALLET_LEN: usize = 185;
pub const DWALLET_OWNER: usize = 2;
pub const DWALLET_CURVE: usize = 34;
pub const DWALLET_STATE: usize = 36;
pub const DWALLET_PUBLIC_KEY_LEN: usize = 37;
pub const DWALLET_PUBLIC_KEY: usize = 38;
pub const DWALLET_STATE_ACTIVE: u8 = 1;

/// `SignatureVoucher` account: tag, length and the offsets clients read.
pub const DISC_SIGNATURE_VOUCHER: u8 = 108;
pub const SIGNATURE_VOUCHER_LEN: usize = 304;
pub const VOUCHER_DWALLET: usize = 2;
pub const VOUCHER_MESSAGE_DIGEST: usize = 34;
pub const VOUCHER_OWNER: usize = 98;
pub const VOUCHER_SIGNATURE_SCHEME: usize = 130;
pub const VOUCHER_SIGNING_KEY: usize = 133;
pub const VOUCHER_STATUS: usize = 173;

/// Check that `dwallet` is an active dWallet of the Ika program this ledger
/// was built for, owned by the ledger's CPI authority, with the curve and
/// public key the chain registered.
pub fn check_dwallet(
    dwallet: &AccountView,
    cpi_authority: &Address,
    curve: u16,
    public_key: &[u8],
) -> Result<(), LedgerError> {
    if !dwallet.owned_by(&IKA_PROGRAM_ID) || dwallet.data_len() != DWALLET_LEN {
        return Err(LedgerError::InvalidDWallet);
    }
    let d = dwallet
        .try_borrow()
        .map_err(|_| LedgerError::InvalidDWallet)?;
    if d[0] != DISC_DWALLET || d[DWALLET_STATE] != DWALLET_STATE_ACTIVE {
        return Err(LedgerError::InvalidDWallet);
    }
    if &d[DWALLET_OWNER..DWALLET_OWNER + 32] != cpi_authority.as_array() {
        return Err(LedgerError::DWalletNotOwned);
    }
    let len = d[DWALLET_PUBLIC_KEY_LEN] as usize;
    if u16::from_le_bytes([d[DWALLET_CURVE], d[DWALLET_CURVE + 1]]) != curve
        || len != public_key.len()
        || &d[DWALLET_PUBLIC_KEY..DWALLET_PUBLIC_KEY + len] != public_key
    {
        return Err(LedgerError::DWalletMismatch);
    }
    Ok(())
}
