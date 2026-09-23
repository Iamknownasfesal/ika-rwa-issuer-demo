//! Authorization message and digest computation.
//!
//! The ledger never signs a raw destination-chain transaction. Instead it
//! computes a canonical *authorization message* for each leg and asks the Ika
//! dWallet to sign that. Destination contracts verify the dWallet signature
//! over the same bytes, so anyone (a relayer paying gas) can deliver it, and
//! nothing can be minted or burned that the ledger did not authorize.
//!
//! Two encodings:
//!
//! * `Raw` (Ed25519 chains such as Sui): the message is a fixed
//!   161-byte structure prefixed with `IKA_RWA_AUTH_V1`.
//! * `Eip712` (EVM chains): `0x19 0x01 || domainSeparator || structHash` where
//!   `structHash = keccak256(TYPEHASH || uint8 action || uint256 amount ||
//!   bytes32 account || uint256 nonce || bytes32 ledger)`.
//!
//! In both cases the Ika `message_digest` is `keccak256(message)`, as required
//! by the dWallet program's MessageApproval PDA derivation.
//!
//! This module is mirrored byte-for-byte in `sdk/src/digest.ts`.

use solana_keccak_hasher::hashv;

pub const RAW_PREFIX: &[u8; 15] = b"IKA_RWA_AUTH_V1";
pub const EIP712_TYPE: &[u8] =
    b"IssuerAuthorization(uint8 action,uint256 amount,bytes32 account,uint256 nonce,bytes32 ledger)";

/// prefix(15) | domain(32) | action(1) | amount(8 LE) | account_len(1) | account(64) | nonce(8 LE) | ledger(32)
pub const RAW_MESSAGE_LEN: usize = 15 + 32 + 1 + 8 + 1 + 64 + 8 + 32;
/// 0x19 0x01 | domain(32) | structHash(32)
pub const EIP712_MESSAGE_LEN: usize = 2 + 32 + 32;

pub struct Authorization<'a> {
    /// 0 = mint, 1 = burn
    pub action: u8,
    /// Base units.
    pub amount: u64,
    /// Destination (mint) or source (burn) account on the target chain, ≤ 64 bytes.
    pub account: &'a [u8],
    /// Unique per leg: `(intent_index << 1) | leg_index`.
    pub nonce: u64,
    /// The Asset PDA address on Solana that authorized this leg.
    pub ledger: &'a [u8; 32],
    /// Per-chain domain separator stored in the ChainDeployment.
    pub domain_separator: &'a [u8; 32],
}

/// Leg nonce = (intent_index << 1) | leg_index.
#[inline(always)]
pub fn leg_nonce(intent_index: u64, leg_index: u8) -> u64 {
    (intent_index << 1) | (leg_index as u64 & 1)
}

/// Build the raw authorization message.
pub fn raw_message(a: &Authorization, out: &mut [u8; RAW_MESSAGE_LEN]) {
    out.fill(0);
    let mut o = 0;
    out[o..o + 15].copy_from_slice(RAW_PREFIX);
    o += 15;
    out[o..o + 32].copy_from_slice(a.domain_separator);
    o += 32;
    out[o] = a.action;
    o += 1;
    out[o..o + 8].copy_from_slice(&a.amount.to_le_bytes());
    o += 8;
    let len = a.account.len().min(64);
    out[o] = len as u8;
    o += 1;
    out[o..o + len].copy_from_slice(&a.account[..len]);
    o += 64;
    out[o..o + 8].copy_from_slice(&a.nonce.to_le_bytes());
    o += 8;
    out[o..o + 32].copy_from_slice(a.ledger);
}

/// `bytes32 account`: account bytes right-aligned in 32 bytes (an EVM address
/// becomes `bytes32(uint256(uint160(addr)))`). Accounts longer than 32 bytes
/// are hashed.
pub fn account_word(account: &[u8]) -> [u8; 32] {
    let mut w = [0u8; 32];
    if account.len() <= 32 {
        w[32 - account.len()..].copy_from_slice(account);
    } else {
        w = hashv(&[account]).to_bytes();
    }
    w
}

/// Build the EIP-712 message (`\x19\x01 || domain || structHash`).
pub fn eip712_message(a: &Authorization, out: &mut [u8; EIP712_MESSAGE_LEN]) {
    let typehash = hashv(&[EIP712_TYPE]).to_bytes();
    let mut action_w = [0u8; 32];
    action_w[31] = a.action;
    let mut amount_w = [0u8; 32];
    amount_w[24..].copy_from_slice(&a.amount.to_be_bytes());
    let account_w = account_word(a.account);
    let mut nonce_w = [0u8; 32];
    nonce_w[24..].copy_from_slice(&a.nonce.to_be_bytes());
    let struct_hash = hashv(&[
        &typehash, &action_w, &amount_w, &account_w, &nonce_w, a.ledger,
    ])
    .to_bytes();
    out[0] = 0x19;
    out[1] = 0x01;
    out[2..34].copy_from_slice(a.domain_separator);
    out[34..66].copy_from_slice(&struct_hash);
}

/// keccak256 of the encoded authorization message. This is the value stored
/// in the Ika `MessageApproval` and in the leg.
pub fn message_digest(encoding: u8, a: &Authorization) -> [u8; 32] {
    if encoding == crate::state::chain::ENCODING_EIP712 {
        let mut m = [0u8; EIP712_MESSAGE_LEN];
        eip712_message(a, &mut m);
        hashv(&[&m]).to_bytes()
    } else {
        let mut m = [0u8; RAW_MESSAGE_LEN];
        raw_message(a, &mut m);
        hashv(&[&m]).to_bytes()
    }
}
