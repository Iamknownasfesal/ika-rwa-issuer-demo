# Hosting the private demo

The console runs on Vercel as project `ika-issuer-ledger` (https://ika-issuer-ledger.vercel.app),
in devnet mode with live delivery, behind a shared password. Everything it touches is a testnet:
Solana devnet, the Ika devnet pre-alpha, Sepolia, Base Sepolia, Sui testnet and Tempo Moderato.

## What is gated

`app/src/proxy.ts` sends every request to `/unlock` until the visitor enters `DEMO_PASSWORD`. The
cookie holds a hash of the password, so changing the password signs everyone out. API routes answer
401 without the cookie. `robots.txt` disallows everything. With `DEMO_PASSWORD` unset (local dev)
the gate is off.

The current password is in `keys/demo-password.json` (gitignored).

## Environment (production)

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_LEDGER_MODE` | `devnet` |
| `LEDGER_DELIVER` | `live` |
| `DEMO_PASSWORD` | shared password |
| `LEDGER_KEY_EXECUTOR` | `keys/executor.json` (JSON array) |
| `LEDGER_KEY_APPROVER_ALICE` / `_BOB` / `_CAROL` | `keys/approver-*.json` |
| `LEDGER_IKA_ISSUER` | content of `keys/ika-issuer.json`: the issuer's Ika root seed and dWallet shares |
| `EVM_RELAYER_KEY` | `privateKey` from `keys/evm-deployer.json` (also the EVM treasury) |
| `SUI_RELAYER_SECRET_KEY` | `secretKey` from `keys/sui-deployer.json` (the Sui treasury) |

Every key the hosted demo holds was generated for it and only ever funded on testnets. The Sui
deployer is also the Sui treasury and relayer (the Move contract burns only coins the sender owns),
and `scripts/deploy-sui.ts` never falls back to the Sui CLI keystore, which may hold mainnet assets.

## Deploy

The Vercel CLI cannot read the pnpm 12 lockfile, so build locally and upload the output:

```bash
vercel pull --yes --environment=production   # from the repo root; .vercel/project.json has rootDirectory "app"
vercel build --prod                           # runs pnpm build (sdk, executor, server bundles) and next build
vercel deploy --prebuilt --prod
```

`pnpm build` also writes `sdk/dist/server.mjs` and `executor/dist/server.mjs`, single-file
bundles the console loads natively. `app/next.config.ts` traces from the repo root and ships
those bundles, the Ika SDK's WebAssembly module and `deployments/*.json` with every API function.
`execute` may run for up to 300 seconds; a foreign leg takes about 30, most of it waiting for the
signature voucher to be finalized on Solana.

After `pnpm setup:devnet` writes a new asset, redeploy so the functions pick up the new
`deployments/devnet.json`. When it also made new dWallets (after an Ika wipe), update
`LEDGER_IKA_ISSUER` first:

```bash
cd app
vercel env rm LEDGER_IKA_ISSUER production --yes
vercel env add LEDGER_IKA_ISSUER production --sensitive < ../keys/ika-issuer.json
```

## Rotate

```bash
cd app
vercel env rm DEMO_PASSWORD production && printf '%s' "new-password" | vercel env add DEMO_PASSWORD production --sensitive
cd .. && vercel build --prod && vercel deploy --prebuilt --prod
```
