# SDK / executor / app contract

This is the agreed interface between the three TypeScript packages. Byte layouts are
authoritative in `programs/issuer-ledger/src/state.rs`; instruction data layouts in
`programs/issuer-ledger/src/instructions.rs` doc comments; the signed message in
`programs/issuer-ledger/src/digest.rs`. Error codes in `programs/issuer-ledger/src/error.rs`.

Package manager: **pnpm workspaces** (`pnpm-workspace.yaml` with `sdk`, `executor`, `app`).
TypeScript 5, ESM, `"type": "module"`. Solana client: **`@solana/kit` v8** (not web3.js v1).

## Packages

| package | name | runs in | purpose |
|---|---|---|---|
| `sdk/` | `@ika-rwa/ledger-sdk` | browser + node | PDAs, instruction builders, account decoders, `evaluate()` policy mirror, digest mirror, chain metadata |
| `sdk/src/ika/` (export `@ika-rwa/ledger-sdk/ika`) | node only | Ika gRPC client (zero-trust DKG, presign, sign) + Ika PDAs |
| `executor/` | `@ika-rwa/executor` | node | runs a leg end-to-end: execute_leg tx → wait MessageApproval → presign+sign via gRPC → deliver (mock or real EVM) → confirm_leg. Emits step events. Also setup script (`scripts/`). |
| `app/` | `@ika-rwa/app` | Next.js 16 | issuer console. Mock mode = in-browser store. Devnet mode = API routes calling sdk/executor. |

## Chain ids and metadata (`sdk/src/chains.ts`)

```ts
export const ChainId = { Solana: 1, Ethereum: 2, Base: 3, Sui: 4, Tempo: 5 } as const;
export type ChainKey = 'solana'|'ethereum'|'base'|'sui'|'tempo';
export interface ChainMeta {
  id: number; key: ChainKey; name: string;
  legKind: 0|1;            // 0 SolanaNative, 1 IkaForeign
  encoding: 0|1;           // 0 Raw, 1 EIP-712
  curve: 0|2;              // Ika DWalletCurve: 0 Secp256k1, 2 Curve25519
  signatureScheme: 0|5;    // Ika DWalletSignatureScheme: 0 EcdsaKeccak256, 5 EddsaSha512
  addressBytes: 20|32;
  testnet: string;         // 'devnet' | 'sepolia' | 'base-sepolia' | 'sui-testnet' | 'tempo-moderato'
  explorerTx: (hash: string) => string;
  explorerAddress: (addr: string) => string;
}
export const CHAINS: Record<number, ChainMeta>;
```
Solana=1 (native, Ed25519 n/a), Ethereum=2/Base=3/Tempo=5 (secp256k1, EIP-712), Sui=4 (Curve25519, Raw).

## Types (`sdk/src/types.ts`): decoded accounts

```ts
export type Address = string; // base58 (@solana/kit Address)
export interface Asset { address; createKey: Uint8Array; admin; executor; symbol: string; decimals: number; threshold: number;
  approvers: Address[]; chainCount: number; globalCap: bigint; authorizedTotal: bigint; intentCount: bigint; timelockSecs: bigint;
  bump: number; mintAuthorityBump: number; ikaProgram: Address }
export interface ChainDeployment { address; asset; chainId: number; legKind; encoding; curve; signatureScheme; dwallet: Address;
  dwalletPubkey: Uint8Array; contract: Uint8Array; domainSeparator: Uint8Array; authorized: bigint; cap: bigint; allowlist: Uint8Array[]; bump }
export type IntentKind = 0|1|2;          // Mint, Burn, Move
export type IntentStatus = 0|1|2|3;      // PendingApproval, Approved, Executing, Executed
export type LegStatus = 0|1|2;           // Pending, Authorized, Confirmed
export interface Leg { action: 0|1; chainId: number; status: LegStatus; messageDigest: Uint8Array; messageApproval: Address|null;
  destTx: Uint8Array; executedAt: bigint; confirmedAt: bigint }
export interface Intent { address; asset; index: bigint; kind: IntentKind; status: IntentStatus; proposer: Address; amount: bigint;
  srcChain: number; dstChain: number; recipient: Uint8Array; source: Uint8Array; memo: string; createdAt: bigint; approvedAt: bigint;
  approvalsBitmap: number; approvalCount: number; legs: Leg[]; bump: number }
```

## PDAs (`sdk/src/pda.ts`): all async, return `[Address, bump]`
`findAssetPda(programId, createKey)`, `findChainPda(programId, asset, chainId)`, `findIntentPda(programId, asset, index: bigint)`,
`findMintAuthorityPda(programId, asset)`, `findCpiAuthorityPda(programId)` (seed `__ika_cpi_authority`).
Ika (`sdk/src/ika/pda.ts`, browser-safe, re-exported from index): `dwalletSeeds(curve, pubkey)` (chunks of `curve_u16_le||pk`),
`findDwalletPda(ikaProgram, curve, pubkey)`, `findMessageApprovalPda(ikaProgram, curve, pubkey, scheme, digest)`, `findCoordinatorPda(ikaProgram)`.

## Decoders (`sdk/src/accounts.ts`)
`decodeAsset(bytes)`, `decodeChain(bytes)`, `decodeIntent(bytes)`; and RPC helpers `fetchAsset(rpc, address)`, `fetchChains(rpc, programId, asset, chainIds)`,
`fetchIntents(rpc, programId, asset)` (0..intentCount), `fetchMessageApproval(rpc, address)` → `{status: 0|1, signature: Uint8Array, digest, dwallet, userPubkey, scheme}` (offsets: status 172, sig_len 173 u16, sig 175).

## Instructions (`sdk/src/instructions.ts`): return `@solana/kit` `Instruction` objects
```ts
buildInitAssetIx({programId, asset, bump, admin, payer, createKey, symbol, decimals, threshold, timelockSecs, globalCap, executor, ikaProgram, mintAuthorityBump, approvers})
buildAddChainIx({programId, asset, chain, bump, admin, payer, chainId, legKind, encoding, curve, signatureScheme, dwallet, dwalletPubkey, contract, domainSeparator, cap, authorized, allowlist})
buildCreateIntentIx({programId, asset, intent, bump, proposer, payer, kind, amount, srcChain, dstChain, recipient, source, memo, srcChainPda?, dstChainPda?})
buildApproveIntentIx({programId, asset, intent, approver})
buildExecuteLegSolanaIx({programId, asset, intent, chain, authority, payer, legIndex, cpiAuthorityBump, mint, tokenAccount, mintAuthority})
buildExecuteLegForeignIx({programId, asset, intent, chain, authority, payer, legIndex, messageApprovalBump, cpiAuthorityBump, ikaProgram, coordinator, messageApproval, dwallet, cpiAuthority})
buildConfirmLegIx({programId, asset, intent, authority, legIndex, destTx: Uint8Array})
```
Exact byte layouts: see the `/// Data:` doc comments in `instructions.rs`. Discriminators 0..5.

## Digest (`sdk/src/digest.ts`): mirrors `digest.rs`, tested against `sdk/test/vectors.json`
`legNonce(intentIndex: bigint, legIndex)`, `accountWord(account)`, `rawMessage(auth)`, `eip712Message(auth)`, `messageDigest(encoding, auth)` where
`auth = {action, amount: bigint, account: Uint8Array, nonce: bigint, ledger: Uint8Array(32), domainSeparator: Uint8Array(32)}`.
keccak from `@noble/hashes/sha3` (`keccak_256`). Also `eip712DomainSeparator({name:'TBILL MintController', version:'1', chainId, verifyingContract})`.

## Policy (`sdk/src/policy.ts`): pure, mirrors on-chain rules, returns EVERY rule
```ts
export interface RuleResult { rule: 'amount'|'globalCap'|'chainCap'|'supply'|'allowlist'|'proposer'; ok: boolean; detail: string }
export function evaluate(draft: {kind, amount: bigint, srcChain?, dstChain?, recipient?: Uint8Array, source?: Uint8Array, proposer?: Address},
                         ledger: {asset: Asset; chains: ChainDeployment[]}): RuleResult[]
export function explainError(code: number): {rule: string; message: string}   // LedgerError code → text
```
Detail strings must include the numbers, e.g. `Global cap: 65,000,000 + 40,000,000 = 105,000,000 > 100,000,000`.

## Ika client (`sdk/src/ika/client.ts`, node only)
```ts
createIkaClient(grpcUrl, signer: {publicKey: Uint8Array}): {
  requestDkg(curve: 0|2): Promise<{publicKey, attestation}>   // zero-trust: UserSecretKeyShare.Encrypted
  requestPresign(curve, algorithm, dwalletPublicKey): Promise<Uint8Array /*presign session id*/>
  requestSign(dwalletPublicKey, message: Uint8Array, presignId, approvalTxSignature: Uint8Array): Promise<Uint8Array /*sig*/>
  close(): void }
```
BCS definitions copied from `vendor/ika/` docs (see `chains/solana/clients/typescript/src/bcs-types.ts` in ika-pre-alpha). Endpoint `pre-alpha-dev-1.ika.ika-network.net:443`, program `87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY`.

## Executor (`executor/src/index.ts`)
```ts
export type StepEvent = { leg: number; step: 'policy'|'ika-approval'|'ika-signature'|'deliver'|'confirm'; status: 'start'|'ok'|'error'; detail?: string; txHash?: string; signature?: string; messageApproval?: string }
export async function* runLeg(cfg: ExecutorConfig, intentIndex: bigint, legIndex: number): AsyncGenerator<StepEvent>
export interface ExecutorConfig { rpcUrl; wsUrl; grpcUrl; programId; ikaProgram; asset; executorKeypair: CryptoKeyPair|KeyPairSigner; deliver: 'mock'|'evm'; evm?: {rpcUrl, mintController, privateKey} }
```
Mock delivery: produce a deterministic fake tx hash formatted for the chain (`0x`+64 hex for EVM, base58 for Sui) and log the signed authorization. Real EVM delivery: `viem` calling `MintController.mintWithAuthorization(auth, sig)` / `burnWithAuthorization`.

## Deployment config (`deployments/devnet.json`, written by `scripts/setup-devnet.ts`, read by app + executor)
```json
{ "programId": "...", "ikaProgram": "87W5...", "rpcUrl": "https://api.devnet.solana.com", "grpcUrl": "pre-alpha-dev-1.ika.ika-network.net:443",
  "createKey": "<hex32>", "asset": "...", "mintAuthority": "...", "cpiAuthority": "...", "executor": "<pubkey>",
  "approvers": [{"name":"Alice","pubkey":"..."},{"name":"Bob","pubkey":"..."},{"name":"Carol","pubkey":"..."}],
  "dwallets": {"secp256k1": {"pda":"...","publicKeyHex":"...","evmAddress":"0x..."}, "curve25519": {"pda":"...","publicKeyHex":"...","suiAddress":"0x..."}},
  "chains": {"1": {"pda":"...","contract":"<mint>","treasury":"<ata>"}, "2": {"pda":"...","contract":"0x..","treasury":"0x.."}, ...} }
```
Secrets live in `keys/*.json` (gitignored): `admin.json`, `executor.json`, `approver-alice.json`, `approver-bob.json`, `approver-carol.json` (64-byte secret arrays, solana-keygen format).
