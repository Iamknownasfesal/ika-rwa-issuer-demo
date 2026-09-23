//! Emits digest test vectors consumed by the TypeScript SDK tests
//! (`sdk/test/vectors.json`). Run: `cargo test -p issuer-ledger --test vectors`.

use issuer_ledger::digest::{
    Authorization, EIP712_MESSAGE_LEN, RAW_MESSAGE_LEN, account_word, eip712_message, leg_nonce,
    message_digest, raw_message,
};
use std::fmt::Write as _;

fn hex(b: &[u8]) -> String {
    b.iter().fold(String::new(), |mut s, x| {
        let _ = write!(s, "{:02x}", x);
        s
    })
}

#[test]
fn emit_vectors() {
    let ledger = [0x11u8; 32];
    let domain = [0xD0u8; 32];
    let cases: Vec<(&str, u8, u64, Vec<u8>, u64)> = vec![
        (
            "mint-evm-20",
            0,
            2_500_000_000_000,
            vec![0xAA; 20],
            leg_nonce(0, 0),
        ),
        (
            "burn-evm-20",
            1,
            5_000_000_000_000,
            vec![0xAA; 20],
            leg_nonce(7, 0),
        ),
        (
            "mint-sui-32",
            0,
            5_000_000_000_000,
            vec![0xBB; 32],
            leg_nonce(7, 1),
        ),
        (
            "mint-long-64",
            0,
            1,
            (0..64u8).collect(),
            leg_nonce(u64::MAX >> 1, 1),
        ),
    ];
    let mut out = String::from("[\n");
    for (i, (name, action, amount, account, nonce)) in cases.iter().enumerate() {
        let a = Authorization {
            action: *action,
            amount: *amount,
            account,
            nonce: *nonce,
            ledger: &ledger,
            domain_separator: &domain,
        };
        let mut raw = [0u8; RAW_MESSAGE_LEN];
        raw_message(&a, &mut raw);
        let mut e = [0u8; EIP712_MESSAGE_LEN];
        eip712_message(&a, &mut e);
        let _ = writeln!(
            out,
            "  {{\"name\":\"{}\",\"action\":{},\"amount\":\"{}\",\"account\":\"{}\",\"nonce\":\"{}\",\"ledger\":\"{}\",\"domainSeparator\":\"{}\",\"accountWord\":\"{}\",\"rawMessage\":\"{}\",\"rawDigest\":\"{}\",\"eip712Message\":\"{}\",\"eip712Digest\":\"{}\"}}{}",
            name,
            action,
            amount,
            hex(account),
            nonce,
            hex(&ledger),
            hex(&domain),
            hex(&account_word(account)),
            hex(&raw),
            hex(&message_digest(0, &a)),
            hex(&e),
            hex(&message_digest(1, &a)),
            if i + 1 < cases.len() { "," } else { "" }
        );
    }
    out.push_str("]\n");
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../sdk/test/vectors.json");
    std::fs::create_dir_all(std::path::Path::new(path).parent().unwrap()).unwrap();
    std::fs::write(path, &out).unwrap();
    assert!(out.contains("eip712Digest"));
}
