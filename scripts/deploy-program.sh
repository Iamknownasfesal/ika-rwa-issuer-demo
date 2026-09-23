#!/usr/bin/env bash
# Build the Pinocchio program and deploy it to Solana devnet.
# Usage: scripts/deploy-program.sh [cluster-url]   (default: devnet)
set -euo pipefail
cd "$(dirname "$0")/.."
CLUSTER="${1:-devnet}"
echo "▶ cargo build-sbf"
cargo build-sbf --manifest-path programs/issuer-ledger/Cargo.toml
KEYPAIR=target/deploy/issuer_ledger-keypair.json
PROGRAM_ID=$(solana address -k "$KEYPAIR")
echo "▶ deploying issuer_ledger.so as $PROGRAM_ID to $CLUSTER"
solana program deploy target/deploy/issuer_ledger.so --program-id "$KEYPAIR" -u "$CLUSTER"
echo "✓ program id: $PROGRAM_ID"
echo "  next: pnpm setup:devnet"
