#!/usr/bin/env bash
# Build the ledger for the Ika devnet pre-alpha and deploy it to Solana devnet.
#
#   scripts/deploy-program.sh [cluster-url]   (default: devnet)
#
# The build names its Ika network once, with `--features devnet-pre-alpha`: the ledger then calls
# only that network's Ika program and accepts only its dWallets. The devnet build goes to
# target/deploy-devnet, so target/deploy keeps the featureless build the LiteSVM tests load.
#
# An existing deployment (deployments/devnet.json) is upgraded in place, which needs its upgrade
# authority as the Solana CLI's default key. Otherwise the program is deployed at the address of
# target/deploy/issuer_ledger-keypair.json.
set -euo pipefail
cd "$(dirname "$0")/.."
CLUSTER="${1:-devnet}"
OUT=target/deploy-devnet

echo "▶ cargo build-sbf --features devnet-pre-alpha"
cargo build-sbf --manifest-path programs/issuer-ledger/Cargo.toml --tools-version v1.54 --arch v3 \
  --sbf-out-dir "$OUT" -- --features devnet-pre-alpha

PROGRAM_ID=""
if [ -f deployments/devnet.json ]; then
  PROGRAM_ID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("deployments/devnet.json","utf8")).programId ?? "")')
fi
if [ -n "$PROGRAM_ID" ] && solana program show "$PROGRAM_ID" -u "$CLUSTER" >/dev/null 2>&1; then
  echo "▶ upgrading $PROGRAM_ID on $CLUSTER"
  solana program deploy "$OUT/issuer_ledger.so" --program-id "$PROGRAM_ID" -u "$CLUSTER"
else
  KEYPAIR=target/deploy/issuer_ledger-keypair.json
  [ -f "$KEYPAIR" ] || solana-keygen new --no-bip39-passphrase --silent -o "$KEYPAIR"
  PROGRAM_ID=$(solana address -k "$KEYPAIR")
  echo "▶ deploying issuer_ledger.so as $PROGRAM_ID to $CLUSTER"
  solana program deploy "$OUT/issuer_ledger.so" --program-id "$KEYPAIR" -u "$CLUSTER"
fi
echo "✓ program id: $PROGRAM_ID"
echo "  next: pnpm setup:devnet --program-id $PROGRAM_ID"
