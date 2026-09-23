/// TBILL on Sui: a coin whose only mint/burn authority is an Ika dWallet that is itself
/// controlled by the issuer-ledger program on Solana.
///
/// The ledger computes a 161-byte *raw authorization message* for every leg it approves
/// (see `programs/issuer-ledger/src/digest.rs`):
///
///   "IKA_RWA_AUTH_V1" || domain(32) || action(1) || amount(8 LE) || account_len(1) ||
///   account(64, zero padded) || nonce(8 LE) || ledger(32)
///
/// The Ika network signs those exact bytes with the dWallet's Ed25519 key. Anyone can relay
/// the message + signature here; the module verifies the signature, checks that the message
/// was produced for *this* ledger and *this* chain (domain), consumes the nonce, and mints to
/// (or burns from) `account`. The relayer cannot change a byte, and nothing can be minted that
/// the Solana ledger did not authorize.
#[allow(deprecated_usage)]
module tbill::tbill;

use sui::address;
use sui::coin::{Self, Coin, TreasuryCap};
use sui::ed25519;
use sui::event;
use sui::table::{Self, Table};

// ───────────────────────────── errors ─────────────────────────────
const EInvalidSignature: u64 = 0;
const EBadLength: u64 = 1;
const EBadPrefix: u64 = 2;
const EBadDomain: u64 = 3;
const EBadLedger: u64 = 4;
const EBadAction: u64 = 5;
const ENonceUsed: u64 = 6;
const EBadAccount: u64 = 7;
const EAmountMismatch: u64 = 8;
const EBadParam: u64 = 9;
const EGenesisDone: u64 = 10;

// ───────────────────────────── message layout ─────────────────────
const MESSAGE_LEN: u64 = 161;
const PREFIX: vector<u8> = b"IKA_RWA_AUTH_V1";
const OFF_DOMAIN: u64 = 15;
const OFF_ACTION: u64 = 47;
const OFF_AMOUNT: u64 = 48;
const OFF_ACCOUNT_LEN: u64 = 56;
const OFF_ACCOUNT: u64 = 57;
const OFF_NONCE: u64 = 121;
const OFF_LEDGER: u64 = 129;

const ACTION_MINT: u8 = 0;
const ACTION_BURN: u8 = 1;
const DECIMALS: u8 = 6;

/// One-time witness for the coin.
public struct TBILL has drop {}

/// Held by the issuer's operations key; only used to (re)point the controller at a dWallet
/// after the Ika pre-alpha wipes its state, or to bind a fresh ledger deployment.
public struct AdminCap has key, store { id: UID }

/// Shared object holding the TreasuryCap. Minting and burning go through
/// `mint_with_authorization` / `burn_with_authorization` only.
public struct MintController has key {
    id: UID,
    treasury: TreasuryCap<TBILL>,
    /// Ed25519 public key of the Ika dWallet (32 bytes).
    dwallet_pubkey: vector<u8>,
    /// Solana Asset PDA the authorizations must reference (32 bytes).
    ledger: vector<u8>,
    /// Per-chain domain separator stored in the ledger's ChainDeployment (32 bytes).
    domain: vector<u8>,
    /// Consumed nonces: `(intent_index << 1) | leg_index`.
    used_nonces: Table<u64, bool>,
    /// Set once the starting supply has been minted.
    genesis_done: bool,
}

/// Emitted for every consumed authorization.
public struct Authorized has copy, drop {
    action: u8,
    amount: u64,
    account: address,
    nonce: u64,
    relayer: address,
}

/// Decoded authorization.
public struct Authorization has copy, drop {
    action: u8,
    amount: u64,
    account: address,
    nonce: u64,
}

fun init(witness: TBILL, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness,
        DECIMALS,
        b"TBILL",
        b"Tokenized T-Bill",
        b"Ika issuer-ledger demo asset; mint/burn authority is a policy-controlled Ika dWallet",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    transfer::share_object(MintController {
        id: object::new(ctx),
        treasury,
        dwallet_pubkey: vector[],
        ledger: vector[],
        domain: vector[],
        used_nonces: table::new(ctx),
        genesis_done: false,
    });
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

// ───────────────────────────── admin ─────────────────────────────

/// Bind the controller to a dWallet key, a ledger and a domain separator (all 32 bytes).
public fun set_params(
    _: &AdminCap,
    ctrl: &mut MintController,
    dwallet_pubkey: vector<u8>,
    ledger: vector<u8>,
    domain: vector<u8>,
) {
    assert!(dwallet_pubkey.length() == 32 && ledger.length() == 32 && domain.length() == 32, EBadParam);
    ctrl.dwallet_pubkey = dwallet_pubkey;
    ctrl.ledger = ledger;
    ctrl.domain = domain;
}

/// Mint the chain's starting supply to its treasury, once. The Solana ledger records the same
/// amount for Sui when the chain is registered, so the two start equal.
public fun genesis_mint(_: &AdminCap, ctrl: &mut MintController, amount: u64, to: address, ctx: &mut TxContext) {
    assert!(!ctrl.genesis_done, EGenesisDone);
    ctrl.genesis_done = true;
    if (amount > 0) transfer::public_transfer(coin::mint(&mut ctrl.treasury, amount, ctx), to);
}

/// Rotate only the dWallet key (e.g. after an Ika pre-alpha wipe).
public fun set_dwallet_pubkey(_: &AdminCap, ctrl: &mut MintController, dwallet_pubkey: vector<u8>) {
    assert!(dwallet_pubkey.length() == 32, EBadParam);
    ctrl.dwallet_pubkey = dwallet_pubkey;
}

// ───────────────────────────── entry points ──────────────────────

/// Mint `amount` to `account` as authorized by the Solana ledger and signed by the dWallet.
public fun mint_with_authorization(
    ctrl: &mut MintController,
    message: vector<u8>,
    signature: vector<u8>,
    ctx: &mut TxContext,
) {
    let auth = verify_and_consume(ctrl, &message, &signature);
    assert!(auth.action == ACTION_MINT, EBadAction);
    let minted = coin::mint(&mut ctrl.treasury, auth.amount, ctx);
    transfer::public_transfer(minted, auth.account);
    event::emit(Authorized { action: auth.action, amount: auth.amount, account: auth.account, nonce: auth.nonce, relayer: ctx.sender() });
}

/// Burn `coin` (exactly `amount`, owned by `account`) as authorized by the ledger.
public fun burn_with_authorization(
    ctrl: &mut MintController,
    message: vector<u8>,
    signature: vector<u8>,
    coin: Coin<TBILL>,
    ctx: &mut TxContext,
) {
    let auth = verify_and_consume(ctrl, &message, &signature);
    assert!(auth.action == ACTION_BURN, EBadAction);
    assert!(auth.account == ctx.sender(), EBadAccount);
    assert!(coin::value(&coin) == auth.amount, EAmountMismatch);
    coin::burn(&mut ctrl.treasury, coin);
    event::emit(Authorized { action: auth.action, amount: auth.amount, account: auth.account, nonce: auth.nonce, relayer: ctx.sender() });
}

// ───────────────────────────── views ─────────────────────────────

public fun total_supply(ctrl: &MintController): u64 { coin::total_supply(&ctrl.treasury) }
public fun dwallet_pubkey(ctrl: &MintController): vector<u8> { ctrl.dwallet_pubkey }
public fun ledger(ctrl: &MintController): vector<u8> { ctrl.ledger }
public fun domain(ctrl: &MintController): vector<u8> { ctrl.domain }
public fun nonce_used(ctrl: &MintController, nonce: u64): bool { table::contains(&ctrl.used_nonces, nonce) }

public fun authorization_action(a: &Authorization): u8 { a.action }
public fun authorization_amount(a: &Authorization): u64 { a.amount }
public fun authorization_account(a: &Authorization): address { a.account }
public fun authorization_nonce(a: &Authorization): u64 { a.nonce }

// ───────────────────────────── internals ─────────────────────────

fun verify_and_consume(ctrl: &mut MintController, message: &vector<u8>, signature: &vector<u8>): Authorization {
    assert!(ed25519::ed25519_verify(signature, &ctrl.dwallet_pubkey, message), EInvalidSignature);
    let auth = parse(ctrl, message);
    assert!(!table::contains(&ctrl.used_nonces, auth.nonce), ENonceUsed);
    table::add(&mut ctrl.used_nonces, auth.nonce, true);
    auth
}

/// Decode and validate a raw authorization message against this controller's ledger/domain.
public fun parse(ctrl: &MintController, message: &vector<u8>): Authorization {
    assert!(message.length() == MESSAGE_LEN, EBadLength);
    assert!(slice(message, 0, OFF_DOMAIN) == PREFIX, EBadPrefix);
    assert!(slice(message, OFF_DOMAIN, 32) == ctrl.domain, EBadDomain);
    assert!(slice(message, OFF_LEDGER, 32) == ctrl.ledger, EBadLedger);
    let action = message[OFF_ACTION];
    assert!(action == ACTION_MINT || action == ACTION_BURN, EBadAction);
    // Sui accounts are 32-byte addresses.
    assert!(message[OFF_ACCOUNT_LEN] == 32, EBadAccount);
    Authorization {
        action,
        amount: read_u64_le(message, OFF_AMOUNT),
        account: address::from_bytes(slice(message, OFF_ACCOUNT, 32)),
        nonce: read_u64_le(message, OFF_NONCE),
    }
}

fun slice(v: &vector<u8>, start: u64, len: u64): vector<u8> {
    let mut out = vector[];
    let mut i = 0;
    while (i < len) {
        out.push_back(v[start + i]);
        i = i + 1;
    };
    out
}

fun read_u64_le(v: &vector<u8>, off: u64): u64 {
    let mut n: u64 = 0;
    let mut i = 0;
    while (i < 8) {
        n = n | ((v[off + i] as u64) << ((8 * i) as u8));
        i = i + 1;
    };
    n
}

// ───────────────────────────── test hooks ────────────────────────

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(TBILL {}, ctx) }

/// Test-only: skip signature verification (parsing + nonce logic still enforced).
#[test_only]
public fun mint_unverified_for_testing(ctrl: &mut MintController, message: vector<u8>, ctx: &mut TxContext) {
    let auth = parse(ctrl, &message);
    assert!(!table::contains(&ctrl.used_nonces, auth.nonce), ENonceUsed);
    table::add(&mut ctrl.used_nonces, auth.nonce, true);
    assert!(auth.action == ACTION_MINT, EBadAction);
    let minted = coin::mint(&mut ctrl.treasury, auth.amount, ctx);
    transfer::public_transfer(minted, auth.account);
}
