//! Instruction processors.

use pinocchio::{
    AccountView, Address, ProgramResult,
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{Sysvar, clock::Clock, rent::Rent},
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token_2022::instructions::{Burn, MintTo};

use crate::{
    digest::{Authorization, leg_nonce, message_digest},
    error::LedgerError,
    ika::{self, DWalletContext},
    state::{
        ADDR_BYTES, ADDR_LEN, DISC_ASSET, DISC_CHAIN, DISC_INTENT, MAX_ALLOWLIST, MAX_APPROVERS,
        SEED_ASSET, SEED_CHAIN, SEED_INTENT, SEED_MINT_AUTHORITY, VERSION, allowlist_contains,
        approver_index, asset, chain, intent, leg, leg_offset, read_32, read_addr, read_i64,
        read_u16, read_u64, write_addr, write_i64, write_u16, write_u64,
    },
};

// ───────────────────────────── shared helpers ─────────────────────────────

#[inline(always)]
fn now() -> Result<i64, ProgramError> {
    Ok(Clock::get()?.unix_timestamp)
}

/// Verify an account is owned by this program and carries `disc`.
fn check_account(acc: &AccountView, program_id: &Address, disc: u8, len: usize) -> ProgramResult {
    if !acc.owned_by(program_id) || acc.data_len() != len {
        return Err(LedgerError::InvalidAccount.into());
    }
    let d = acc.try_borrow()?;
    if d[0] != disc {
        return Err(LedgerError::InvalidAccount.into());
    }
    Ok(())
}

fn require_signer(acc: &AccountView) -> ProgramResult {
    if !acc.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

fn require_writable(acc: &AccountView) -> ProgramResult {
    if !acc.is_writable() {
        return Err(ProgramError::InvalidArgument);
    }
    Ok(())
}

/// Create a rent-exempt PDA owned by this program.
fn create_pda(
    payer: &AccountView,
    target: &AccountView,
    space: usize,
    program_id: &Address,
    seeds: &[Seed],
) -> ProgramResult {
    if !target.is_data_empty() {
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let lamports = Rent::get()?.try_minimum_balance(space)?;
    let signer = Signer::from(seeds);
    CreateAccount {
        from: payer,
        to: target,
        lamports,
        space: space as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])
}

fn take(data: &[u8], off: usize, len: usize) -> Result<&[u8], ProgramError> {
    data.get(off..off + len)
        .ok_or(ProgramError::InvalidInstructionData)
}

fn read_addr_arg(data: &[u8], off: usize) -> Result<&[u8], ProgramError> {
    let len = *data.get(off).ok_or(ProgramError::InvalidInstructionData)? as usize;
    if len > ADDR_BYTES {
        return Err(LedgerError::InvalidLength.into());
    }
    take(data, off + 1, ADDR_BYTES)?;
    Ok(&data[off + 1..off + 1 + len])
}

/// Signer must be admin, executor or an approver of the asset.
fn require_operator(asset_data: &[u8], signer: &AccountView) -> ProgramResult {
    require_signer(signer)?;
    let key = signer.address().as_array();
    if &asset_data[asset::ADMIN..asset::ADMIN + 32] == key
        || &asset_data[asset::EXECUTOR..asset::EXECUTOR + 32] == key
        || approver_index(asset_data, key).is_some()
    {
        Ok(())
    } else {
        Err(LedgerError::Unauthorized.into())
    }
}

// ───────────────────────────── 0: InitAsset ───────────────────────────────

/// Data: `create_key(32) | symbol(8) | decimals(1) | threshold(1) | timelock_secs(8) |
///        global_cap(8) | executor(32) | ika_program(32) | bump(1) | mint_authority_bump(1) |
///        approver_count(1) | approvers(32*n)`
///
/// Accounts: `asset(w)`, `admin(s)`, `payer(ws)`, `system_program`
pub fn init_asset(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let [asset_acc, admin, payer, _system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    require_signer(admin)?;
    require_signer(payer)?;
    require_writable(asset_acc)?;

    let create_key: [u8; 32] = take(data, 0, 32)?.try_into().unwrap();
    let symbol = take(data, 32, 8)?;
    let decimals = data[40];
    let threshold = data[41];
    let timelock_secs = read_u64(take(data, 42, 8)?, 0);
    let global_cap = read_u64(take(data, 50, 8)?, 0);
    let executor = take(data, 58, 32)?;
    let ika_program = take(data, 90, 32)?;
    let bump = *data.get(122).ok_or(ProgramError::InvalidInstructionData)?;
    let mint_authority_bump = *data.get(123).ok_or(ProgramError::InvalidInstructionData)?;
    let approver_count = *data.get(124).ok_or(ProgramError::InvalidInstructionData)? as usize;
    if approver_count == 0 || approver_count > MAX_APPROVERS {
        return Err(LedgerError::InvalidConfig.into());
    }
    if threshold == 0 || threshold as usize > approver_count {
        return Err(LedgerError::InvalidConfig.into());
    }
    let approvers = take(data, 125, approver_count * 32)?;

    let bump_bytes = [bump];
    let seeds = [
        Seed::from(SEED_ASSET),
        Seed::from(&create_key),
        Seed::from(&bump_bytes),
    ];
    create_pda(payer, asset_acc, asset::LEN, program_id, &seeds)?;

    let mut d = asset_acc.try_borrow_mut()?;
    d[0] = DISC_ASSET;
    d[1] = VERSION;
    d[asset::CREATE_KEY..asset::CREATE_KEY + 32].copy_from_slice(&create_key);
    d[asset::ADMIN..asset::ADMIN + 32].copy_from_slice(admin.address().as_array());
    d[asset::EXECUTOR..asset::EXECUTOR + 32].copy_from_slice(executor);
    d[asset::SYMBOL..asset::SYMBOL + 8].copy_from_slice(symbol);
    d[asset::DECIMALS] = decimals;
    d[asset::THRESHOLD] = threshold;
    d[asset::APPROVER_COUNT] = approver_count as u8;
    d[asset::CHAIN_COUNT] = 0;
    write_u64(&mut d, asset::GLOBAL_CAP, global_cap);
    write_u64(&mut d, asset::AUTHORIZED_TOTAL, 0);
    write_u64(&mut d, asset::INTENT_COUNT, 0);
    write_u64(&mut d, asset::TIMELOCK_SECS, timelock_secs);
    d[asset::APPROVERS..asset::APPROVERS + approver_count * 32].copy_from_slice(approvers);
    d[asset::BUMP] = bump;
    d[asset::MINT_AUTHORITY_BUMP] = mint_authority_bump;
    d[asset::IKA_PROGRAM..asset::IKA_PROGRAM + 32].copy_from_slice(ika_program);
    Ok(())
}

// ───────────────────────────── 1: AddChain ────────────────────────────────

/// Data: `chain_id(2) | leg_kind(1) | encoding(1) | curve(2) | scheme(2) | dwallet(32) |
///        dwallet_pubkey_len(1) | dwallet_pubkey(65) | contract_len(1) | contract(64) |
///        domain_separator(32) | cap(8) | authorized(8) | bump(1) | allowlist_count(1) |
///        allowlist entries (len(1) | bytes(64)) * n`
///
/// Accounts: `asset(w)`, `chain(w)`, `admin(s)`, `payer(ws)`, `system_program`
pub fn add_chain(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [asset_acc, chain_acc, admin, payer, _system_program, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    check_account(asset_acc, program_id, DISC_ASSET, asset::LEN)?;
    require_signer(admin)?;
    require_signer(payer)?;
    require_writable(asset_acc)?;
    require_writable(chain_acc)?;
    {
        let a = asset_acc.try_borrow()?;
        if &a[asset::ADMIN..asset::ADMIN + 32] != admin.address().as_array() {
            return Err(LedgerError::Unauthorized.into());
        }
    }

    let chain_id = read_u16(take(data, 0, 2)?, 0);
    let leg_kind = data[2];
    let encoding = data[3];
    let curve = read_u16(take(data, 4, 2)?, 0);
    let scheme = read_u16(take(data, 6, 2)?, 0);
    let dwallet = take(data, 8, 32)?;
    let dwallet_pubkey_len = data[40];
    let dwallet_pubkey = take(data, 41, 65)?;
    let contract = read_addr_arg(data, 106)?;
    let domain_separator = take(data, 171, 32)?;
    let cap = read_u64(take(data, 203, 8)?, 0);
    let authorized = read_u64(take(data, 211, 8)?, 0);
    let bump = *data.get(219).ok_or(ProgramError::InvalidInstructionData)?;
    let allowlist_count = *data.get(220).ok_or(ProgramError::InvalidInstructionData)? as usize;
    if chain_id == 0 || leg_kind > chain::LEG_KIND_IKA_FOREIGN || encoding > chain::ENCODING_EIP712
    {
        return Err(LedgerError::InvalidChain.into());
    }
    if allowlist_count > MAX_ALLOWLIST || dwallet_pubkey_len > 65 || authorized > cap {
        return Err(LedgerError::InvalidConfig.into());
    }
    take(data, 221, allowlist_count * ADDR_LEN)?;

    let chain_id_bytes = chain_id.to_le_bytes();
    let bump_bytes = [bump];
    let seeds = [
        Seed::from(SEED_CHAIN),
        Seed::from(asset_acc.address().as_array()),
        Seed::from(&chain_id_bytes),
        Seed::from(&bump_bytes),
    ];
    create_pda(payer, chain_acc, chain::LEN, program_id, &seeds)?;

    {
        let mut d = chain_acc.try_borrow_mut()?;
        d[0] = DISC_CHAIN;
        d[1] = VERSION;
        d[chain::ASSET..chain::ASSET + 32].copy_from_slice(asset_acc.address().as_array());
        write_u16(&mut d, chain::CHAIN_ID, chain_id);
        d[chain::LEG_KIND] = leg_kind;
        d[chain::ENCODING] = encoding;
        write_u16(&mut d, chain::CURVE, curve);
        write_u16(&mut d, chain::SIGNATURE_SCHEME, scheme);
        d[chain::DWALLET..chain::DWALLET + 32].copy_from_slice(dwallet);
        d[chain::DWALLET_PUBKEY_LEN] = dwallet_pubkey_len;
        d[chain::DWALLET_PUBKEY..chain::DWALLET_PUBKEY + 65].copy_from_slice(dwallet_pubkey);
        write_addr(&mut d, chain::CONTRACT, contract);
        d[chain::DOMAIN_SEPARATOR..chain::DOMAIN_SEPARATOR + 32].copy_from_slice(domain_separator);
        write_u64(&mut d, chain::AUTHORIZED, authorized);
        write_u64(&mut d, chain::CAP, cap);
        d[chain::ALLOWLIST_COUNT] = allowlist_count as u8;
        for i in 0..allowlist_count {
            let entry = read_addr_arg(data, 221 + i * ADDR_LEN)?;
            write_addr(&mut d, chain::ALLOWLIST + i * ADDR_LEN, entry);
        }
        d[chain::BUMP] = bump;
    }

    // Seeded supply counts toward the global authorized total.
    let mut a = asset_acc.try_borrow_mut()?;
    let total = read_u64(&a, asset::AUTHORIZED_TOTAL)
        .checked_add(authorized)
        .ok_or(LedgerError::Overflow)?;
    if total > read_u64(&a, asset::GLOBAL_CAP) {
        return Err(LedgerError::GlobalCapExceeded.into());
    }
    write_u64(&mut a, asset::AUTHORIZED_TOTAL, total);
    a[asset::CHAIN_COUNT] = a[asset::CHAIN_COUNT]
        .checked_add(1)
        .ok_or(LedgerError::Overflow)?;
    Ok(())
}

// ─────────────────────────── 2: CreateIntent ──────────────────────────────

/// Data: `kind(1) | amount(8) | src_chain(2) | dst_chain(2) | recipient(1+64) |
///        source(1+64) | memo(32) | bump(1)` = 176 bytes
///
/// Accounts: `asset(w)`, `intent(w)`, `proposer(s)`, `payer(ws)`, `system_program`,
/// then `dst_chain` (Mint), `src_chain` (Burn), or `src_chain, dst_chain` (Move).
///
/// Every policy rule is evaluated here; a failing rule aborts with its error code.
pub fn create_intent(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let [
        asset_acc,
        intent_acc,
        proposer,
        payer,
        _system_program,
        chains @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    check_account(asset_acc, program_id, DISC_ASSET, asset::LEN)?;
    require_signer(proposer)?;
    require_signer(payer)?;
    require_writable(asset_acc)?;
    require_writable(intent_acc)?;

    let kind = *data.first().ok_or(ProgramError::InvalidInstructionData)?;
    let amount = read_u64(take(data, 1, 8)?, 0);
    let src_chain = read_u16(take(data, 9, 2)?, 0);
    let dst_chain = read_u16(take(data, 11, 2)?, 0);
    let recipient = read_addr_arg(data, 13)?;
    let source = read_addr_arg(data, 78)?;
    let memo = take(data, 143, 32)?;
    let bump = *data.get(175).ok_or(ProgramError::InvalidInstructionData)?;

    // Rule: amount > 0.
    if amount == 0 {
        return Err(LedgerError::ZeroAmount.into());
    }

    let (index, global_cap, authorized_total) = {
        let a = asset_acc.try_borrow()?;
        // Proposer must be an approver (an issuer operator).
        if approver_index(&a, proposer.address().as_array()).is_none() {
            return Err(LedgerError::NotApprover.into());
        }
        (
            read_u64(&a, asset::INTENT_COUNT),
            read_u64(&a, asset::GLOBAL_CAP),
            read_u64(&a, asset::AUTHORIZED_TOTAL),
        )
    };

    // Resolve chain accounts by kind and evaluate rules.
    let (src, dst): (Option<&AccountView>, Option<&AccountView>) = match kind {
        intent::KIND_MINT => (None, chains.first()),
        intent::KIND_BURN => (chains.first(), None),
        intent::KIND_MOVE => (chains.first(), chains.get(1)),
        _ => return Err(LedgerError::InvalidIntentKind.into()),
    };
    if kind == intent::KIND_MOVE && src_chain == dst_chain {
        return Err(LedgerError::SameChain.into());
    }

    if let Some(s) = src {
        let sd = load_chain(s, program_id, asset_acc.address(), src_chain)?;
        // Rule: sufficient supply on the source chain.
        if read_u64(&sd, chain::AUTHORIZED) < amount {
            return Err(LedgerError::InsufficientSupply.into());
        }
        if sd[chain::LEG_KIND] == chain::LEG_KIND_SOLANA_NATIVE && source.len() != 32 {
            return Err(LedgerError::InvalidLength.into());
        }
    } else if kind != intent::KIND_MINT {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    if let Some(d) = dst {
        let dd = load_chain(d, program_id, asset_acc.address(), dst_chain)?;
        // Rule: global cap (mint only; a move does not change the total).
        if kind == intent::KIND_MINT {
            let new_total = authorized_total
                .checked_add(amount)
                .ok_or(LedgerError::Overflow)?;
            if new_total > global_cap {
                return Err(LedgerError::GlobalCapExceeded.into());
            }
        }
        // Rule: per-chain cap on the destination.
        let new_chain = read_u64(&dd, chain::AUTHORIZED)
            .checked_add(amount)
            .ok_or(LedgerError::Overflow)?;
        if new_chain > read_u64(&dd, chain::CAP) {
            return Err(LedgerError::ChainCapExceeded.into());
        }
        // Rule: recipient allowlist.
        if !allowlist_contains(&dd, recipient) {
            return Err(LedgerError::RecipientNotAllowlisted.into());
        }
    } else if kind != intent::KIND_BURN {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    // Create the Intent PDA.
    let index_bytes = index.to_le_bytes();
    let bump_bytes = [bump];
    let seeds = [
        Seed::from(SEED_INTENT),
        Seed::from(asset_acc.address().as_array()),
        Seed::from(&index_bytes),
        Seed::from(&bump_bytes),
    ];
    create_pda(payer, intent_acc, intent::LEN, program_id, &seeds)?;

    let ts = now()?;
    {
        let mut d = intent_acc.try_borrow_mut()?;
        d[0] = DISC_INTENT;
        d[1] = VERSION;
        d[intent::ASSET..intent::ASSET + 32].copy_from_slice(asset_acc.address().as_array());
        write_u64(&mut d, intent::INDEX, index);
        d[intent::KIND] = kind;
        d[intent::STATUS] = intent::STATUS_PENDING_APPROVAL;
        d[intent::PROPOSER..intent::PROPOSER + 32].copy_from_slice(proposer.address().as_array());
        write_u64(&mut d, intent::AMOUNT, amount);
        write_u16(&mut d, intent::SRC_CHAIN, src_chain);
        write_u16(&mut d, intent::DST_CHAIN, dst_chain);
        write_addr(&mut d, intent::RECIPIENT, recipient);
        write_addr(&mut d, intent::SOURCE, source);
        d[intent::MEMO..intent::MEMO + 32].copy_from_slice(memo);
        write_i64(&mut d, intent::CREATED_AT, ts);
        write_i64(&mut d, intent::APPROVED_AT, 0);
        d[intent::APPROVALS_BITMAP] = 0;
        d[intent::APPROVAL_COUNT] = 0;
        d[intent::BUMP] = bump;

        // Legs.
        let mut n = 0usize;
        if kind == intent::KIND_BURN || kind == intent::KIND_MOVE {
            let off = leg_offset(n);
            d[off + leg::ACTION] = leg::ACTION_BURN;
            write_u16(&mut d, off + leg::CHAIN_ID, src_chain);
            d[off + leg::STATUS] = leg::STATUS_PENDING;
            n += 1;
        }
        if kind == intent::KIND_MINT || kind == intent::KIND_MOVE {
            let off = leg_offset(n);
            d[off + leg::ACTION] = leg::ACTION_MINT;
            write_u16(&mut d, off + leg::CHAIN_ID, dst_chain);
            d[off + leg::STATUS] = leg::STATUS_PENDING;
            n += 1;
        }
        d[intent::LEG_COUNT] = n as u8;
    }

    let mut a = asset_acc.try_borrow_mut()?;
    write_u64(
        &mut a,
        asset::INTENT_COUNT,
        index.checked_add(1).ok_or(LedgerError::Overflow)?,
    );
    Ok(())
}

/// Validate a ChainDeployment account against the asset and expected chain id
/// and return a copy of its data.
fn load_chain(
    acc: &AccountView,
    program_id: &Address,
    asset_key: &Address,
    chain_id: u16,
) -> Result<[u8; chain::LEN], ProgramError> {
    check_account(acc, program_id, DISC_CHAIN, chain::LEN)?;
    let d = acc.try_borrow()?;
    if &d[chain::ASSET..chain::ASSET + 32] != asset_key.as_array() {
        return Err(LedgerError::InvalidAccount.into());
    }
    if read_u16(&d, chain::CHAIN_ID) != chain_id {
        return Err(LedgerError::ChainMismatch.into());
    }
    let mut out = [0u8; chain::LEN];
    out.copy_from_slice(&d);
    Ok(out)
}

// ─────────────────────────── 3: ApproveIntent ─────────────────────────────

/// Data: none. Accounts: `asset`, `intent(w)`, `approver(s)`.
pub fn approve_intent(
    program_id: &Address,
    accounts: &mut [AccountView],
    _data: &[u8],
) -> ProgramResult {
    let [asset_acc, intent_acc, approver, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    check_account(asset_acc, program_id, DISC_ASSET, asset::LEN)?;
    check_account(intent_acc, program_id, DISC_INTENT, intent::LEN)?;
    require_signer(approver)?;
    require_writable(intent_acc)?;

    let (idx, threshold) = {
        let a = asset_acc.try_borrow()?;
        let idx =
            approver_index(&a, approver.address().as_array()).ok_or(LedgerError::NotApprover)?;
        (idx, a[asset::THRESHOLD])
    };

    let mut d = intent_acc.try_borrow_mut()?;
    if &d[intent::ASSET..intent::ASSET + 32] != asset_acc.address().as_array() {
        return Err(LedgerError::InvalidAccount.into());
    }
    if d[intent::STATUS] != intent::STATUS_PENDING_APPROVAL {
        return Err(LedgerError::InvalidStatus.into());
    }
    if &d[intent::PROPOSER..intent::PROPOSER + 32] == approver.address().as_array() {
        return Err(LedgerError::ProposerCannotApprove.into());
    }
    let bit = 1u8 << idx;
    if d[intent::APPROVALS_BITMAP] & bit != 0 {
        return Err(LedgerError::AlreadyApproved.into());
    }
    d[intent::APPROVALS_BITMAP] |= bit;
    let count = d[intent::APPROVAL_COUNT]
        .checked_add(1)
        .ok_or(LedgerError::Overflow)?;
    d[intent::APPROVAL_COUNT] = count;
    if count >= threshold {
        d[intent::STATUS] = intent::STATUS_APPROVED;
        write_i64(&mut d, intent::APPROVED_AT, now()?);
    }
    Ok(())
}

// ──────────────────────────── 4: ExecuteLeg ───────────────────────────────

/// Data: `leg_index(1) | message_approval_bump(1) | cpi_authority_bump(1)`
///
/// Accounts: `asset(w)`, `intent(w)`, `chain(w)`, `authority(s)`, `payer(ws)`, `system_program`, then
/// * Solana-native leg: `token_program`, `mint(w)`, `token_account(w)`, `mint_authority`
/// * Ika foreign leg: `dwallet_program`, `coordinator`, `message_approval(w)`, `dwallet`,
///   `this_program`, `cpi_authority`
pub fn execute_leg(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let [
        asset_acc,
        intent_acc,
        chain_acc,
        authority,
        payer,
        system_program,
        extra @ ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    check_account(asset_acc, program_id, DISC_ASSET, asset::LEN)?;
    check_account(intent_acc, program_id, DISC_INTENT, intent::LEN)?;
    require_signer(payer)?;
    require_writable(asset_acc)?;
    require_writable(intent_acc)?;
    require_writable(chain_acc)?;

    let leg_index = *data.first().ok_or(ProgramError::InvalidInstructionData)? as usize;
    let message_approval_bump = *data.get(1).ok_or(ProgramError::InvalidInstructionData)?;
    let cpi_authority_bump = *data.get(2).ok_or(ProgramError::InvalidInstructionData)?;

    // ── read everything we need, then drop the borrows before any CPI ──
    let a: [u8; asset::LEN] = {
        let d = asset_acc.try_borrow()?;
        require_operator(&d, authority)?;
        let mut out = [0u8; asset::LEN];
        out.copy_from_slice(&d);
        out
    };
    let it: [u8; intent::LEN] = {
        let d = intent_acc.try_borrow()?;
        let mut out = [0u8; intent::LEN];
        out.copy_from_slice(&d);
        out
    };
    if &it[intent::ASSET..intent::ASSET + 32] != asset_acc.address().as_array() {
        return Err(LedgerError::InvalidAccount.into());
    }
    let leg_count = it[intent::LEG_COUNT] as usize;
    if leg_index >= leg_count {
        return Err(ProgramError::InvalidInstructionData);
    }
    let status = it[intent::STATUS];
    if status != intent::STATUS_APPROVED && status != intent::STATUS_EXECUTING {
        return Err(LedgerError::InvalidStatus.into());
    }
    // Rule: approval threshold (defensive; status Approved implies it).
    if it[intent::APPROVAL_COUNT] < a[asset::THRESHOLD] {
        return Err(LedgerError::ThresholdNotMet.into());
    }
    // Rule: timelock.
    let ts = now()?;
    let unlock = read_i64(&it, intent::APPROVED_AT)
        .checked_add(read_u64(&a, asset::TIMELOCK_SECS) as i64)
        .ok_or(LedgerError::Overflow)?;
    if ts < unlock {
        return Err(LedgerError::TimelockActive.into());
    }
    let lo = leg_offset(leg_index);
    if it[lo + leg::STATUS] != leg::STATUS_PENDING {
        return Err(LedgerError::InvalidStatus.into());
    }
    // Rule: for a move, the burn leg must be confirmed before the mint leg.
    if leg_index > 0 {
        let prev = leg_offset(leg_index - 1);
        if it[prev + leg::STATUS] != leg::STATUS_CONFIRMED {
            return Err(LedgerError::LegNotReady.into());
        }
    }
    let action = it[lo + leg::ACTION];
    let chain_id = read_u16(&it, lo + leg::CHAIN_ID);
    let amount = read_u64(&it, intent::AMOUNT);
    let kind = it[intent::KIND];
    let ch = load_chain(chain_acc, program_id, asset_acc.address(), chain_id)?;

    // Re-run supply rules against the current ledger.
    let chain_authorized = read_u64(&ch, chain::AUTHORIZED);
    let total = read_u64(&a, asset::AUTHORIZED_TOTAL);
    let (new_chain_authorized, new_total) = if action == leg::ACTION_MINT {
        let nc = chain_authorized
            .checked_add(amount)
            .ok_or(LedgerError::Overflow)?;
        if nc > read_u64(&ch, chain::CAP) {
            return Err(LedgerError::ChainCapExceeded.into());
        }
        let nt = if kind == intent::KIND_MINT {
            let nt = total.checked_add(amount).ok_or(LedgerError::Overflow)?;
            if nt > read_u64(&a, asset::GLOBAL_CAP) {
                return Err(LedgerError::GlobalCapExceeded.into());
            }
            nt
        } else {
            total
        };
        (nc, nt)
    } else {
        let nc = chain_authorized
            .checked_sub(amount)
            .ok_or(LedgerError::InsufficientSupply)?;
        let nt = if kind == intent::KIND_BURN {
            total
                .checked_sub(amount)
                .ok_or(LedgerError::InsufficientSupply)?
        } else {
            total
        };
        (nc, nt)
    };
    let account_bytes: &[u8] = if action == leg::ACTION_MINT {
        read_addr(&it, intent::RECIPIENT)
    } else {
        read_addr(&it, intent::SOURCE)
    };

    let mut message_digest_out = [0u8; 32];
    let mut message_approval_out = [0u8; 32];
    let mut new_leg_status = leg::STATUS_AUTHORIZED;

    match ch[chain::LEG_KIND] {
        chain::LEG_KIND_SOLANA_NATIVE => {
            let [token_program, mint, token_account, mint_authority, ..] = extra else {
                return Err(ProgramError::NotEnoughAccountKeys);
            };
            if token_program.address() != &pinocchio_token_2022::ID {
                return Err(ProgramError::IncorrectProgramId);
            }
            // The chain's contract is the Token-2022 mint.
            if read_addr(&ch, chain::CONTRACT) != mint.address().as_array() {
                return Err(LedgerError::AccountMismatch.into());
            }
            if account_bytes != token_account.address().as_array() {
                return Err(LedgerError::AccountMismatch.into());
            }
            let asset_key = asset_acc.address().as_array();
            let ma_bump = [a[asset::MINT_AUTHORITY_BUMP]];
            let seeds = [
                Seed::from(SEED_MINT_AUTHORITY),
                Seed::from(asset_key),
                Seed::from(&ma_bump),
            ];
            let signer = Signer::from(&seeds);
            if action == leg::ACTION_MINT {
                MintTo::new(mint, token_account, mint_authority, amount)
                    .invoke_signed(&[signer])?;
            } else {
                // Treasury token account is owned by the mint authority PDA.
                Burn::new(token_account, mint, mint_authority, amount).invoke_signed(&[signer])?;
            }
            // The Solana transaction itself is the confirmation.
            new_leg_status = leg::STATUS_CONFIRMED;
        }
        chain::LEG_KIND_IKA_FOREIGN => {
            let [
                dwallet_program,
                coordinator,
                message_approval,
                dwallet,
                this_program,
                cpi_authority,
                ..,
            ] = extra
            else {
                return Err(ProgramError::NotEnoughAccountKeys);
            };
            if dwallet_program.address().as_array()
                != &a[asset::IKA_PROGRAM..asset::IKA_PROGRAM + 32]
            {
                return Err(ProgramError::IncorrectProgramId);
            }
            if this_program.address() != program_id {
                return Err(ProgramError::IncorrectProgramId);
            }
            if dwallet.address().as_array() != &ch[chain::DWALLET..chain::DWALLET + 32] {
                return Err(LedgerError::AccountMismatch.into());
            }
            {
                let dw = dwallet.try_borrow()?;
                if dw.first() != Some(&ika::DISC_DWALLET)
                    || dw[ika::DWALLET_STATE] != ika::DWALLET_STATE_ACTIVE
                {
                    return Err(LedgerError::InvalidAccount.into());
                }
            }
            let ledger = asset_acc.address().as_array();
            let auth = Authorization {
                action,
                amount,
                account: account_bytes,
                nonce: leg_nonce(read_u64(&it, intent::INDEX), leg_index as u8),
                ledger,
                domain_separator: &read_32(&ch, chain::DOMAIN_SEPARATOR),
            };
            let digest = message_digest(ch[chain::ENCODING], &auth);
            let user_pubkey = read_32(&a, asset::EXECUTOR);
            let scheme = read_u16(&ch, chain::SIGNATURE_SCHEME);

            let ctx = DWalletContext {
                dwallet_program,
                cpi_authority,
                caller_program: this_program,
                cpi_authority_bump,
            };
            ctx.approve_message(
                coordinator,
                message_approval,
                dwallet,
                payer,
                system_program,
                digest,
                [0u8; 32],
                user_pubkey,
                scheme,
                message_approval_bump,
            )?;
            message_digest_out = digest;
            message_approval_out = *message_approval.address().as_array();
        }
        _ => return Err(LedgerError::InvalidChainKind.into()),
    }

    // ── write back ──
    {
        let mut d = intent_acc.try_borrow_mut()?;
        d[lo + leg::STATUS] = new_leg_status;
        d[lo + leg::MESSAGE_DIGEST..lo + leg::MESSAGE_DIGEST + 32]
            .copy_from_slice(&message_digest_out);
        d[lo + leg::MESSAGE_APPROVAL..lo + leg::MESSAGE_APPROVAL + 32]
            .copy_from_slice(&message_approval_out);
        write_i64(&mut d, lo + leg::EXECUTED_AT, ts);
        if new_leg_status == leg::STATUS_CONFIRMED {
            write_i64(&mut d, lo + leg::CONFIRMED_AT, ts);
        }
        d[intent::STATUS] = if all_confirmed(&d) {
            intent::STATUS_EXECUTED
        } else {
            intent::STATUS_EXECUTING
        };
    }
    {
        let mut c = chain_acc.try_borrow_mut()?;
        write_u64(&mut c, chain::AUTHORIZED, new_chain_authorized);
    }
    {
        let mut asset_d = asset_acc.try_borrow_mut()?;
        write_u64(&mut asset_d, asset::AUTHORIZED_TOTAL, new_total);
    }
    Ok(())
}

fn all_confirmed(intent_data: &[u8]) -> bool {
    let n = intent_data[intent::LEG_COUNT] as usize;
    (0..n).all(|i| intent_data[leg_offset(i) + leg::STATUS] == leg::STATUS_CONFIRMED)
}

// ──────────────────────────── 5: ConfirmLeg ───────────────────────────────

/// Data: `leg_index(1) | dest_tx_len(1) | dest_tx(64)`
/// Accounts: `asset`, `intent(w)`, `authority(s)` (admin / executor / approver).
pub fn confirm_leg(
    program_id: &Address,
    accounts: &mut [AccountView],
    data: &[u8],
) -> ProgramResult {
    let [asset_acc, intent_acc, authority, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    check_account(asset_acc, program_id, DISC_ASSET, asset::LEN)?;
    check_account(intent_acc, program_id, DISC_INTENT, intent::LEN)?;
    require_writable(intent_acc)?;
    {
        let a = asset_acc.try_borrow()?;
        require_operator(&a, authority)?;
    }
    let leg_index = *data.first().ok_or(ProgramError::InvalidInstructionData)? as usize;
    let dest_tx = read_addr_arg(data, 1)?;

    let mut d = intent_acc.try_borrow_mut()?;
    if &d[intent::ASSET..intent::ASSET + 32] != asset_acc.address().as_array() {
        return Err(LedgerError::InvalidAccount.into());
    }
    if leg_index >= d[intent::LEG_COUNT] as usize {
        return Err(ProgramError::InvalidInstructionData);
    }
    let lo = leg_offset(leg_index);
    if d[lo + leg::STATUS] != leg::STATUS_AUTHORIZED {
        return Err(LedgerError::InvalidStatus.into());
    }
    d[lo + leg::STATUS] = leg::STATUS_CONFIRMED;
    write_addr(&mut d, lo + leg::DEST_TX, dest_tx);
    write_i64(&mut d, lo + leg::CONFIRMED_AT, now()?);
    if all_confirmed(&d) {
        d[intent::STATUS] = intent::STATUS_EXECUTED;
    }
    Ok(())
}
