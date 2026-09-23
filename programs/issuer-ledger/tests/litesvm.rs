#![allow(clippy::too_many_arguments)]
//! LiteSVM integration tests for the issuer ledger.
//!
//! Exercises the full lifecycle against the real Token-2022 program (bundled
//! with LiteSVM) and the real Ika dWallet program binary vendored from
//! `dwallet-labs/ika-pre-alpha` (`vendor/ika/ika_dwallet_program.so`).

use issuer_ledger::{
    digest::{Authorization, leg_nonce, message_digest},
    error::LedgerError,
    ika::{
        CPI_AUTHORITY_SEED, CURVE_CURVE25519, CURVE_SECP256K1, SCHEME_ECDSA_KECCAK256,
        SCHEME_EDDSA_SHA512,
    },
    state::{ADDR_BYTES, ADDR_LEN, asset, chain, intent, leg, leg_offset, read_u16, read_u64},
};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;

const LEDGER_SO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../target/deploy/issuer_ledger.so"
);
const DWALLET_SO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../vendor/ika/ika_dwallet_program.so"
);

const SYSTEM_PROGRAM: Address = Address::new_from_array([0u8; 32]);
const TOKEN_2022: Address = Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
/// Program id the vendored dWallet binary is deployed at in tests.
const DWALLET_PROGRAM: Address =
    Address::from_str_const("87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY");

// Chain ids used by the demo.
const CHAIN_SOLANA: u16 = 1;
const CHAIN_ETHEREUM: u16 = 2;
const CHAIN_SUI: u16 = 4;

const ONE: u64 = 1_000_000; // 6 decimals

// ───────────────────────────── Ika account builders ───────────────────────

fn ika_program_account(data: Vec<u8>) -> Account {
    Account {
        lamports: (data.len() as u64 + 128) * 6960,
        data,
        owner: DWALLET_PROGRAM,
        executable: false,
        rent_epoch: 0,
    }
}

fn coordinator_data(bump: u8) -> Vec<u8> {
    let mut d = vec![0u8; 116];
    d[0] = 1;
    d[1] = 1;
    d[2..34].copy_from_slice(Address::new_unique().as_array());
    d[34..42].copy_from_slice(&5u64.to_le_bytes());
    d[51] = bump;
    d
}

/// `["dwallet", chunks_of(curve_u16_le || public_key)]`
fn dwallet_seeds(curve: u16, pk: &[u8]) -> Vec<Vec<u8>> {
    let mut payload = curve.to_le_bytes().to_vec();
    payload.extend_from_slice(pk);
    let mut seeds = vec![b"dwallet".to_vec()];
    for c in payload.chunks(32) {
        seeds.push(c.to_vec());
    }
    seeds
}

fn dwallet_pda(curve: u16, pk: &[u8]) -> (Address, u8) {
    let seeds = dwallet_seeds(curve, pk);
    let refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
    Address::find_program_address(&refs, &DWALLET_PROGRAM)
}

fn message_approval_pda(curve: u16, pk: &[u8], scheme: u16, digest: &[u8; 32]) -> (Address, u8) {
    let mut seeds = dwallet_seeds(curve, pk);
    seeds.push(b"message_approval".to_vec());
    seeds.push(scheme.to_le_bytes().to_vec());
    seeds.push(digest.to_vec());
    let refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
    Address::find_program_address(&refs, &DWALLET_PROGRAM)
}

fn dwallet_data(authority: &Address, curve: u16, pk: &[u8], bump: u8) -> Vec<u8> {
    let mut d = vec![0u8; 153];
    d[0] = 2;
    d[1] = 1;
    d[2..34].copy_from_slice(authority.as_array());
    d[34..36].copy_from_slice(&curve.to_le_bytes());
    d[36] = 1; // Active
    d[37] = pk.len() as u8;
    d[38..38 + pk.len()].copy_from_slice(pk);
    d[103..111].copy_from_slice(&1u64.to_le_bytes());
    d[111..143].copy_from_slice(Address::new_unique().as_array());
    d[144] = bump;
    d
}

// ───────────────────────────── Token-2022 builders ────────────────────────

fn token_account_of(owner: &Address, data: Vec<u8>) -> Account {
    Account {
        lamports: 10_000_000,
        data,
        owner: *owner,
        executable: false,
        rent_epoch: 0,
    }
}

/// Base (82-byte) mint with `mint_authority` and no freeze authority.
fn mint_data(mint_authority: &Address, decimals: u8, supply: u64) -> Vec<u8> {
    let mut d = vec![0u8; 82];
    d[0..4].copy_from_slice(&1u32.to_le_bytes());
    d[4..36].copy_from_slice(mint_authority.as_array());
    d[36..44].copy_from_slice(&supply.to_le_bytes());
    d[44] = decimals;
    d[45] = 1;
    d
}

/// Base (165-byte) token account.
fn token_account_data(mint: &Address, owner: &Address, amount: u64) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_array());
    d[32..64].copy_from_slice(owner.as_array());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1; // Initialized
    d
}

// ───────────────────────────── ledger helpers ─────────────────────────────

struct Ctx {
    svm: LiteSVM,
    program_id: Address,
    payer: Keypair,
    admin: Keypair,
    executor: Keypair,
    approvers: Vec<Keypair>,
    create_key: [u8; 32],
    asset: Address,
    mint_authority: Address,
    mint_authority_bump: u8,
    cpi_authority: Address,
    cpi_authority_bump: u8,
    coordinator: Address,
    // Solana chain
    mint: Address,
    treasury: Address,
    // Foreign chains: (dwallet pda, curve, pubkey, scheme)
    eth_dwallet: (Address, u16, Vec<u8>, u16),
    sui_dwallet: (Address, u16, Vec<u8>, u16),
}

fn padded(bytes: &[u8]) -> Vec<u8> {
    let mut v = vec![bytes.len() as u8];
    v.extend_from_slice(bytes);
    v.resize(ADDR_LEN, 0);
    v
}

impl Ctx {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let program_id = Address::new_unique();
        svm.add_program_from_file(program_id, LEDGER_SO)
            .expect("ledger .so (run cargo build-sbf first)");
        svm.add_program_from_file(DWALLET_PROGRAM, DWALLET_SO)
            .expect("dwallet .so");

        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
        let admin = Keypair::new();
        let executor = Keypair::new();
        let approvers: Vec<Keypair> = (0..3).map(|_| Keypair::new()).collect();
        for k in approvers.iter().chain([&admin, &executor]) {
            svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
        }

        let create_key = [7u8; 32];
        let (asset, _) = Address::find_program_address(&[b"asset", &create_key], &program_id);
        let (mint_authority, mint_authority_bump) =
            Address::find_program_address(&[b"mint_authority", asset.as_array()], &program_id);
        let (cpi_authority, cpi_authority_bump) =
            Address::find_program_address(&[CPI_AUTHORITY_SEED], &program_id);

        // Ika coordinator.
        let (coordinator, cbump) =
            Address::find_program_address(&[b"dwallet_coordinator"], &DWALLET_PROGRAM);
        svm.set_account(coordinator, ika_program_account(coordinator_data(cbump)))
            .unwrap();

        // dWallets owned by the ledger's CPI authority.
        let eth_pk = {
            let mut v = vec![0x02u8];
            v.extend_from_slice(&[0xE1u8; 32]);
            v
        };
        let sui_pk = vec![0x5Au8; 32];
        let (eth_dw, eth_bump) = dwallet_pda(CURVE_SECP256K1, &eth_pk);
        let (sui_dw, sui_bump) = dwallet_pda(CURVE_CURVE25519, &sui_pk);
        svm.set_account(
            eth_dw,
            ika_program_account(dwallet_data(
                &cpi_authority,
                CURVE_SECP256K1,
                &eth_pk,
                eth_bump,
            )),
        )
        .unwrap();
        svm.set_account(
            sui_dw,
            ika_program_account(dwallet_data(
                &cpi_authority,
                CURVE_CURVE25519,
                &sui_pk,
                sui_bump,
            )),
        )
        .unwrap();

        // Token-2022 mint + PDA-owned treasury.
        let mint = Address::new_unique();
        let treasury = Address::new_unique();
        svm.set_account(
            mint,
            token_account_of(&TOKEN_2022, mint_data(&mint_authority, 6, 30_000_000 * ONE)),
        )
        .unwrap();
        svm.set_account(
            treasury,
            token_account_of(
                &TOKEN_2022,
                token_account_data(&mint, &mint_authority, 30_000_000 * ONE),
            ),
        )
        .unwrap();

        Self {
            svm,
            program_id,
            payer,
            admin,
            executor,
            approvers,
            create_key,
            asset,
            mint_authority,
            mint_authority_bump,
            cpi_authority,
            cpi_authority_bump,
            coordinator,
            mint,
            treasury,
            eth_dwallet: (eth_dw, CURVE_SECP256K1, eth_pk, SCHEME_ECDSA_KECCAK256),
            sui_dwallet: (sui_dw, CURVE_CURVE25519, sui_pk, SCHEME_EDDSA_SHA512),
        }
    }

    fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), String> {
        // LiteSVM de-duplicates identical transactions; force a fresh blockhash each time.
        self.svm.expire_blockhash();
        let bh = self.svm.latest_blockhash();
        let mut all: Vec<&Keypair> = vec![&self.payer];
        all.extend_from_slice(signers);
        let tx = Transaction::new_signed_with_payer(ixs, Some(&self.payer.pubkey()), &all, bh);
        self.svm
            .send_transaction(tx)
            .map(|_| ())
            .map_err(|e| format!("{:?}\n{}", e.err, e.meta.logs.join("\n")))
    }

    fn expect_err(&mut self, ixs: &[Instruction], signers: &[&Keypair], code: LedgerError) {
        let err = self.send(ixs, signers).expect_err("expected failure");
        let needle = format!("Custom({})", code as u32);
        assert!(
            err.contains(&needle),
            "expected {:?} ({}) got: {}",
            code,
            needle,
            err
        );
    }

    fn data(&self, a: &Address) -> Vec<u8> {
        self.svm.get_account(a).expect("account").data
    }

    fn set_time(&mut self, unix_timestamp: i64) {
        let mut c: Clock = self.svm.get_sysvar();
        c.unix_timestamp = unix_timestamp;
        self.svm.set_sysvar(&c);
    }

    fn time(&self) -> i64 {
        let c: Clock = self.svm.get_sysvar();
        c.unix_timestamp
    }

    fn chain_pda(&self, chain_id: u16) -> (Address, u8) {
        Address::find_program_address(
            &[b"chain", self.asset.as_array(), &chain_id.to_le_bytes()],
            &self.program_id,
        )
    }

    fn intent_pda(&self, index: u64) -> (Address, u8) {
        Address::find_program_address(
            &[b"intent", self.asset.as_array(), &index.to_le_bytes()],
            &self.program_id,
        )
    }

    // ── instruction builders ──

    fn init_asset_ix(&self, global_cap: u64, threshold: u8, timelock: u64) -> Instruction {
        let (asset, bump) =
            Address::find_program_address(&[b"asset", &self.create_key], &self.program_id);
        assert_eq!(asset, self.asset);
        let mut d = vec![0u8];
        d.extend_from_slice(&self.create_key);
        d.extend_from_slice(b"TBILL\0\0\0");
        d.push(6);
        d.push(threshold);
        d.extend_from_slice(&timelock.to_le_bytes());
        d.extend_from_slice(&global_cap.to_le_bytes());
        d.extend_from_slice(self.executor.pubkey().as_array());
        d.extend_from_slice(DWALLET_PROGRAM.as_array());
        d.push(bump);
        d.push(self.mint_authority_bump);
        d.push(self.approvers.len() as u8);
        for a in &self.approvers {
            d.extend_from_slice(a.pubkey().as_array());
        }
        Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(self.asset, false),
                AccountMeta::new_readonly(self.admin.pubkey(), true),
                AccountMeta::new(self.payer.pubkey(), true),
                AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
            ],
            data: d,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn add_chain_ix(
        &self,
        chain_id: u16,
        leg_kind: u8,
        encoding: u8,
        curve: u16,
        scheme: u16,
        dwallet: &Address,
        dwallet_pk: &[u8],
        contract: &[u8],
        cap: u64,
        authorized: u64,
        allowlist: &[&[u8]],
    ) -> Instruction {
        let (chain_pda, bump) = self.chain_pda(chain_id);
        let mut d = vec![1u8];
        d.extend_from_slice(&chain_id.to_le_bytes());
        d.push(leg_kind);
        d.push(encoding);
        d.extend_from_slice(&curve.to_le_bytes());
        d.extend_from_slice(&scheme.to_le_bytes());
        d.extend_from_slice(dwallet.as_array());
        d.push(dwallet_pk.len() as u8);
        let mut pk = dwallet_pk.to_vec();
        pk.resize(65, 0);
        d.extend_from_slice(&pk);
        d.extend_from_slice(&padded(contract));
        d.extend_from_slice(&[0xD0u8; 32]); // domain separator
        d.extend_from_slice(&cap.to_le_bytes());
        d.extend_from_slice(&authorized.to_le_bytes());
        d.push(bump);
        d.push(allowlist.len() as u8);
        for a in allowlist {
            d.extend_from_slice(&padded(a));
        }
        Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(self.asset, false),
                AccountMeta::new(chain_pda, false),
                AccountMeta::new_readonly(self.admin.pubkey(), true),
                AccountMeta::new(self.payer.pubkey(), true),
                AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
            ],
            data: d,
        }
    }

    fn create_intent_ix(
        &self,
        index: u64,
        kind: u8,
        amount: u64,
        src: u16,
        dst: u16,
        recipient: &[u8],
        source: &[u8],
        proposer: &Address,
    ) -> Instruction {
        let (intent_pda, bump) = self.intent_pda(index);
        let mut d = vec![2u8, kind];
        d.extend_from_slice(&amount.to_le_bytes());
        d.extend_from_slice(&src.to_le_bytes());
        d.extend_from_slice(&dst.to_le_bytes());
        d.extend_from_slice(&padded(recipient));
        d.extend_from_slice(&padded(source));
        let mut memo = b"demo".to_vec();
        memo.resize(32, 0);
        d.extend_from_slice(&memo);
        d.push(bump);
        let mut accounts = vec![
            AccountMeta::new(self.asset, false),
            AccountMeta::new(intent_pda, false),
            AccountMeta::new_readonly(*proposer, true),
            AccountMeta::new(self.payer.pubkey(), true),
            AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
        ];
        match kind {
            intent::KIND_MINT => {
                accounts.push(AccountMeta::new_readonly(self.chain_pda(dst).0, false))
            }
            intent::KIND_BURN => {
                accounts.push(AccountMeta::new_readonly(self.chain_pda(src).0, false))
            }
            _ => {
                accounts.push(AccountMeta::new_readonly(self.chain_pda(src).0, false));
                accounts.push(AccountMeta::new_readonly(self.chain_pda(dst).0, false));
            }
        }
        Instruction {
            program_id: self.program_id,
            accounts,
            data: d,
        }
    }

    fn approve_ix(&self, index: u64, approver: &Address) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new_readonly(self.asset, false),
                AccountMeta::new(self.intent_pda(index).0, false),
                AccountMeta::new_readonly(*approver, true),
            ],
            data: vec![3u8],
        }
    }

    fn execute_solana_ix(
        &self,
        index: u64,
        leg_index: u8,
        chain_id: u16,
        token_account: &Address,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(self.asset, false),
                AccountMeta::new(self.intent_pda(index).0, false),
                AccountMeta::new(self.chain_pda(chain_id).0, false),
                AccountMeta::new_readonly(self.executor.pubkey(), true),
                AccountMeta::new(self.payer.pubkey(), true),
                AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
                AccountMeta::new_readonly(TOKEN_2022, false),
                AccountMeta::new(self.mint, false),
                AccountMeta::new(*token_account, false),
                AccountMeta::new_readonly(self.mint_authority, false),
            ],
            data: vec![4u8, leg_index, 0, self.cpi_authority_bump],
        }
    }

    /// Returns (ix, message_approval pda, expected digest).
    fn execute_foreign_ix(
        &self,
        index: u64,
        leg_index: u8,
        chain_id: u16,
        dw: &(Address, u16, Vec<u8>, u16),
        action: u8,
        amount: u64,
        account: &[u8],
        encoding: u8,
    ) -> (Instruction, Address, [u8; 32]) {
        let auth = Authorization {
            action,
            amount,
            account,
            nonce: leg_nonce(index, leg_index),
            ledger: self.asset.as_array(),
            domain_separator: &[0xD0u8; 32],
        };
        let digest = message_digest(encoding, &auth);
        let (ma, ma_bump) = message_approval_pda(dw.1, &dw.2, dw.3, &digest);
        let ix = Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(self.asset, false),
                AccountMeta::new(self.intent_pda(index).0, false),
                AccountMeta::new(self.chain_pda(chain_id).0, false),
                AccountMeta::new_readonly(self.executor.pubkey(), true),
                AccountMeta::new(self.payer.pubkey(), true),
                AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
                AccountMeta::new_readonly(DWALLET_PROGRAM, false),
                AccountMeta::new_readonly(self.coordinator, false),
                AccountMeta::new(ma, false),
                AccountMeta::new_readonly(dw.0, false),
                AccountMeta::new_readonly(self.program_id, false),
                AccountMeta::new_readonly(self.cpi_authority, false),
            ],
            data: vec![4u8, leg_index, ma_bump, self.cpi_authority_bump],
        };
        (ix, ma, digest)
    }

    fn confirm_ix(&self, index: u64, leg_index: u8, tx: &[u8]) -> Instruction {
        let mut d = vec![5u8, leg_index];
        d.extend_from_slice(&padded(tx));
        Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new_readonly(self.asset, false),
                AccountMeta::new(self.intent_pda(index).0, false),
                AccountMeta::new_readonly(self.executor.pubkey(), true),
            ],
            data: d,
        }
    }

    // ── scenario setup: TBILL with Solana + Ethereum + Sui ──
    fn setup_demo(&mut self) {
        let admin = Keypair::try_from(self.admin.to_bytes().as_slice()).unwrap();
        let ix = self.init_asset_ix(100_000_000 * ONE, 2, 5);
        self.send(&[ix], &[&admin]).unwrap();

        let treasury = self.treasury;
        let mint = self.mint;
        let ix = self.add_chain_ix(
            CHAIN_SOLANA,
            chain::LEG_KIND_SOLANA_NATIVE,
            chain::ENCODING_RAW,
            0,
            0,
            &Address::new_from_array([0u8; 32]),
            &[],
            mint.as_array(),
            50_000_000 * ONE,
            30_000_000 * ONE,
            &[treasury.as_array()],
        );
        self.send(&[ix], &[&admin]).unwrap();

        let (eth_dw, eth_curve, eth_pk, eth_scheme) = self.eth_dwallet.clone();
        let ix = self.add_chain_ix(
            CHAIN_ETHEREUM,
            chain::LEG_KIND_IKA_FOREIGN,
            chain::ENCODING_EIP712,
            eth_curve,
            eth_scheme,
            &eth_dw,
            &eth_pk,
            &[0xC0u8; 20],
            30_000_000 * ONE,
            20_000_000 * ONE,
            &[&ETH_TREASURY],
        );
        self.send(&[ix], &[&admin]).unwrap();

        let (sui_dw, sui_curve, sui_pk, sui_scheme) = self.sui_dwallet.clone();
        let ix = self.add_chain_ix(
            CHAIN_SUI,
            chain::LEG_KIND_IKA_FOREIGN,
            chain::ENCODING_RAW,
            sui_curve,
            sui_scheme,
            &sui_dw,
            &sui_pk,
            &[0x51u8; 32],
            15_000_000 * ONE,
            5_000_000 * ONE,
            &[&SUI_TREASURY],
        );
        self.send(&[ix], &[&admin]).unwrap();
    }

    fn approve_by(&mut self, index: u64, who: &[usize]) {
        for &i in who {
            let kp = Keypair::try_from(self.approvers[i].to_bytes().as_slice()).unwrap();
            let ix = self.approve_ix(index, &kp.pubkey());
            self.send(&[ix], &[&kp]).unwrap();
        }
    }

    fn approver(&self, i: usize) -> Keypair {
        Keypair::try_from(self.approvers[i].to_bytes().as_slice()).unwrap()
    }

    fn executor(&self) -> Keypair {
        Keypair::try_from(self.executor.to_bytes().as_slice()).unwrap()
    }

    fn totals(&self) -> (u64, u64, u64, u64) {
        let a = self.data(&self.asset);
        let s = self.data(&self.chain_pda(CHAIN_SOLANA).0);
        let e = self.data(&self.chain_pda(CHAIN_ETHEREUM).0);
        let u = self.data(&self.chain_pda(CHAIN_SUI).0);
        (
            read_u64(&a, asset::AUTHORIZED_TOTAL),
            read_u64(&s, chain::AUTHORIZED),
            read_u64(&e, chain::AUTHORIZED),
            read_u64(&u, chain::AUTHORIZED),
        )
    }
}

const ETH_TREASURY: [u8; 20] = [0xAAu8; 20];
const SUI_TREASURY: [u8; 32] = [0xBBu8; 32];

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn setup_seeds_ledger() {
    let mut ctx = Ctx::new();
    ctx.setup_demo();
    let a = ctx.data(&ctx.asset);
    assert_eq!(a[0], 1);
    assert_eq!(a[asset::APPROVER_COUNT], 3);
    assert_eq!(a[asset::THRESHOLD], 2);
    assert_eq!(a[asset::CHAIN_COUNT], 3);
    assert_eq!(read_u64(&a, asset::GLOBAL_CAP), 100_000_000 * ONE);
    assert_eq!(
        ctx.totals(),
        (
            55_000_000 * ONE,
            30_000_000 * ONE,
            20_000_000 * ONE,
            5_000_000 * ONE
        )
    );
    let e = ctx.data(&ctx.chain_pda(CHAIN_ETHEREUM).0);
    assert_eq!(read_u16(&e, chain::CHAIN_ID), CHAIN_ETHEREUM);
    assert_eq!(e[chain::ALLOWLIST_COUNT], 1);
    assert_eq!(
        &e[chain::ALLOWLIST + 1..chain::ALLOWLIST + 21],
        &ETH_TREASURY
    );
}

#[test]
fn solana_mint_full_lifecycle_with_timelock() {
    let mut ctx = Ctx::new();
    ctx.setup_demo();
    let amount = 2_500_000 * ONE;
    let proposer = ctx.approver(0);
    let treasury = ctx.treasury;
    let ix = ctx.create_intent_ix(
        0,
        intent::KIND_MINT,
        amount,
        0,
        CHAIN_SOLANA,
        treasury.as_array(),
        &[],
        &proposer.pubkey(),
    );
    ctx.send(&[ix], &[&proposer]).unwrap();

    // Not approved yet → cannot execute.
    let ix = ctx.execute_solana_ix(0, 0, CHAIN_SOLANA, &treasury);
    let ex = ctx.executor();
    ctx.expect_err(&[ix], &[&ex], LedgerError::InvalidStatus);

    ctx.approve_by(0, &[1, 2]);
    let d = ctx.data(&ctx.intent_pda(0).0);
    assert_eq!(d[intent::STATUS], intent::STATUS_APPROVED);
    assert_eq!(d[intent::APPROVAL_COUNT], 2);

    // Timelock (5s) still active.
    let ix = ctx.execute_solana_ix(0, 0, CHAIN_SOLANA, &treasury);
    ctx.expect_err(&[ix], &[&ex], LedgerError::TimelockActive);

    let t = ctx.time();
    ctx.set_time(t + 6);
    let ix = ctx.execute_solana_ix(0, 0, CHAIN_SOLANA, &treasury);
    ctx.send(&[ix], &[&ex]).unwrap();

    // Token-2022 balance minted, ledger updated, intent executed.
    let ta = ctx.data(&treasury);
    assert_eq!(
        u64::from_le_bytes(ta[64..72].try_into().unwrap()),
        30_000_000 * ONE + amount
    );
    assert_eq!(ctx.totals().0, 57_500_000 * ONE);
    assert_eq!(ctx.totals().1, 32_500_000 * ONE);
    let d = ctx.data(&ctx.intent_pda(0).0);
    assert_eq!(d[intent::STATUS], intent::STATUS_EXECUTED);
    assert_eq!(d[leg_offset(0) + leg::STATUS], leg::STATUS_CONFIRMED);

    // Cannot execute twice.
    let ix = ctx.execute_solana_ix(0, 0, CHAIN_SOLANA, &treasury);
    ctx.expect_err(&[ix], &[&ex], LedgerError::InvalidStatus);
}

#[test]
fn solana_burn_from_treasury() {
    let mut ctx = Ctx::new();
    ctx.setup_demo();
    let amount = 1_000_000 * ONE;
    let proposer = ctx.approver(2);
    let treasury = ctx.treasury;
    let ix = ctx.create_intent_ix(
        0,
        intent::KIND_BURN,
        amount,
        CHAIN_SOLANA,
        0,
        &[],
        treasury.as_array(),
        &proposer.pubkey(),
    );
    ctx.send(&[ix], &[&proposer]).unwrap();
    ctx.approve_by(0, &[0, 1]);
    let t = ctx.time();
    ctx.set_time(t + 10);
    let ix = ctx.execute_solana_ix(0, 0, CHAIN_SOLANA, &treasury);
    let ex = ctx.executor();
    ctx.send(&[ix], &[&ex]).unwrap();
    let ta = ctx.data(&treasury);
    assert_eq!(
        u64::from_le_bytes(ta[64..72].try_into().unwrap()),
        29_000_000 * ONE
    );
    assert_eq!(
        ctx.totals(),
        (
            54_000_000 * ONE,
            29_000_000 * ONE,
            20_000_000 * ONE,
            5_000_000 * ONE
        )
    );
}

#[test]
fn ethereum_mint_creates_ika_message_approval() {
    let mut ctx = Ctx::new();
    ctx.setup_demo();
    let amount = 2_500_000 * ONE;
    let proposer = ctx.approver(0);
    let ix = ctx.create_intent_ix(
        0,
        intent::KIND_MINT,
        amount,
        0,
        CHAIN_ETHEREUM,
        &ETH_TREASURY,
        &[],
        &proposer.pubkey(),
    );
    ctx.send(&[ix], &[&proposer]).unwrap();
    ctx.approve_by(0, &[1, 2]);
    let t = ctx.time();
    ctx.set_time(t + 6);

    let dw = ctx.eth_dwallet.clone();
    let (ix, ma, digest) = ctx.execute_foreign_ix(
        0,
        0,
        CHAIN_ETHEREUM,
        &dw,
        leg::ACTION_MINT,
        amount,
        &ETH_TREASURY,
        chain::ENCODING_EIP712,
    );
    let ex = ctx.executor();
    ctx.send(&[ix], &[&ex]).unwrap();

    // MessageApproval PDA created by the dWallet program via CPI.
    let m = ctx.data(&ma);
    assert_eq!(m.len(), 312, "MessageApproval length");
    assert_eq!(m[0], 14, "MessageApproval discriminator");
    assert_eq!(&m[2..34], dw.0.as_array(), "dwallet");
    assert_eq!(&m[34..66], &digest, "message_digest");
    assert_eq!(
        &m[98..130],
        ctx.cpi_authority.as_array(),
        "approver = CPI authority"
    );
    assert_eq!(
        &m[130..162],
        ctx.executor.pubkey().as_array(),
        "user_pubkey = executor"
    );
    assert_eq!(read_u16(&m, 162), SCHEME_ECDSA_KECCAK256);
    assert_eq!(m[172], 0, "status pending");

    // Ledger: authorized supply moves at authorization time.
    assert_eq!(
        ctx.totals(),
        (
            57_500_000 * ONE,
            30_000_000 * ONE,
            22_500_000 * ONE,
            5_000_000 * ONE
        )
    );
    let d = ctx.data(&ctx.intent_pda(0).0);
    assert_eq!(d[intent::STATUS], intent::STATUS_EXECUTING);
    let lo = leg_offset(0);
    assert_eq!(d[lo + leg::STATUS], leg::STATUS_AUTHORIZED);
    assert_eq!(
        &d[lo + leg::MESSAGE_DIGEST..lo + leg::MESSAGE_DIGEST + 32],
        &digest
    );
    assert_eq!(
        &d[lo + leg::MESSAGE_APPROVAL..lo + leg::MESSAGE_APPROVAL + 32],
        ma.as_array()
    );

    // Executor confirms with the destination tx hash.
    let tx_hash = [0xF1u8; 32];
    let ix = ctx.confirm_ix(0, 0, &tx_hash);
    ctx.send(&[ix], &[&ex]).unwrap();
    let d = ctx.data(&ctx.intent_pda(0).0);
    assert_eq!(d[intent::STATUS], intent::STATUS_EXECUTED);
    assert_eq!(d[lo + leg::STATUS], leg::STATUS_CONFIRMED);
    assert_eq!(d[lo + leg::DEST_TX], 32);
    assert_eq!(&d[lo + leg::DEST_TX + 1..lo + leg::DEST_TX + 33], &tx_hash);

    // Confirming again fails.
    let ix = ctx.confirm_ix(0, 0, &tx_hash);
    ctx.expect_err(&[ix], &[&ex], LedgerError::InvalidStatus);
}

#[test]
fn move_ethereum_to_sui_two_legs() {
    let mut ctx = Ctx::new();
    ctx.setup_demo();
    let amount = 5_000_000 * ONE;
    let proposer = ctx.approver(1);
    let ix = ctx.create_intent_ix(
        0,
        intent::KIND_MOVE,
        amount,
        CHAIN_ETHEREUM,
        CHAIN_SUI,
        &SUI_TREASURY,
        &ETH_TREASURY,
        &proposer.pubkey(),
    );
    ctx.send(&[ix], &[&proposer]).unwrap();
    let d = ctx.data(&ctx.intent_pda(0).0);
    assert_eq!(d[intent::LEG_COUNT], 2);
    assert_eq!(d[leg_offset(0) + leg::ACTION], leg::ACTION_BURN);
    assert_eq!(read_u16(&d, leg_offset(0) + leg::CHAIN_ID), CHAIN_ETHEREUM);
    assert_eq!(d[leg_offset(1) + leg::ACTION], leg::ACTION_MINT);
    assert_eq!(read_u16(&d, leg_offset(1) + leg::CHAIN_ID), CHAIN_SUI);

    ctx.approve_by(0, &[0, 2]);
    let t = ctx.time();
    ctx.set_time(t + 6);
    let ex = ctx.executor();

    // Mint leg before burn leg is confirmed → LegNotReady.
    let sui = ctx.sui_dwallet.clone();
    let (ix, _, _) = ctx.execute_foreign_ix(
        0,
        1,
        CHAIN_SUI,
        &sui,
        leg::ACTION_MINT,
        amount,
        &SUI_TREASURY,
        chain::ENCODING_RAW,
    );
    ctx.expect_err(&[ix], &[&ex], LedgerError::LegNotReady);

    // Burn leg on Ethereum.
    let eth = ctx.eth_dwallet.clone();
    let (ix, ma0, _) = ctx.execute_foreign_ix(
        0,
        0,
        CHAIN_ETHEREUM,
        &eth,
        leg::ACTION_BURN,
        amount,
        &ETH_TREASURY,
        chain::ENCODING_EIP712,
    );
    ctx.send(&[ix], &[&ex]).unwrap();
    assert_eq!(ctx.data(&ma0)[0], 14);
    assert_eq!(
        ctx.totals(),
        (
            55_000_000 * ONE,
            30_000_000 * ONE,
            15_000_000 * ONE,
            5_000_000 * ONE
        )
    );

    // Still not ready: burn authorized but not confirmed.
    let (ix, _, _) = ctx.execute_foreign_ix(
        0,
        1,
        CHAIN_SUI,
        &sui,
        leg::ACTION_MINT,
        amount,
        &SUI_TREASURY,
        chain::ENCODING_RAW,
    );
    ctx.expect_err(&[ix], &[&ex], LedgerError::LegNotReady);

    let ix = ctx.confirm_ix(0, 0, &[0xE7u8; 32]);
    ctx.send(&[ix], &[&ex]).unwrap();

    // Mint leg on Sui.
    let (ix, ma1, digest1) = ctx.execute_foreign_ix(
        0,
        1,
        CHAIN_SUI,
        &sui,
        leg::ACTION_MINT,
        amount,
        &SUI_TREASURY,
        chain::ENCODING_RAW,
    );
    ctx.send(&[ix], &[&ex]).unwrap();
    let m = ctx.data(&ma1);
    assert_eq!(&m[34..66], &digest1);
    assert_eq!(read_u16(&m, 162), SCHEME_EDDSA_SHA512);
    assert_eq!(
        ctx.totals(),
        (
            55_000_000 * ONE,
            30_000_000 * ONE,
            15_000_000 * ONE,
            10_000_000 * ONE
        )
    );

    let ix = ctx.confirm_ix(0, 1, &[0x5Eu8; 32]);
    ctx.send(&[ix], &[&ex]).unwrap();
    let d = ctx.data(&ctx.intent_pda(0).0);
    assert_eq!(d[intent::STATUS], intent::STATUS_EXECUTED);
}

#[test]
fn policy_rejects_bad_intents_at_creation() {
    let mut ctx = Ctx::new();
    ctx.setup_demo();
    let p = ctx.approver(0);
    let pk = p.pubkey();

    // Global cap: 55M + 50M > 100M (chain cap for Ethereum would also fail; global runs first).
    let ix = ctx.create_intent_ix(
        0,
        intent::KIND_MINT,
        50_000_000 * ONE,
        0,
        CHAIN_ETHEREUM,
        &ETH_TREASURY,
        &[],
        &pk,
    );
    ctx.expect_err(&[ix], &[&p], LedgerError::GlobalCapExceeded);

    // Per-chain cap: Ethereum 20M + 15M > 30M cap (global 70M fine).
    let ix = ctx.create_intent_ix(
        0,
        intent::KIND_MINT,
        15_000_000 * ONE,
        0,
        CHAIN_ETHEREUM,
        &ETH_TREASURY,
        &[],
        &pk,
    );
    ctx.expect_err(&[ix], &[&p], LedgerError::ChainCapExceeded);

    // Recipient not allowlisted.
    let ix = ctx.create_intent_ix(
        0,
        intent::KIND_MINT,
        1_000_000 * ONE,
        0,
        CHAIN_ETHEREUM,
        &[0x99u8; 20],
        &[],
        &pk,
    );
    ctx.expect_err(&[ix], &[&p], LedgerError::RecipientNotAllowlisted);

    // Zero amount.
    let ix = ctx.create_intent_ix(
        0,
        intent::KIND_MINT,
        0,
        0,
        CHAIN_ETHEREUM,
        &ETH_TREASURY,
        &[],
        &pk,
    );
    ctx.expect_err(&[ix], &[&p], LedgerError::ZeroAmount);

    // Insufficient supply for a burn.
    let ix = ctx.create_intent_ix(
        0,
        intent::KIND_BURN,
        6_000_000 * ONE,
        CHAIN_SUI,
        0,
        &[],
        &SUI_TREASURY,
        &pk,
    );
    ctx.expect_err(&[ix], &[&p], LedgerError::InsufficientSupply);

    // Move to the same chain.
    let ix = ctx.create_intent_ix(
        0,
        intent::KIND_MOVE,
        ONE,
        CHAIN_SUI,
        CHAIN_SUI,
        &SUI_TREASURY,
        &SUI_TREASURY,
        &pk,
    );
    ctx.expect_err(&[ix], &[&p], LedgerError::SameChain);

    // Non-approver cannot propose.
    let stranger = Keypair::new();
    ctx.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let ix = ctx.create_intent_ix(
        0,
        intent::KIND_MINT,
        ONE,
        0,
        CHAIN_ETHEREUM,
        &ETH_TREASURY,
        &[],
        &stranger.pubkey(),
    );
    ctx.expect_err(&[ix], &[&stranger], LedgerError::NotApprover);

    // Nothing was created.
    assert!(ctx.svm.get_account(&ctx.intent_pda(0).0).is_none());
    assert_eq!(read_u64(&ctx.data(&ctx.asset), asset::INTENT_COUNT), 0);
}

#[test]
fn approval_rules() {
    let mut ctx = Ctx::new();
    ctx.setup_demo();
    let p = ctx.approver(0);
    let ix = ctx.create_intent_ix(
        0,
        intent::KIND_MINT,
        ONE,
        0,
        CHAIN_ETHEREUM,
        &ETH_TREASURY,
        &[],
        &p.pubkey(),
    );
    ctx.send(&[ix], &[&p]).unwrap();

    // Proposer cannot approve their own intent.
    let ix = ctx.approve_ix(0, &p.pubkey());
    ctx.expect_err(&[ix], &[&p], LedgerError::ProposerCannotApprove);

    // Stranger cannot approve.
    let stranger = Keypair::new();
    ctx.svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let ix = ctx.approve_ix(0, &stranger.pubkey());
    ctx.expect_err(&[ix], &[&stranger], LedgerError::NotApprover);

    // Approver 1 approves once, not twice.
    let a1 = ctx.approver(1);
    let ix = ctx.approve_ix(0, &a1.pubkey());
    ctx.send(&[ix], &[&a1]).unwrap();
    let ix = ctx.approve_ix(0, &a1.pubkey());
    ctx.expect_err(&[ix], &[&a1], LedgerError::AlreadyApproved);
    let d = ctx.data(&ctx.intent_pda(0).0);
    assert_eq!(d[intent::STATUS], intent::STATUS_PENDING_APPROVAL);
    assert_eq!(d[intent::APPROVAL_COUNT], 1);

    // Execute before threshold → InvalidStatus.
    let dw = ctx.eth_dwallet.clone();
    let (ix, _, _) = ctx.execute_foreign_ix(
        0,
        0,
        CHAIN_ETHEREUM,
        &dw,
        leg::ACTION_MINT,
        ONE,
        &ETH_TREASURY,
        chain::ENCODING_EIP712,
    );
    let ex = ctx.executor();
    ctx.expect_err(&[ix], &[&ex], LedgerError::InvalidStatus);

    // Stranger cannot execute even after approval.
    let a2 = ctx.approver(2);
    let ix = ctx.approve_ix(0, &a2.pubkey());
    ctx.send(&[ix], &[&a2]).unwrap();
    let t = ctx.time();
    ctx.set_time(t + 6);
    let (mut ix, _, _) = ctx.execute_foreign_ix(
        0,
        0,
        CHAIN_ETHEREUM,
        &dw,
        leg::ACTION_MINT,
        ONE,
        &ETH_TREASURY,
        chain::ENCODING_EIP712,
    );
    ix.accounts[3] = AccountMeta::new_readonly(stranger.pubkey(), true);
    ctx.expect_err(&[ix], &[&stranger], LedgerError::Unauthorized);
}

#[test]
fn execute_rechecks_caps_against_current_ledger() {
    // Two mint intents that each pass at creation but together exceed the Base-style chain cap.
    let mut ctx = Ctx::new();
    ctx.setup_demo();
    let p = ctx.approver(0);
    // Ethereum: 20M authorized, 30M cap. Two 8M intents pass individually.
    for i in 0..2u64 {
        let ix = ctx.create_intent_ix(
            i,
            intent::KIND_MINT,
            8_000_000 * ONE,
            0,
            CHAIN_ETHEREUM,
            &ETH_TREASURY,
            &[],
            &p.pubkey(),
        );
        ctx.send(&[ix], &[&p]).unwrap();
        ctx.approve_by(i, &[1, 2]);
    }
    let t = ctx.time();
    ctx.set_time(t + 6);
    let ex = ctx.executor();
    let dw = ctx.eth_dwallet.clone();
    let (ix, _, _) = ctx.execute_foreign_ix(
        0,
        0,
        CHAIN_ETHEREUM,
        &dw,
        leg::ACTION_MINT,
        8_000_000 * ONE,
        &ETH_TREASURY,
        chain::ENCODING_EIP712,
    );
    ctx.send(&[ix], &[&ex]).unwrap();
    let (ix, _, _) = ctx.execute_foreign_ix(
        1,
        0,
        CHAIN_ETHEREUM,
        &dw,
        leg::ACTION_MINT,
        8_000_000 * ONE,
        &ETH_TREASURY,
        chain::ENCODING_EIP712,
    );
    ctx.expect_err(&[ix], &[&ex], LedgerError::ChainCapExceeded);
}

#[test]
fn solana_leg_rejects_wrong_token_account() {
    let mut ctx = Ctx::new();
    ctx.setup_demo();
    let p = ctx.approver(0);
    let treasury = ctx.treasury;
    let ix = ctx.create_intent_ix(
        0,
        intent::KIND_MINT,
        ONE,
        0,
        CHAIN_SOLANA,
        treasury.as_array(),
        &[],
        &p.pubkey(),
    );
    ctx.send(&[ix], &[&p]).unwrap();
    ctx.approve_by(0, &[1, 2]);
    let t = ctx.time();
    ctx.set_time(t + 6);
    // A different token account (attacker-controlled) is rejected.
    let other = Address::new_unique();
    let mint = ctx.mint;
    ctx.svm
        .set_account(
            other,
            token_account_of(
                &TOKEN_2022,
                token_account_data(&mint, &Address::new_unique(), 0),
            ),
        )
        .unwrap();
    let ix = ctx.execute_solana_ix(0, 0, CHAIN_SOLANA, &other);
    let ex = ctx.executor();
    ctx.expect_err(&[ix], &[&ex], LedgerError::AccountMismatch);
}

#[test]
fn addr_padding_helpers_roundtrip() {
    let v = padded(&[1, 2, 3]);
    assert_eq!(v.len(), ADDR_LEN);
    assert_eq!(v[0], 3);
    assert_eq!(&v[1..4], &[1, 2, 3]);
    assert!(v[4..].iter().all(|b| *b == 0));
    assert_eq!(ADDR_BYTES, 64);
}
