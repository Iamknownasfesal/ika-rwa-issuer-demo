# TBILL issuer ledger

A tokenized treasury fund issued on Solana, Ethereum, Base, Sui and Tempo, with one ledger on
Solana deciding every mint and burn.

On Solana, the ledger program holds the mint authority directly. On every other chain, the mint
authority is an [Ika](https://ika.xyz) dWallet, and the dWallet signs only messages the ledger
program approves. The program approves only what passes the issuer's rules: supply caps per chain,
a global cap, a recipient allowlist, 2-of-3 approvals and a timelock.

```
console ──► issuer-ledger program (Solana) ──► mint on Solana
                     │
                     └─ approve_message ──► Ika dWallet ──► signature
                                                                │
executor ── relays the signed authorization ◄───────────────────┘
        └──► MintController on Ethereum, Base, Tempo · Move package on Sui
```

It runs on test networks: Solana devnet, Ethereum Sepolia, Base Sepolia, Sui testnet and Tempo
Moderato, with signatures from the Ika Solana pre-alpha.

## How a mint works

1. **Propose.** An operator drafts a mint, burn or cross-chain move. `create_intent` checks every
   rule on-chain before anyone approves.
2. **Approve.** Two of three approvers sign `approve_intent`. The proposer cannot approve their own
   intent. The second approval starts a timelock.
3. **Sign.** `execute_leg` checks the rules again, builds the exact authorization message
   (EIP-712 on EVM chains, a fixed 161-byte layout on Sui) and asks Ika to sign it through
   `approve_message`.
4. **Deliver.** A relayer submits the signature to the destination contract, which verifies it and
   mints or burns. `confirm_leg` records the destination transaction on the ledger.

The relayer only pays gas. It cannot change what was signed, and each nonce works once.

## Repository

| Path | What |
|---|---|
| `programs/issuer-ledger/` | Solana program (Pinocchio 0.11, `no_std`) and LiteSVM tests |
| `contracts/evm/` | `MintController` for Ethereum, Base and Tempo (Foundry) |
| `contracts/sui/tbill/` | `tbill` Move package for Sui |
| `sdk/` | `@ika-rwa/ledger-sdk`: PDAs, instruction builders, decoders, policy checks, Ika gRPC client |
| `executor/` | `@ika-rwa/executor`: runs a leg end to end (execute, sign, deliver, confirm) |
| `app/` | Next.js console and landing page, with `mock` and `devnet` modes |
| `scripts/` | Program deploy, contract deploys and the one-shot devnet setup |
| `deployments/` | Addresses of the current deployment |
| `vendor/ika/` | Ika dWallet program binary and proto, for local CPI tests |
| `docs/` | SDK contract, Ika integration notes, demo runbook, hosting |

## Run it

Requires Rust 1.98, Solana CLI 4.3, Node 24 and pnpm 12.

```bash
pnpm install
pnpm build                  # sdk, executor
pnpm test

cargo build-sbf --manifest-path programs/issuer-ledger/Cargo.toml
cargo test -p issuer-ledger
```

Console with simulated state, no chain access:

```bash
pnpm --filter @ika-rwa/app dev
```

Console against the live deployment:

```bash
pnpm setup:devnet           # dWallets, mint, asset, contracts on every chain, deployments/*.json
NEXT_PUBLIC_LEDGER_MODE=devnet LEDGER_DELIVER=live pnpm --filter @ika-rwa/app dev
```

`setup:devnet` generates demo keys into `keys/` (gitignored). The console signs with them on the
server; the approver switch picks which key signs. A real deployment would have each approver sign
from their own wallet.

Executor from the command line:

```bash
pnpm demo:intent -- --kind mint --dst 3 --amount 2500000
pnpm executor run --intent 3 --deliver live
```

## Deployment

| | |
|---|---|
| Ledger program | `DkXkmLYeR63gxhvD4FkV2oAJjkKzUUGJhDoqA6ULdauE` |
| Ika dWallet program | `87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY` |
| Asset, chains, dWallets | `deployments/devnet.json` |
| EVM contracts | `deployments/evm.json` |
| Sui package | `deployments/sui.json` |

Starting supply is in `scripts/seed-supply.json`. Each chain mints its share at deployment and the
ledger records the same number, so they start equal.

## Keys and trust

The dWallets use Ika's zero-trust mode: the key is split between the issuer and the Ika network,
and neither can sign alone. The dWallet's on-chain authority is the ledger program, so the network
signs only messages the program approved.

In production, the issuer would keep its share's decryption key in an HSM and re-encrypt the share
to a custodian as a backup. The Ika pre-alpha uses placeholder values for the issuer's share and a
single signer instead of MPC, so this demo shows the control flow, not the production security.

## License

BSD-3-Clause-Clear. Files in `vendor/ika/` keep their original license.
