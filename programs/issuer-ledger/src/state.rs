//! Account layouts. Every account starts with `discriminator(1) | version(1)`.
//! All integers are little-endian. Layouts are fixed-size so the TypeScript
//! SDK can decode them with plain offsets (see `sdk/src/accounts.ts`).

/// Max approvers stored on the asset.
pub const MAX_APPROVERS: usize = 5;
/// Max allowlisted recipient addresses per chain deployment.
pub const MAX_ALLOWLIST: usize = 4;
/// Max legs per intent (a move = burn leg + mint leg).
pub const MAX_LEGS: usize = 2;
/// Padded byte-string length for foreign addresses / tx hashes.
pub const ADDR_BYTES: usize = 64;
/// A length-prefixed padded byte string: `len(1) | bytes(64)`.
pub const ADDR_LEN: usize = 1 + ADDR_BYTES;

pub const SEED_ASSET: &[u8] = b"asset";
pub const SEED_CHAIN: &[u8] = b"chain";
pub const SEED_INTENT: &[u8] = b"intent";
pub const SEED_MINT_AUTHORITY: &[u8] = b"mint_authority";

// ───────────────────────────── discriminators ─────────────────────────────
pub const DISC_ASSET: u8 = 1;
pub const DISC_CHAIN: u8 = 2;
pub const DISC_INTENT: u8 = 3;
pub const VERSION: u8 = 1;

// ───────────────────────────── Asset (352 bytes) ──────────────────────────
// PDA seeds: ["asset", create_key]
pub mod asset {

    pub const CREATE_KEY: usize = 2; // [32]
    pub const ADMIN: usize = 34; // [32]
    pub const EXECUTOR: usize = 66; // [32] off-chain executor (gRPC user_pubkey)
    pub const SYMBOL: usize = 98; // [8] utf8, zero padded
    pub const DECIMALS: usize = 106; // u8
    pub const THRESHOLD: usize = 107; // u8
    pub const APPROVER_COUNT: usize = 108; // u8
    pub const CHAIN_COUNT: usize = 109; // u8
    pub const GLOBAL_CAP: usize = 110; // u64
    pub const AUTHORIZED_TOTAL: usize = 118; // u64
    pub const INTENT_COUNT: usize = 126; // u64
    pub const TIMELOCK_SECS: usize = 134; // u64
    pub const APPROVERS: usize = 142; // [32 * MAX_APPROVERS] = 160
    pub const BUMP: usize = 302; // u8
    pub const MINT_AUTHORITY_BUMP: usize = 303; // u8
    pub const IKA_PROGRAM: usize = 304; // [32] the Ika dWallet program this ledger trusts
    pub const RESERVED: usize = 336; // [16]
    pub const LEN: usize = 352;
}

// ─────────────────────── ChainDeployment (531 bytes) ──────────────────────
// PDA seeds: ["chain", asset, chain_id_le(2)]
pub mod chain {

    pub const ASSET: usize = 2; // [32]
    pub const CHAIN_ID: usize = 34; // u16
    pub const LEG_KIND: usize = 36; // u8: 0 = SolanaNative (Token-2022 CPI), 1 = IkaForeign
    pub const ENCODING: usize = 37; // u8: 0 = Raw authorization, 1 = EIP-712
    pub const CURVE: usize = 38; // u16 Ika DWalletCurve
    pub const SIGNATURE_SCHEME: usize = 40; // u16 Ika DWalletSignatureScheme
    pub const DWALLET: usize = 42; // [32] Ika dWallet PDA (zero for solana-native)
    pub const DWALLET_PUBKEY_LEN: usize = 74; // u8
    pub const DWALLET_PUBKEY: usize = 75; // [65]
    pub const CONTRACT: usize = 140; // ADDR_LEN (mint address on Solana, contract / party elsewhere)
    pub const DOMAIN_SEPARATOR: usize = 205; // [32]
    pub const AUTHORIZED: usize = 237; // u64
    pub const CAP: usize = 245; // u64
    pub const ALLOWLIST_COUNT: usize = 253; // u8
    pub const ALLOWLIST: usize = 254; // [ADDR_LEN * MAX_ALLOWLIST] = 260
    pub const BUMP: usize = 514; // u8
    pub const RESERVED: usize = 515; // [16]
    pub const LEN: usize = 531;

    pub const LEG_KIND_SOLANA_NATIVE: u8 = 0;
    pub const LEG_KIND_IKA_FOREIGN: u8 = 1;
    pub const ENCODING_RAW: u8 = 0;
    pub const ENCODING_EIP712: u8 = 1;
}

// ─────────────────────────── Intent (568 bytes) ───────────────────────────
// PDA seeds: ["intent", asset, index_le(8)]
pub mod intent {

    pub const ASSET: usize = 2; // [32]
    pub const INDEX: usize = 34; // u64
    pub const KIND: usize = 42; // u8: 0 Mint, 1 Burn, 2 Move
    pub const STATUS: usize = 43; // u8
    pub const PROPOSER: usize = 44; // [32]
    pub const AMOUNT: usize = 76; // u64
    pub const SRC_CHAIN: usize = 84; // u16 (Burn / Move)
    pub const DST_CHAIN: usize = 86; // u16 (Mint / Move)
    pub const RECIPIENT: usize = 88; // ADDR_LEN (mint destination account)
    pub const SOURCE: usize = 153; // ADDR_LEN (burn source account)
    pub const MEMO: usize = 218; // [32]
    pub const CREATED_AT: usize = 250; // i64
    pub const APPROVED_AT: usize = 258; // i64
    pub const APPROVALS_BITMAP: usize = 266; // u8 (bit i = approver i approved)
    pub const APPROVAL_COUNT: usize = 267; // u8
    pub const LEG_COUNT: usize = 268; // u8
    pub const BUMP: usize = 269; // u8
    pub const LEGS: usize = 270; // [LEG_LEN * MAX_LEGS] = 298
    pub const LEN: usize = 568;

    pub const KIND_MINT: u8 = 0;
    pub const KIND_BURN: u8 = 1;
    pub const KIND_MOVE: u8 = 2;

    pub const STATUS_PENDING_APPROVAL: u8 = 0;
    pub const STATUS_APPROVED: u8 = 1;
    pub const STATUS_EXECUTING: u8 = 2;
    pub const STATUS_EXECUTED: u8 = 3;
}

// ─────────────────────────── Leg (149 bytes) ──────────────────────────────
pub mod leg {
    pub const ACTION: usize = 0; // u8: 0 mint, 1 burn
    pub const CHAIN_ID: usize = 1; // u16
    pub const STATUS: usize = 3; // u8: 0 Pending, 1 Authorized, 2 Confirmed
    pub const MESSAGE_DIGEST: usize = 4; // [32] keccak256 of the authorization message
    pub const MESSAGE_APPROVAL: usize = 36; // [32] Ika MessageApproval PDA (zero for solana)
    pub const DEST_TX: usize = 68; // ADDR_LEN destination tx hash / signature
    pub const EXECUTED_AT: usize = 133; // i64
    pub const CONFIRMED_AT: usize = 141; // i64
    pub const LEN: usize = 149;

    pub const ACTION_MINT: u8 = 0;
    pub const ACTION_BURN: u8 = 1;

    pub const STATUS_PENDING: u8 = 0;
    pub const STATUS_AUTHORIZED: u8 = 1;
    pub const STATUS_CONFIRMED: u8 = 2;
}

// ───────────────────────────── byte helpers ───────────────────────────────

#[inline(always)]
pub fn read_u16(d: &[u8], off: usize) -> u16 {
    u16::from_le_bytes([d[off], d[off + 1]])
}
#[inline(always)]
pub fn read_u64(d: &[u8], off: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[off..off + 8]);
    u64::from_le_bytes(b)
}
#[inline(always)]
pub fn read_i64(d: &[u8], off: usize) -> i64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[off..off + 8]);
    i64::from_le_bytes(b)
}
#[inline(always)]
pub fn read_32(d: &[u8], off: usize) -> [u8; 32] {
    let mut b = [0u8; 32];
    b.copy_from_slice(&d[off..off + 32]);
    b
}
#[inline(always)]
pub fn write_u16(d: &mut [u8], off: usize, v: u16) {
    d[off..off + 2].copy_from_slice(&v.to_le_bytes());
}
#[inline(always)]
pub fn write_u64(d: &mut [u8], off: usize, v: u64) {
    d[off..off + 8].copy_from_slice(&v.to_le_bytes());
}
#[inline(always)]
pub fn write_i64(d: &mut [u8], off: usize, v: i64) {
    d[off..off + 8].copy_from_slice(&v.to_le_bytes());
}

/// Read a length-prefixed padded byte string (`len | bytes[64]`).
#[inline(always)]
pub fn read_addr(d: &[u8], off: usize) -> &[u8] {
    let len = (d[off] as usize).min(ADDR_BYTES);
    &d[off + 1..off + 1 + len]
}

/// Write a length-prefixed padded byte string. Zero-fills the padding.
#[inline(always)]
pub fn write_addr(d: &mut [u8], off: usize, bytes: &[u8]) {
    let len = bytes.len().min(ADDR_BYTES);
    d[off] = len as u8;
    d[off + 1..off + 1 + len].copy_from_slice(&bytes[..len]);
    for b in &mut d[off + 1 + len..off + ADDR_LEN] {
        *b = 0;
    }
}

/// True if `needle` equals one of the chain's allowlist entries.
pub fn allowlist_contains(chain_data: &[u8], needle: &[u8]) -> bool {
    let count = (chain_data[chain::ALLOWLIST_COUNT] as usize).min(MAX_ALLOWLIST);
    for i in 0..count {
        let off = chain::ALLOWLIST + i * ADDR_LEN;
        if read_addr(chain_data, off) == needle {
            return true;
        }
    }
    false
}

/// Index of `key` in the asset approver set, if any.
pub fn approver_index(asset_data: &[u8], key: &[u8; 32]) -> Option<u8> {
    let count = (asset_data[asset::APPROVER_COUNT] as usize).min(MAX_APPROVERS);
    for i in 0..count {
        let off = asset::APPROVERS + i * 32;
        if &asset_data[off..off + 32] == key {
            return Some(i as u8);
        }
    }
    None
}

#[inline(always)]
pub fn leg_offset(i: usize) -> usize {
    intent::LEGS + i * leg::LEN
}
