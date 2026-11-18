# Ika devnet pre-alpha integration notes (verified on devnet, 2026-11-18)

How the ledger uses the Ika Solana devnet pre-alpha, and what was checked against the live
network. The guide is https://solana-pre-alpha.ika.xyz; the SDK, the CPI crates and the examples
are in https://github.com/dwallet-labs/ika-pre-alpha.

The pre-alpha is a mock network: one backend holds the whole key of each dWallet and signs alone.
There is no MPC and it is not secure. The Solana program, the transactions and the SDK's calls and
checks are the real ones, so an app moves to the real network by dropping mock mode.

| What | Value |
|---|---|
| Ika program | `8siGnE3tCZbu4LTuX8QoBPErvWeGBF4pRSJDnaGdHyQv` |
| Network, gRPC-Web | `https://solana-alpha-dev-1.ika-network.net` |
| Network key | `fe8a6482521cc4bae052c55cd5b3c92d05c8749bcc2c584046de3efb077d65ed` |
| Chain number, network value | `1`, `3` |

A wipe can move the program and change the network key. Then: update the `ika-dwallet-pinocchio`
rev in `Cargo.toml` and `IKA_DEVNET_PRE_ALPHA` in `sdk/src/chains.ts`, run
`scripts/deploy-program.sh`, then `pnpm setup:devnet`, which makes new dWallets and a new asset.

## The flow

| Step | Who | What |
|---|---|---|
| Register | setup | One root seed gives the issuer's keys. An encryption key is registered per curve (a transaction each), and the request key gets a gas deposit. The mock charges nothing, but the deposit must exist. |
| DKG | setup | `requestDWalletDKG`, then `acceptEncryptedUserShare`, then `waitForDWallet`. The dWallet is unusable until the share is accepted. The returned `DWallet` (user share included) is kept in `keys/ika-issuer.json`: a sign request needs it. |
| Rules | setup | `init_asset` stores the request key as `ika_signing_key`; `add_chain` binds each chain to its dWallet's address, curve and public key. |
| Hand-over | setup | `transferDWallet` to the ledger's CPI authority (`["__ika_cpi_authority"]`), last, once the rules exist. |
| Voucher | ledger | `execute_leg` CPIs `issue_signature_voucher` (156) through `ika-dwallet-pinocchio`. The voucher is the ledger's PDA `["signature_voucher", intent, leg_index]`, signed for with its seeds; its owner is the CPI authority and its signing key the asset's `ika_signing_key`. |
| Sign | executor | Once the voucher is finalized, `requestSign({ dWallet, signatureVoucherId, message, ... })`. The SDK takes a presign from the pool, sends the request signed by the request key, and checks the signature against the dWallet's public key. The network writes the signature into the voucher (status 1). |

## What the ledger checks before the CPI

The CPI authority is one address for every dWallet the program holds, so the program decides
which dWallet a call is for:

- the Ika program account is the one the build names (`ika_dwallet_pinocchio::ID`; the crate
  refuses any other too, so the CPI authority's signature never reaches a fake program);
- the dWallet account is the one the chain registered, owned by the Ika program, tagged 97,
  185 bytes, active, owned by the CPI authority, with the chain's curve and public key;
- the voucher account is the leg's PDA at its canonical bump, so a leg has one voucher at an
  address anyone can derive, and never one where the sender chose.

Each check has its own error (`InvalidDWallet`, `DWalletNotOwned`, `DWalletMismatch`,
`InvalidVoucher`) and a LiteSVM test against the real Ika program binary.

## Facts that matter in practice

- **Finalized.** The network reads Solana at finalized commitment, so the executor reads the
  voucher at finalized before it asks for the signature. Since Alpenglow, finalized trails
  confirmed by under a second, so this costs nothing noticeable.
- **Key derivation is the slow step.** `UserShareEncryptionKeys.fromRootSeedKey` takes about five
  seconds in WebAssembly, even in mock mode, and blocks the thread while it runs. The result is
  kept for the process: measured on devnet, a first foreign leg takes about 13 seconds and a
  following one about 7.
- **Mock mode and gRPC-Web.** The client is built with `withMockCryptography` and a
  `DWalletGrpcClient` from `@ika.xyz/pre-alpha-core/web`. Plain gRPC on port 443 gets HTTP 400.
- **Signatures.** ECDSA comes back as 65 bytes: the recovery byte, then `r` and `s`. The EVM
  `MintController` takes the 64-byte `r || s` and tries both recovery ids. Ed25519 is 64 bytes
  over the raw 161-byte message.
- **Digest.** A voucher stores `keccak256(message)` whatever the scheme. For EVM chains the message
  is the EIP-712 preimage `0x1901 || domainSeparator || structHash`, and `EcdsaKeccak256` signs its
  Keccak-256, which is what `ecrecover` checks.
- **One request key.** The request key is the same for every curve of a root seed, so one asset
  names one signing key for both dWallets. `loadIssuer` checks this.
- **Build.** `cargo build-sbf --tools-version v1.54 --arch v3`; with `-- --features devnet-pre-alpha`
  for devnet. A build without the feature calls the local test address and refuses every devnet
  dWallet.
- **Network transactions are version 1.** The network's `CommitSignature` transaction uses the v1
  transaction format, so reads need `maxSupportedTransactionVersion: 1`.
- **Faucet.** The devnet RPC faucet is closed (`requestAirdrop` fails). `setup:devnet` funds the
  demo keys from the Solana CLI's default wallet.
- **Resume.** A leg whose voucher is already signed is finished from the voucher: the signature is
  read from Solana, not requested again.

`pnpm exec tsx scripts/ika-probe.ts [secp256k1|ed25519]` runs registration, DKG, an owner-issued
voucher and a sign with no ledger involved: when it passes and a leg does not, the fault is in the
ledger or the executor.

Operational notes: the public devnet RPC rate-limits bursts; the executor retries with backoff and
confirms by polling instead of WebSocket subscriptions. Sui's public full nodes no longer serve
JSON-RPC, so Sui delivery uses the gRPC client of `@mysten/sui` 2.x.
