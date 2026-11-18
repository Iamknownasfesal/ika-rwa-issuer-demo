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
| `sdk/src/ika/` (export `@ika-rwa/ledger-sdk/ika`) | node | the official Ika SDK (`@ika.xyz/pre-alpha-solana/kit`) in mock mode: client, issuer keys, curve and scheme mapping |
| `executor/` | `@ika-rwa/executor` | node | runs a leg end-to-end: execute_leg tx (issues the signature voucher) → wait until the voucher is finalized → `requestSign` under the voucher → deliver (mock, EVM or Sui) → confirm_leg. Emits step events. Also setup script (`scripts/`). |
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
  bump: number; mintAuthorityBump: number; ikaSigningKey: Uint8Array /* the issuer's Ika request key */ }
export interface ChainDeployment { address; asset; chainId: number; legKind; encoding; curve; signatureScheme; dwallet: Address;
  dwalletPubkey: Uint8Array; contract: Uint8Array; domainSeparator: Uint8Array; authorized: bigint; cap: bigint; allowlist: Uint8Array[]; bump }
export type IntentKind = 0|1|2;          // Mint, Burn, Move
export type IntentStatus = 0|1|2|3;      // PendingApproval, Approved, Executing, Executed
export type LegStatus = 0|1|2;           // Pending, Authorized, Confirmed
export interface Leg { action: 0|1; chainId: number; status: LegStatus; messageDigest: Uint8Array; signatureVoucher: Address|null;
  destTx: Uint8Array; executedAt: bigint; confirmedAt: bigint }
export interface Intent { address; asset; index: bigint; kind: IntentKind; status: IntentStatus; proposer: Address; amount: bigint;
  srcChain: number; dstChain: number; recipient: Uint8Array; source: Uint8Array; memo: string; createdAt: bigint; approvedAt: bigint;
  approvalsBitmap: number; approvalCount: number; legs: Leg[]; bump: number }
```

## PDAs (`sdk/src/pda.ts`): all async, return `[Address, bump]`
`findAssetPda(programId, createKey)`, `findChainPda(programId, asset, chainId)`, `findIntentPda(programId, asset, index: bigint)`,
`findMintAuthorityPda(programId, asset)`, `findCpiAuthorityPda(programId)` (seed `__ika_cpi_authority`),
`findSignatureVoucherPda(programId, intent, legIndex)` (seeds `signature_voucher`, intent, leg index byte: the ledger's own PDA, where
the Ika program creates the leg's voucher), `findCoordinatorPda(ikaProgram)`. dWallet addresses come from the Ika SDK (`ikaClient.getDWalletAddress`).

## Decoders (`sdk/src/accounts.ts`)
`decodeAsset(bytes)`, `decodeChain(bytes)`, `decodeIntent(bytes)`; and RPC helpers `fetchAsset(rpc, address)`, `fetchChains(rpc, programId, asset, chainIds)`,
`fetchIntents(rpc, programId, asset)` (0..intentCount), `fetchSignatureVoucher(rpc, address)` → `{status: 0|1|2|3, signature, messageDigest, dwallet, owner, signingKey, scheme, issuedEpoch}` (tag 108, 304 bytes; status 173, sig_len 174 u16, sig 176), `fetchDWallet(rpc, address)` → `{owner, curve, state, publicKey}` (tag 97, 185 bytes).

## Instructions (`sdk/src/instructions.ts`): return `@solana/kit` `Instruction` objects
```ts
buildInitAssetIx({programId, asset, bump, admin, payer, createKey, symbol, decimals, threshold, timelockSecs, globalCap, executor, ikaSigningKey, mintAuthorityBump, approvers})
buildAddChainIx({programId, asset, chain, bump, admin, payer, chainId, legKind, encoding, curve, signatureScheme, dwallet, dwalletPubkey, contract, domainSeparator, cap, authorized, allowlist})
buildCreateIntentIx({programId, asset, intent, bump, proposer, payer, kind, amount, srcChain, dstChain, recipient, source, memo, srcChainPda?, dstChainPda?})
buildApproveIntentIx({programId, asset, intent, approver})
buildExecuteLegSolanaIx({programId, asset, intent, chain, authority, payer, legIndex, cpiAuthorityBump, mint, tokenAccount, mintAuthority})
buildExecuteLegForeignIx({programId, asset, intent, chain, authority, payer, legIndex, signatureVoucherBump, cpiAuthorityBump, ikaProgram, coordinator, signatureVoucher, dwallet, cpiAuthority})
buildConfirmLegIx({programId, asset, intent, authority, legIndex, destTx: Uint8Array})
```
Exact byte layouts: see the `/// Data:` doc comments in `instructions.rs`. Discriminators 0..5. `execute_leg` refuses a voucher account that is not the leg's PDA at its canonical bump (`InvalidVoucher`), and a dWallet that is not the chain's, not active, or not owned by the ledger's CPI authority.

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

## Ika (`sdk/src/ika/index.ts`, export `@ika-rwa/ledger-sdk/ika`)
```ts
connectIka(rpc, { programId, grpcUrl, networkKey, chainNumber, networkValue }): { ikaClient: IkaClient; close(): void }  // mock mode, gRPC-Web
issuerKeys(rootSeed: Uint8Array, curve: 0|2): Promise<UserShareEncryptionKeys>   // one request key for every curve of a root seed
sdkCurve(curve: 0|2): Curve
sdkScheme(scheme: 0|5): { signatureAlgorithm, hashScheme }
compactSignature(scheme, signature): Uint8Array   // drops the recovery byte of a 65-byte ECDSA signature
// re-exported from @ika.xyz/pre-alpha-solana/kit: IkaClient, IkaTransaction, UserShareEncryptionKeys, Curve, Hash, SignatureAlgorithm, DWallet
```
The issuer is one Ika user. Its root seed gives an encryption key per curve and one request key. The request key signs every request to
the network, has the gas deposit, and is the `ikaSigningKey` the asset stores: the ledger writes it into each voucher as its signing key.
Network values for the devnet pre-alpha are `IKA_DEVNET_PRE_ALPHA` in `sdk/src/chains.ts`.

## Executor (`executor/src/index.ts`)
```ts
export type StepEvent = { leg: number; step: 'policy'|'ika-approval'|'ika-signature'|'deliver'|'confirm'; status: 'start'|'ok'|'error'; detail?: string; txHash?: string; signature?: string; signatureVoucher?: string }
export async function* runLeg(cfg: ExecutorConfig, intentIndex: bigint, legIndex: number): AsyncGenerator<StepEvent>
export interface ExecutorConfig { rpcUrl; wsUrl; programId; asset; ika: IkaNetworkConfig; executorKeypair: KeyPairSigner; issuer: IkaIssuerSecrets; deliver: 'mock'|'live' }
export interface IkaIssuerSecrets { rootSeed: Uint8Array; dwallets: { secp256k1?: DWallet; curve25519?: DWallet }; keys?: { secp256k1?: Uint8Array; curve25519?: Uint8Array } /* serialized, so execution derives nothing */ }
configFromDeployment(deployment, executorKeypair, deliver)   // reads the issuer secrets from LEDGER_IKA_ISSUER or keys/ika-issuer.json
loadIssuer(ikaClient, secrets), issuerKeysOf(secrets, curve), registerIssuer(client, ikaClient, wallet, issuer), sendIka(client, ikaClient, owner, keys, build)
```
`runLeg` resumes a leg the ledger already authorized: the voucher is found again from the intent, and a voucher that is already signed
gives its signature from Solana without a new request. Mock delivery: a deterministic fake tx hash formatted for the chain. Live delivery:
`viem` calling `MintController.mintWithAuthorization(auth, sig)` / `burnWithAuthorization`, and the Sui gRPC client calling the `tbill` package.

## Deployment config (`deployments/devnet.json`, written by `scripts/setup-devnet.ts`, read by app + executor)
```json
{ "programId": "...", "ikaProgram": "8siG...", "grpcUrl": "https://solana-alpha-dev-1.ika-network.net", "ikaNetworkKey": "<hex32>",
  "ikaChainNumber": 1, "ikaNetworkValue": 3, "ikaSigningKey": "<hex32>", "rpcUrl": "https://api.devnet.solana.com",
  "createKey": "<hex32>", "asset": "...", "mintAuthority": "...", "cpiAuthority": "...", "executor": "<pubkey>",
  "approvers": [{"name":"Alice","pubkey":"..."},{"name":"Bob","pubkey":"..."},{"name":"Carol","pubkey":"..."}],
  "dwallets": {"secp256k1": {"pda":"...","publicKeyHex":"...","evmAddress":"0x..."}, "curve25519": {"pda":"...","publicKeyHex":"...","suiAddress":"0x..."}},
  "chains": {"1": {"pda":"...","contract":"<mint>","treasury":"<ata>"}, "2": {"pda":"...","contract":"0x..","treasury":"0x.."}, ...} }
```
Secrets live in `keys/*.json` (gitignored): `admin.json`, `executor.json`, `approver-alice.json`, `approver-bob.json`, `approver-carol.json` (64-byte secret arrays, solana-keygen format), and `ika-issuer.json` (the issuer's Ika root seed and its dWallets, user shares included).
