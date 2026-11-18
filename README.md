# TBILL issuer ledger

A tokenized treasury fund issued on Solana, Ethereum, Base, Sui and Arc, with one ledger on
Solana deciding every mint and burn.

On Solana, the ledger program holds the mint authority directly. On every other chain, the mint
authority is an [Ika](https://ika.xyz) dWallet, and the dWallet signs only messages the ledger
program issues a signature voucher for. The program approves only what passes the issuer's rules: supply caps per chain,
a global cap, a recipient allowlist, 2-of-3 approvals and a timelock.

```
console ──► issuer-ledger program (Solana) ──► mint on Solana
                     │
                     └─ signature voucher ─► Ika dWallet ──► signature
                                                                │
executor ── relays the signed authorization ◄───────────────────┘
        └──► MintController on Ethereum, Base, Arc · Move package on Sui
```

It runs on test networks: Solana devnet, Ethereum Sepolia, Base Sepolia, Sui testnet and Arc
testnet, with signatures from the Ika Solana pre-alpha.

## How a mint works

1. **Propose.** An operator drafts a mint, burn or cross-chain move. `create_intent` checks every
   rule on-chain before anyone approves.
2. **Approve.** Two of three approvers sign `approve_intent`. The proposer cannot approve their own
   intent. The second approval starts a timelock.
3. **Sign.** `execute_leg` checks the rules again, builds the exact authorization message
   (EIP-712 on EVM chains, a fixed 161-byte layout on Sui) and issues an Ika signature voucher
   for it: the right to one signature of that message with that chain's dWallet. The executor
   then asks the Ika network for the signature, naming the voucher.
4. **Deliver.** A relayer submits the signature to the destination contract, which verifies it and
   mints or burns. `confirm_leg` records the destination transaction on the ledger.

The relayer only pays gas. It cannot change what was signed, and each nonce works once.

## Repository

| Path | What |
|---|---|
| `programs/issuer-ledger/` | Solana program (Pinocchio 0.11, `no_std`) and LiteSVM tests |
| `contracts/evm/` | `MintController` for Ethereum, Base and Arc (Foundry) |
| `contracts/sui/tbill/` | `tbill` Move package for Sui |
| `sdk/` | `@ika-rwa/ledger-sdk`: PDAs, instruction builders, decoders, policy checks, the Ika SDK wiring |
| `executor/` | `@ika-rwa/executor`: runs a leg end to end (execute, sign, deliver, confirm) |
| `app/` | Next.js console and landing page, with `mock` and `devnet` modes |
| `scripts/` | Program deploy, contract deploys and the one-shot devnet setup |
| `deployments/` | Addresses of the current deployment |
| `vendor/ika/` | Ika program binary built for the local test address, for LiteSVM CPI tests |
| `docs/` | SDK contract, Ika integration notes, demo runbook, hosting |

## Run it

Requires Rust 1.98, Solana CLI 4.3, Node 24 and pnpm 12.

```bash
pnpm install
pnpm build                  # sdk, executor
pnpm test

cargo build-sbf --manifest-path programs/issuer-ledger/Cargo.toml --tools-version v1.54 --arch v3
cargo test -p issuer-ledger
```

The program names its Ika network at build time. With no feature it calls the Ika program at the
local test address, which is where the LiteSVM tests load `vendor/ika/ika_protocol_test.so`.
`scripts/deploy-program.sh` builds with `--features devnet-pre-alpha` for devnet.

Console with simulated state, no chain access:

```bash
pnpm --filter @ika-rwa/app dev
```

Console against the live deployment:

```bash
pnpm deploy:program         # build for the Ika devnet pre-alpha, deploy or upgrade on devnet
pnpm setup:devnet           # dWallets, mint, asset, contracts on every chain, deployments/*.json
NEXT_PUBLIC_LEDGER_MODE=devnet LEDGER_DELIVER=live pnpm --filter @ika-rwa/app dev
```

`setup:devnet` generates demo keys into `keys/` (gitignored) and funds them from the Solana CLI's
default wallet, since the devnet RPC faucet is closed. It also writes `keys/ika-issuer.json`: the
root seed of the issuer's Ika keys and its share of each dWallet. The console signs with these
keys on the server; the approver switch picks which key signs. A real deployment would have each approver sign
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
| Ika program | `8siGnE3tCZbu4LTuX8QoBPErvWeGBF4pRSJDnaGdHyQv` |
| Asset, chains, dWallets | `deployments/devnet.json` |
| EVM contracts | `deployments/evm.json` |
| Sui package | `deployments/sui.json` |

Starting supply is in `scripts/seed-supply.json`. Each chain mints its share at deployment and the
ledger records the same number, so they start equal.

## Keys and trust

The dWallets use Ika's zero-trust mode: the key is split between the issuer and the Ika network,
and neither can sign alone. The dWallet's owner on Solana is the ledger program's CPI authority,
so only the program can issue a signature voucher, and the network signs only under one. Each
voucher sits at the program's own address for its leg and names the issuer's request key as the
only key the network takes the sign request from.

In production, the issuer would keep its share's decryption key in an HSM and re-encrypt the share
to a custodian as a backup.

The Ika Solana devnet pre-alpha is a mock network. One backend holds the whole key of every
dWallet and signs alone: there is no MPC, and it can sign anything. So this demo shows the control
flow, not the production security, and nothing of value belongs on these dWallets. The Solana
program, the vouchers, the transactions and the SDK's checks are the real ones.

## License

BSD-3-Clause-Clear. Files in `vendor/ika/` keep their original license.
