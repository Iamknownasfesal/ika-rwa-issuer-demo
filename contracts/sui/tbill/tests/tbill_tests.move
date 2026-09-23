#[test_only]
module tbill::tbill_tests;

use sui::coin::Coin;
use sui::test_scenario as ts;
use tbill::tbill::{Self, AdminCap, MintController, TBILL};

// ── Real vector: signed by the Ika pre-alpha network for devnet intent #1 (mint 1,000,000 TBILL
// to the Sui treasury). MessageApproval 7fP81A5WSErkxWQsiAZEP6yov45bSEXXavcxxiYy4RnA. ──
const DWALLET_PUBKEY: vector<u8> = x"2f755ccccf1b0e1d74cc3fbe7ff2eaeb453ffb8a418ab957378fb333596ee17a";
const LEDGER: vector<u8> = x"43cb0b9ea66e99df4c6b8c35b6c142c54a22520c06df9ec5fb62bcc74250630e";
const DOMAIN: vector<u8> = x"db689eb85fa8c832b0d47f0c453ae8b6efae0b0efdc1715b7ff761d632d4367a";
const MESSAGE: vector<u8> = x"494b415f5257415f415554485f5631db689eb85fa8c832b0d47f0c453ae8b6efae0b0efdc1715b7ff761d632d4367a000010a5d4e80000002013383761f7c24d78c9ff7d4987401893bd21ae01e8c5534e73558f35b238fa4e0000000000000000000000000000000000000000000000000000000000000000020000000000000043cb0b9ea66e99df4c6b8c35b6c142c54a22520c06df9ec5fb62bcc74250630e";
const SIGNATURE: vector<u8> = x"ea96954aea0129a90fea5e85f552451ea028130a97620f7eb1f93585939fc2cdfb86225dd489af5dde74367faad71dd5ced73d798ebf9f0cfbd6a0146d93e008";
const TREASURY: address = @0x13383761f7c24d78c9ff7d4987401893bd21ae01e8c5534e73558f35b238fa4e;
const AMOUNT: u64 = 1_000_000_000_000; // 1,000,000 TBILL with 6 decimals
const NONCE: u64 = 2; // (intent 1 << 1) | leg 0

const ADMIN: address = @0xAD;

fun setup(scen: &mut ts::Scenario) {
    tbill::init_for_testing(scen.ctx());
    scen.next_tx(ADMIN);
    let cap = scen.take_from_sender<AdminCap>();
    let mut ctrl = scen.take_shared<MintController>();
    tbill::set_params(&cap, &mut ctrl, DWALLET_PUBKEY, LEDGER, DOMAIN);
    ts::return_shared(ctrl);
    scen.return_to_sender(cap);
}

#[test]
fun parse_real_message() {
    let mut scen = ts::begin(ADMIN);
    setup(&mut scen);
    scen.next_tx(ADMIN);
    let ctrl = scen.take_shared<MintController>();
    let a = tbill::parse(&ctrl, &MESSAGE);
    assert!(tbill::authorization_action(&a) == 0);
    assert!(tbill::authorization_amount(&a) == AMOUNT);
    assert!(tbill::authorization_account(&a) == TREASURY);
    assert!(tbill::authorization_nonce(&a) == NONCE);
    ts::return_shared(ctrl);
    scen.end();
}

#[test]
fun mint_with_real_ika_signature() {
    let mut scen = ts::begin(ADMIN);
    setup(&mut scen);
    scen.next_tx(@0xBE1A);
    let mut ctrl = scen.take_shared<MintController>();
    tbill::mint_with_authorization(&mut ctrl, MESSAGE, SIGNATURE, scen.ctx());
    assert!(tbill::total_supply(&ctrl) == AMOUNT);
    assert!(tbill::nonce_used(&ctrl, NONCE));
    ts::return_shared(ctrl);
    scen.next_tx(TREASURY);
    let c = scen.take_from_sender<Coin<TBILL>>();
    assert!(c.value() == AMOUNT);
    scen.return_to_sender(c);
    scen.end();
}

#[test, expected_failure(abort_code = tbill::ENonceUsed)]
fun replay_is_rejected() {
    let mut scen = ts::begin(ADMIN);
    setup(&mut scen);
    scen.next_tx(@0xBE1A);
    let mut ctrl = scen.take_shared<MintController>();
    tbill::mint_with_authorization(&mut ctrl, MESSAGE, SIGNATURE, scen.ctx());
    tbill::mint_with_authorization(&mut ctrl, MESSAGE, SIGNATURE, scen.ctx());
    ts::return_shared(ctrl);
    scen.end();
}

#[test, expected_failure(abort_code = tbill::EInvalidSignature)]
fun tampered_message_is_rejected() {
    let mut scen = ts::begin(ADMIN);
    setup(&mut scen);
    scen.next_tx(@0xBE1A);
    let mut ctrl = scen.take_shared<MintController>();
    let mut m = MESSAGE;
    // bump the amount by one base unit
    let b = m[48];
    *&mut m[48] = b + 1;
    tbill::mint_with_authorization(&mut ctrl, m, SIGNATURE, scen.ctx());
    ts::return_shared(ctrl);
    scen.end();
}

#[test, expected_failure(abort_code = tbill::EBadDomain)]
fun wrong_domain_is_rejected() {
    let mut scen = ts::begin(ADMIN);
    setup(&mut scen);
    scen.next_tx(ADMIN);
    let cap = scen.take_from_sender<AdminCap>();
    let mut ctrl = scen.take_shared<MintController>();
    tbill::set_params(&cap, &mut ctrl, DWALLET_PUBKEY, LEDGER, x"0000000000000000000000000000000000000000000000000000000000000000");
    tbill::mint_unverified_for_testing(&mut ctrl, MESSAGE, scen.ctx());
    ts::return_shared(ctrl);
    scen.return_to_sender(cap);
    scen.end();
}

#[test, expected_failure(abort_code = tbill::EBadLedger)]
fun wrong_ledger_is_rejected() {
    let mut scen = ts::begin(ADMIN);
    setup(&mut scen);
    scen.next_tx(ADMIN);
    let cap = scen.take_from_sender<AdminCap>();
    let mut ctrl = scen.take_shared<MintController>();
    tbill::set_params(&cap, &mut ctrl, DWALLET_PUBKEY, x"1111111111111111111111111111111111111111111111111111111111111111", DOMAIN);
    tbill::mint_unverified_for_testing(&mut ctrl, MESSAGE, scen.ctx());
    ts::return_shared(ctrl);
    scen.return_to_sender(cap);
    scen.end();
}

#[test, expected_failure(abort_code = tbill::EBadAction)]
fun burn_message_cannot_mint() {
    let mut scen = ts::begin(ADMIN);
    setup(&mut scen);
    scen.next_tx(ADMIN);
    let mut ctrl = scen.take_shared<MintController>();
    let mut m = MESSAGE;
    *&mut m[47] = 1; // action = burn
    tbill::mint_unverified_for_testing(&mut ctrl, m, scen.ctx());
    ts::return_shared(ctrl);
    scen.end();
}

#[test]
fun genesis_mints_once_to_treasury() {
    let mut scen = ts::begin(ADMIN);
    setup(&mut scen);
    scen.next_tx(ADMIN);
    let cap = scen.take_from_sender<AdminCap>();
    let mut ctrl = scen.take_shared<MintController>();
    tbill::genesis_mint(&cap, &mut ctrl, 5_000_000_000_000, TREASURY, scen.ctx());
    assert!(tbill::total_supply(&ctrl) == 5_000_000_000_000);
    ts::return_shared(ctrl);
    scen.return_to_sender(cap);
    scen.next_tx(TREASURY);
    let c = scen.take_from_sender<Coin<TBILL>>();
    assert!(c.value() == 5_000_000_000_000);
    scen.return_to_sender(c);
    scen.end();
}

#[test, expected_failure(abort_code = tbill::EGenesisDone)]
fun genesis_cannot_run_twice() {
    let mut scen = ts::begin(ADMIN);
    setup(&mut scen);
    scen.next_tx(ADMIN);
    let cap = scen.take_from_sender<AdminCap>();
    let mut ctrl = scen.take_shared<MintController>();
    tbill::genesis_mint(&cap, &mut ctrl, 1, TREASURY, scen.ctx());
    tbill::genesis_mint(&cap, &mut ctrl, 1, TREASURY, scen.ctx());
    ts::return_shared(ctrl);
    scen.return_to_sender(cap);
    scen.end();
}
