# TBILL on Sui (testnet)

`tbill/` is the Move package that makes the Ika dWallet the only mint/burn authority for TBILL on Sui.

* `MintController` (shared) holds the `TreasuryCap<TBILL>`, the dWallet's Ed25519 public key, the Solana
  ledger (Asset PDA) bytes, the per-chain domain separator, and the set of consumed nonces.
* `mint_with_authorization(ctrl, message, signature)` / `burn_with_authorization(ctrl, message, signature, coin)`
  verify `sui::ed25519::ed25519_verify(signature, dwallet_pubkey, message)` over the **raw 161-byte
  authorization message** the Solana program approved (see `programs/issuer-ledger/src/digest.rs`), check the
  prefix, domain, ledger and action, consume the nonce `(intent_index << 1) | leg_index`, then mint to /
  burn from `account`.
* `AdminCap` gates `set_params` / `set_dwallet_pubkey` (re-point after an Ika pre-alpha wipe).

Ika's `EddsaSha512` signatures are plain Ed25519 over the raw message: verified offline with `@noble/curves`
and on-chain by the Move test `mint_with_real_ika_signature`, which replays the signature the pre-alpha network
produced for devnet intent #1.

```bash
cd contracts/sui/tbill && sui move test          # 7 tests, incl. the real Ika signature vector
pnpm deploy:sui                                  # publish to testnet + bind dWallet/ledger/domain → deployments/sui.json
pnpm deploy:sui --rebind                         # only re-run set_params (e.g. after a new DKG)
```

The relayer (`keys/sui-deployer.json`) pays gas and, for burns, must own the coins it burns
(`account == sender`), so the Solana ledger's Sui allowlist / treasury should be the relayer's address.
