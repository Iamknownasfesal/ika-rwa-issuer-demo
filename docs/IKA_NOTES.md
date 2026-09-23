# Ika pre-alpha integration notes (verified on devnet, 2026-09-22)

What the live signer at `pre-alpha-dev-1.ika.ika-network.net:443` actually expects: several
points differ from the vendored examples in `dwallet-labs/ika-pre-alpha`.

| Step | What works | What does not |
|---|---|---|
| Transport | `@grpc/grpc-js` from Node 24 on macOS negotiates HTTP/2 fine | the ALPN failure reported by another team was not reproduced |
| DKG | `DKG { user_secret_key_share: Encrypted{…} }` (zero-trust) with `intended_chain_sender` = the executor key; dWallet PDA appears within seconds; `TransferOwnership` (disc 24) by that key hands it to the ledger's CPI PDA |: |
| approve_message | via CPI from the ledger (`execute_leg`), coordinator first, 100-byte data |: |
| Presign | global `Presign { curve, signature_algorithm }` | `PresignForDWallet` is rejected for DKG dWallets ("requires an imported key dWallet") |
| Sign | needs the real `dwallet_attestation` and a `session_identifier_preimage` equal to the DKG **session identifier**; `approval_proof = Solana { tx_signature, slot }` of the `execute_leg` transaction; the network then commits the signature on-chain (`MessageApproval.status = 1`) | placeholder attestation → "failed to decode dwallet_attestation"; random preimage → "no key for dwallet <hash>" |
| Ed25519 | `EddsaSha512` signs the raw 161-byte authorization message |: |
| secp256k1 | `EcdsaKeccak256` signs `keccak256(message)`; 64-byte `r‖s` returned |: |

Reconstructing the attestation without the DKG response (`sdk/src/ika/attestation.ts`):

```
DWalletAttestation PDA  = ["dwallet", chunks(curve_u16_le ‖ pk), "attestation"]   (disc 15)
  noa_signature         = bytes 2..66
  attestation_data      = bytes 67..          (BCS VersionedDWalletDataAttestation; V1 session_identifier = data[1..33])
DWallet account         = ["dwallet", chunks…]                                    (disc 2)
  network_pubkey        = bytes 111..143      (noa_public_key)
  epoch                 = u64 LE at 103       (created_epoch)
```

`scripts/ika-probe.ts <intentIndex>` replays presign + sign for an authorized leg with several
preimage candidates and reports which one the signer accepts: useful when the service changes.

Operational notes: the signer's key store and the devnet program state are wiped periodically -
run `pnpm setup:devnet` before a session. The public devnet RPC rate-limits bursts; the executor
retries with backoff and confirms by polling instead of WebSocket subscriptions.
