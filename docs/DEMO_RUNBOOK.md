# Demo runbook (3 minutes)

## Before the session

```bash
# 1. Program is deployed at DkXkmLYeR63gxhvD4FkV2oAJjkKzUUGJhDoqA6ULdauE. Redeploy only if changed:
scripts/deploy-program.sh

# 2. Fresh devnet state (Ika pre-alpha wipes periodically):
pnpm setup:devnet                # DKG ×2 (zero-trust), contracts, Token-2022 mint, asset + 5 chains → deployments/devnet.json

# 3. Smoke test one foreign leg from the CLI before going on stage:
pnpm demo:intent -- --kind mint --dst 5 --amount 1000000 && sleep 6 && pnpm executor run --intent 0 --deliver live   # real Tempo mint

# 4. Start the console in devnet mode; keep a second tab in mock mode as fallback:
NEXT_PUBLIC_LEDGER_MODE=devnet LEDGER_DELIVER=live pnpm --filter @ika-rwa/app dev   # http://localhost:3000/console
pnpm --filter @ika-rwa/app dev -- -p 3001                          # mock fallback on :3001
```

If devnet or the Ika signer is unavailable, switch to the mock tab. It runs the same flow with simulated chain state.

## On stage

| step | do | say |
|---|---|---|
| 0 Open | Landing page at `/` | "Mint anywhere. On one ledger." Run the simulator once with 40,000,000 on Ethereum, then click Console. |
| 1 Overview | Console ledger | "One asset, five chains, one ledger on Solana. Each chain lists the Ika dWallet that is its mint authority. The issuer has no key for it." |
| 2 Mint on Base | New intent → Mint → Base → 2,500,000 → Base treasury | "Policy runs before anyone approves: global cap, Base cap, allowlist all with numbers." |
| 3 Approve | Approver dropdown → Bob → Approve; Carol → Approve | "2-of-3. The proposer can't approve their own intent. Timelock starts now." |
| 4 Execute | Execute | "Three steps: the Solana program approves the exact message digest, Ika signs it with the secp256k1 dWallet, the relayer delivers it to Base. The relayer can't change a byte." |
| 5 Rejected | New intent → Mint → Ethereum → 40,000,000 | "Two rules fail at once. Now 1,000,000 to a random address: allowlist. This is the compromised-signer moment there is nothing to sign." |
| 6 Move | New intent → Move → Ethereum 5,000,000 → Sui | "Burn leg first, mint leg only after the burn is confirmed. Total supply never changes." |
| 7 Audit | Intents | "Approvers, rule results, the Ika MessageApproval and the destination hash. For every intent, on Solana." |

Closing line: "Zero-trust dWallet the issuer's encrypted share plus the network share and the
network share only ever signs what this program approved."

## Explorer links to have open

* Program: https://explorer.solana.com/address/DkXkmLYeR63gxhvD4FkV2oAJjkKzUUGJhDoqA6ULdauE?cluster=devnet
* Asset PDA and the two dWallet PDAs: from `deployments/devnet.json`
* Ika program: https://explorer.solana.com/address/87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY?cluster=devnet
