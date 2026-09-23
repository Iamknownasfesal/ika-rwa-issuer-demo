#!/usr/bin/env tsx
/**
 * One-shot devnet setup for the issuer demo.
 *
 *   pnpm setup:devnet [--program-id <id>] [--skip-dkg] [--rpc <url>] [--grpc <host:port>]
 *
 * 1. keys/            admin, executor, alice, bob, carol (generated once, airdropped)
 * 2. Ika DKG          two zero-trust dWallets (secp256k1 for EVM chains, curve25519 for Sui)
 *                     via the pre-alpha gRPC; authority transferred to the ledger's CPI PDA
 * 3. Token-2022       TBILL mint (authority = mint_authority PDA) + PDA-owned treasury account
 * 4. init_asset       TBILL, cap 100M, 2-of-3 approvers, 5 s timelock
 * 4b. contracts       MintController on Sepolia / Base Sepolia / Tempo Moderato, Move package on Sui testnet
 * 5. add_chain × 5    Solana, Ethereum, Base, Sui, Tempo with the seed supply
 * 6. deployments/devnet.json
 *
 * Idempotent-ish: existing keys, asset and chain accounts are reused; pass
 * `--skip-dkg` to reuse dWallets recorded in a previous deployments file.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import {
  AccountRole, airdropFactory, createKeyPairSignerFromPrivateKeyBytes, getAddressDecoder, getAddressEncoder, lamports,
  type Address, type Instruction, type KeyPairSigner,
} from '@solana/kit';
import {
  CHAIN_LIST, ChainId, IKA_DWALLET_PROGRAM_DEVNET, IKA_GRPC_DEVNET, IkaCurve, LegKind, SOLANA_DEVNET_RPC, SOLANA_DEVNET_WS, TOKEN_2022_PROGRAM,
  buildAddChainIx, buildInitAssetIx, findAssetPda, findChainPda, findCpiAuthorityPda, findMintAuthorityPda,
  rawDomainSeparator, toHex, fromHex,
  type ChainMeta,
} from '@ika-rwa/ledger-sdk';
import { createIkaClient, findDwalletPda, transferOwnershipData } from '@ika-rwa/ledger-sdk/ika';
import { accountExists, createClient, pollAccount, repoRoot, sendInstructions, type Deployment, type SolanaClient } from '@ika-rwa/executor';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// ───────────────────────────── args / paths ───────────────────────────────

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const ROOT = repoRoot();
const KEYS = resolve(ROOT, 'keys');
const DEPLOYMENT = resolve(ROOT, 'deployments/devnet.json');
const RPC_URL = arg('rpc') ?? process.env.RPC_URL ?? SOLANA_DEVNET_RPC;
const WS_URL = process.env.WS_URL ?? RPC_URL.replace(/^http/, 'ws');
const GRPC_URL = arg('grpc') ?? process.env.GRPC_URL ?? IKA_GRPC_DEVNET;
const IKA_PROGRAM = (process.env.IKA_PROGRAM ?? IKA_DWALLET_PROGRAM_DEVNET) as Address;

const ONE = 1_000_000n; // 6 decimals
const SYSTEM_PROGRAM = '11111111111111111111111111111111' as Address;

const log = (step: string, msg: string) => console.log(`\x1b[36m[${step}]\x1b[0m ${msg}`);
const ok = (msg: string) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const val = (k: string, v: string) => console.log(`  \x1b[33m→\x1b[0m ${k}: ${v}`);

// ───────────────────────────── keys ───────────────────────────────────────

const enc = getAddressEncoder();
const pubkeyBytes = (a: Address) => new Uint8Array(enc.encode(a));

async function loadOrCreateKey(name: string): Promise<KeyPairSigner> {
  mkdirSync(KEYS, { recursive: true });
  const path = resolve(KEYS, `${name}.json`);
  if (existsSync(path)) {
    const bytes = new Uint8Array(JSON.parse(readFileSync(path, 'utf8')) as number[]);
    return createKeyPairSignerFromPrivateKeyBytes(bytes.slice(0, 32));
  }
  const seed = new Uint8Array(32);
  globalThis.crypto.getRandomValues(seed);
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  // solana-keygen format: seed || pubkey
  writeFileSync(path, JSON.stringify(Array.from([...seed, ...pubkeyBytes(signer.address)])));
  ok(`generated ${name} → ${signer.address}`);
  return signer;
}

async function ensureFunded(client: SolanaClient, who: KeyPairSigner, minSol: number): Promise<void> {
  const bal = await client.rpc.getBalance(who.address).send();
  if (Number(bal.value) >= minSol * 1e9) return;
  const airdrop = airdropFactory({ rpc: client.rpc, rpcSubscriptions: client.rpcSubscriptions } as Parameters<typeof airdropFactory>[0]);
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await airdrop({ commitment: 'confirmed', lamports: lamports(BigInt(Math.round(minSol * 1e9))), recipientAddress: who.address });
      ok(`airdropped ${minSol} SOL to ${who.address}`);
      return;
    } catch (e) {
      console.warn(`  airdrop attempt ${attempt} failed: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 3_000 * attempt));
    }
  }
  throw new Error(`could not fund ${who.address}; run: solana airdrop ${minSol} ${who.address} -u devnet`);
}

// ───────────────────────────── program id ─────────────────────────────────

function programIdFromKeypair(): Address {
  const path = resolve(ROOT, 'target/deploy/issuer_ledger-keypair.json');
  if (!existsSync(path)) throw new Error(`${path} not found: run scripts/deploy-program.sh or pass --program-id`);
  const bytes = new Uint8Array(JSON.parse(readFileSync(path, 'utf8')) as number[]);
  return getAddressDecoder().decode(bytes.slice(32, 64));
}

// ───────────────────────────── chain-native addresses ─────────────────────

function evmAddressFromSecp256k1(pk: Uint8Array): Uint8Array {
  const point = secp256k1.Point.fromHex(toHex(pk)); // accepts compressed or uncompressed
  const uncompressed = point.toBytes(false).slice(1); // drop 0x04
  return keccak_256(uncompressed).slice(12);
}
function suiAddressFromEd25519(pk: Uint8Array): Uint8Array {
  return blake2b(new Uint8Array([0x00, ...pk]), { dkLen: 32 });
}

// ───────────────────────────── Token-2022 ─────────────────────────────────

function u64(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  let x = v;
  for (let i = 0; i < 8; i++) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

function createAccountIx(payer: Address, newAccount: Address, lamportsAmount: bigint, space: bigint, owner: Address): Instruction {
  const data = new Uint8Array(52);
  data.set([0, 0, 0, 0], 0);
  data.set(u64(lamportsAmount), 4);
  data.set(u64(space), 12);
  data.set(pubkeyBytes(owner), 20);
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: newAccount, role: AccountRole.WRITABLE_SIGNER },
    ],
    data,
  };
}
/** InitializeMint2 (disc 20): decimals, mint_authority, freeze_authority = None. */
function initializeMint2Ix(mint: Address, decimals: number, mintAuthority: Address): Instruction {
  const data = new Uint8Array(1 + 1 + 32 + 1);
  data[0] = 20;
  data[1] = decimals;
  data.set(pubkeyBytes(mintAuthority), 2);
  data[34] = 0;
  return { programAddress: TOKEN_2022_PROGRAM, accounts: [{ address: mint, role: AccountRole.WRITABLE }], data };
}
/** MintTo (disc 7): amount. */
function mintToIx(mint: Address, account: Address, authority: Address, amount: bigint): Instruction {
  const data = new Uint8Array(9);
  data[0] = 7;
  data.set(u64(amount), 1);
  return {
    programAddress: TOKEN_2022_PROGRAM,
    accounts: [
      { address: mint, role: AccountRole.WRITABLE },
      { address: account, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.READONLY_SIGNER },
    ],
    data,
  };
}
/** SetAuthority (disc 6): authority_type 0 = MintTokens, new authority = Some(pubkey). */
function setMintAuthorityIx(mint: Address, current: Address, next: Address): Instruction {
  const data = new Uint8Array(35);
  data[0] = 6;
  data[1] = 0;
  data[2] = 1;
  data.set(pubkeyBytes(next), 3);
  return {
    programAddress: TOKEN_2022_PROGRAM,
    accounts: [
      { address: mint, role: AccountRole.WRITABLE },
      { address: current, role: AccountRole.READONLY_SIGNER },
    ],
    data,
  };
}
/** InitializeAccount3 (disc 18): owner. */
function initializeAccount3Ix(account: Address, mint: Address, owner: Address): Instruction {
  const data = new Uint8Array(33);
  data[0] = 18;
  data.set(pubkeyBytes(owner), 1);
  return {
    programAddress: TOKEN_2022_PROGRAM,
    accounts: [
      { address: account, role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.READONLY },
    ],
    data,
  };
}

// ───────────────────────────── main ───────────────────────────────────────

interface DWalletRecord {
  pda: string;
  publicKeyHex: string;
  evmAddress?: string;
  suiAddress?: string;
}

async function main(): Promise<void> {
  console.log('\n\x1b[1m═══ Ika RWA issuer ledger: devnet setup ═══\x1b[0m\n');
  const previous: Partial<Deployment> = existsSync(DEPLOYMENT) ? (JSON.parse(readFileSync(DEPLOYMENT, 'utf8')) as Deployment) : {};
  // Prefer an explicit flag, then the program id recorded by scripts/deploy-program.sh, then the local keypair.
  const programId = (arg('program-id') ?? previous.programId ?? programIdFromKeypair()) as Address;
  val('program', programId);
  val('rpc', RPC_URL);
  val('ika gRPC', GRPC_URL);
  val('ika program', IKA_PROGRAM);
  const client = createClient(RPC_URL, WS_URL);

  // ── 1. keys ──
  log('1/6', 'keys');
  const admin = await loadOrCreateKey('admin');
  const executor = await loadOrCreateKey('executor');
  const approverNames = ['alice', 'bob', 'carol'];
  const approvers = await Promise.all(approverNames.map((n) => loadOrCreateKey(`approver-${n}`)));
  await ensureFunded(client, admin, 0.5);
  await ensureFunded(client, executor, 0.5);
  for (const a of approvers) await ensureFunded(client, a, 0.2);

  // ── PDAs ──
  const createKey = previous.createKey ? fromHex(previous.createKey) : globalThis.crypto.getRandomValues(new Uint8Array(32));
  const [asset, assetBump] = await findAssetPda(programId, createKey);
  const [mintAuthority, mintAuthorityBump] = await findMintAuthorityPda(programId, asset);
  const [cpiAuthority] = await findCpiAuthorityPda(programId);
  val('asset', asset);
  val('mint authority', mintAuthority);
  val('cpi authority', cpiAuthority);

  // ── 2. dWallets ──
  log('2/6', 'Ika dWallets (zero-trust: encrypted user share held by the issuer, network share gated by the ledger)');
  const dwallets: Record<string, DWalletRecord> = {};
  if (flag('skip-dkg')) {
    if (!previous.dwallets?.secp256k1 || !previous.dwallets?.curve25519) throw new Error('--skip-dkg needs dwallets in deployments/devnet.json');
    for (const [name, rec] of Object.entries(previous.dwallets) as [string, DWalletRecord][]) {
      const pk = fromHex(rec.publicKeyHex);
      if (name === 'secp256k1') rec.evmAddress ??= `0x${toHex(evmAddressFromSecp256k1(pk))}`;
      else rec.suiAddress ??= `0x${toHex(suiAddressFromEd25519(pk))}`;
      dwallets[name] = rec;
    }
    ok('reusing dWallets from previous deployment');
  } else {
    const ika = createIkaClient(GRPC_URL, { publicKey: pubkeyBytes(executor.address) });
    try {
      for (const [name, curve] of [
        ['secp256k1', IkaCurve.Secp256k1],
        ['curve25519', IkaCurve.Curve25519],
      ] as const) {
        log('DKG', `${name} …`);
        const r = await ika.requestDkg(curve);
        const [pda] = await findDwalletPda(IKA_PROGRAM, curve, r.publicKey);
        ok(`${name} public key ${toHex(r.publicKey)}`);
        await pollAccount(client.rpc, pda, (d) => d[0] === 2, 60_000);
        ok(`dWallet on-chain ${pda}`);
        // Hand the dWallet to the ledger program: only its CPI authority PDA can approve messages now.
        const ix: Instruction = {
          programAddress: IKA_PROGRAM,
          accounts: [
            { address: executor.address, role: AccountRole.READONLY_SIGNER },
            { address: pda, role: AccountRole.WRITABLE },
          ],
          data: transferOwnershipData(pubkeyBytes(cpiAuthority)),
        };
        const sent = await sendInstructions(client, executor, [ix]);
        ok(`authority → ${cpiAuthority} (${sent.signature})`);
        const rec: DWalletRecord = { pda, publicKeyHex: toHex(r.publicKey) };
        if (curve === IkaCurve.Secp256k1) rec.evmAddress = `0x${toHex(evmAddressFromSecp256k1(r.publicKey))}`;
        else rec.suiAddress = `0x${toHex(suiAddressFromEd25519(r.publicKey))}`;
        dwallets[name] = rec;
      }
    } finally {
      ika.close();
    }
  }

  // Persist what we have so far: a later failure must not lose the dWallets or the asset createKey.
  mkdirSync(resolve(ROOT, 'deployments'), { recursive: true });
  writeFileSync(DEPLOYMENT, JSON.stringify({ ...previous, programId, ikaProgram: IKA_PROGRAM, rpcUrl: RPC_URL, wsUrl: WS_URL, grpcUrl: GRPC_URL, createKey: toHex(createKey), dwallets }, null, 2) + '\n');

  // ── 3. Token-2022 mint + treasury ──
  log('3/6', 'Token-2022 TBILL mint + PDA-owned treasury');
  let mint: Address;
  let treasury: Address;
  const prevSolana = previous.chains?.[String(ChainId.Solana)];
  if (prevSolana && (await accountExists(client.rpc, prevSolana.contract as Address))) {
    mint = prevSolana.contract as Address;
    treasury = prevSolana.treasury as Address;
    ok(`reusing mint ${mint}`);
  } else {
    const mintKp = await loadOrCreateKey('tbill-mint');
    const treasuryKp = await loadOrCreateKey('tbill-treasury');
    mint = mintKp.address;
    treasury = treasuryKp.address;
    const mintRent = await client.rpc.getMinimumBalanceForRentExemption(82n).send();
    const accRent = await client.rpc.getMinimumBalanceForRentExemption(165n).send();
    // The mint starts under the admin so the seeded Solana supply can be minted into the treasury;
    // the mint authority is then handed to the ledger's PDA and never leaves the program again.
    const SOLANA_SEED_SUPPLY = BigInt((JSON.parse(readFileSync(resolve(ROOT, 'scripts/seed-supply.json'), 'utf8')) as Record<string, { authorized: string }>)['1'].authorized);
    if (!(await accountExists(client.rpc, mint))) {
      await sendInstructions(client, admin, [
        createAccountIx(admin.address, mint, mintRent, 82n, TOKEN_2022_PROGRAM),
        initializeMint2Ix(mint, 6, admin.address),
        createAccountIx(admin.address, treasury, accRent, 165n, TOKEN_2022_PROGRAM),
        initializeAccount3Ix(treasury, mint, mintAuthority),
        mintToIx(mint, treasury, admin.address, SOLANA_SEED_SUPPLY),
        setMintAuthorityIx(mint, admin.address, mintAuthority),
      ], [mintKp, treasuryKp]);
      ok(`mint ${mint}: ${SOLANA_SEED_SUPPLY / ONE} TBILL minted to treasury ${treasury}; mint authority → ${mintAuthority}`);
    }
  }

  // ── 4. init_asset ──
  log('4/6', 'init_asset');
  if (await accountExists(client.rpc, asset)) {
    ok(`asset ${asset} already initialized`);
  } else {
    const ix = buildInitAssetIx({
      programId, asset, bump: assetBump, admin: admin.address, payer: admin.address, createKey, symbol: 'TBILL', decimals: 6, threshold: 2,
      timelockSecs: BigInt(process.env.TIMELOCK_SECS ?? 5), globalCap: 100_000_000n * ONE, executor: executor.address, ikaProgram: IKA_PROGRAM,
      mintAuthorityBump, approvers: approvers.map((a) => a.address),
    });
    const sent = await sendInstructions(client, admin, [ix]);
    ok(`asset ${asset} (${sent.signature})`);
  }
  // Persist the asset so the destination-chain deploy scripts can bind their controllers to it.
  writeFileSync(DEPLOYMENT, JSON.stringify({
    ...previous, programId, ikaProgram: IKA_PROGRAM, rpcUrl: RPC_URL, wsUrl: WS_URL, grpcUrl: GRPC_URL, createKey: toHex(createKey), dwallets,
    asset, mintAuthority, cpiAuthority, executor: executor.address,
    approvers: approverNames.map((n, i) => ({ name: n[0].toUpperCase() + n.slice(1), pubkey: approvers[i].address })),
  }, null, 2) + '\n');

  // ── 4b. destination-chain contracts (bound to this asset; their addresses feed the domain separators) ──
  if (!flag('skip-contracts')) {
    log('4b', 'destination-chain contracts (EVM MintController, Sui package)');
    for (const script of ['scripts/deploy-evm.ts', 'scripts/deploy-sui.ts']) {
      if (!existsSync(resolve(ROOT, script))) continue;
      const r = spawnSync('pnpm', ['exec', 'tsx', script], { cwd: ROOT, stdio: 'inherit', env: process.env });
      if (r.status !== 0) throw new Error(`${script} exited with ${r.status}`);
    }
  }
  const evmDeployments = readJson<Record<string, { mintController: string; treasury: string; domainSeparator: string }>>('deployments/evm.json') ?? {};
  const suiDeployment = readJson<{ packageId?: string; controllerId?: string; treasury?: string; domainSeparatorHex?: string }>('deployments/sui.json');

  // ── 5. add_chain ──
  log('5/6', 'chain deployments');
  const seedFile = JSON.parse(readFileSync(resolve(ROOT, 'scripts/seed-supply.json'), 'utf8')) as Record<string, { authorized: string; cap: string }>;
  const seed: Record<number, { authorized: bigint; cap: bigint }> = Object.fromEntries(
    Object.entries(seedFile)
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => [Number(k), { authorized: BigInt(v.authorized), cap: BigInt(v.cap) }]),
  );
  const chains: Deployment['chains'] = {};
  for (const meta of CHAIN_LIST) {
    const [chainPda, bump] = await findChainPda(programId, asset, meta.id);
    const { contract, contractText, treasuryBytes, treasuryText, domainSeparator, dwallet, dwalletPubkey } = chainParams(meta, { mint, treasury, dwallets, evmDeployments, suiDeployment });
    chains[String(meta.id)] = { pda: chainPda, contract: contractText, treasury: treasuryText };
    if (await accountExists(client.rpc, chainPda)) {
      ok(`${meta.name} already registered (${chainPda})`);
      continue;
    }
    const ix = buildAddChainIx({
      programId, asset, chain: chainPda, bump, admin: admin.address, payer: admin.address, chainId: meta.id, legKind: meta.legKind, encoding: meta.encoding,
      curve: meta.curve, signatureScheme: meta.signatureScheme, dwallet, dwalletPubkey, contract, domainSeparator,
      cap: seed[meta.id].cap, authorized: seed[meta.id].authorized, allowlist: [treasuryBytes],
    });
    const sent = await sendInstructions(client, admin, [ix]);
    ok(`${meta.name}: ${chainPda} authorized ${seed[meta.id].authorized / ONE} / cap ${seed[meta.id].cap / ONE} (${sent.signature})`);
  }

  // ── 6. deployments/devnet.json ──
  log('6/6', 'writing deployments/devnet.json');
  const deployment: Deployment = {
    programId, ikaProgram: IKA_PROGRAM, rpcUrl: RPC_URL, wsUrl: WS_URL, grpcUrl: GRPC_URL, createKey: toHex(createKey), asset, mintAuthority, cpiAuthority,
    executor: executor.address,
    approvers: approverNames.map((n, i) => ({ name: n[0].toUpperCase() + n.slice(1), pubkey: approvers[i].address })),
    dwallets, chains,
  };
  mkdirSync(resolve(ROOT, 'deployments'), { recursive: true });
  writeFileSync(DEPLOYMENT, JSON.stringify(deployment, null, 2) + '\n');
  ok(DEPLOYMENT);
  console.log('\n\x1b[1m\x1b[32m═══ setup complete ═══\x1b[0m\n');
}

function readJson<T>(rel: string): T | null {
  const p = resolve(ROOT, rel);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null;
}

function chainParams(meta: ChainMeta, ctx: {
  mint: Address; treasury: Address; dwallets: Record<string, DWalletRecord>;
  evmDeployments: Record<string, { mintController: string; treasury: string; domainSeparator: string }>;
  suiDeployment: { packageId?: string; controllerId?: string; treasury?: string; domainSeparatorHex?: string } | null;
}) {
  const zero = SYSTEM_PROGRAM;
  if (meta.legKind === LegKind.SolanaNative) {
    return {
      contract: pubkeyBytes(ctx.mint), contractText: ctx.mint,
      treasuryBytes: pubkeyBytes(ctx.treasury), treasuryText: ctx.treasury,
      domainSeparator: rawDomainSeparator(meta.key), dwallet: zero, dwalletPubkey: new Uint8Array(),
    };
  }
  const dw = meta.curve === IkaCurve.Secp256k1 ? ctx.dwallets.secp256k1 : ctx.dwallets.curve25519;
  const dwalletPubkey = fromHex(dw.publicKeyHex);
  if (meta.encoding === 1) {
    const live = ctx.evmDeployments[String(meta.evmChainId)];
    if (!live) throw new Error(`no MintController for ${meta.name} in deployments/evm.json: run pnpm deploy:evm`);
    return {
      contract: fromHex(live.mintController), contractText: live.mintController,
      treasuryBytes: fromHex(live.treasury), treasuryText: live.treasury,
      domainSeparator: fromHex(live.domainSeparator), dwallet: dw.pda as Address, dwalletPubkey,
    };
  }
  const sui = ctx.suiDeployment;
  if (!sui?.controllerId || !sui.treasury || !sui.domainSeparatorHex) throw new Error('no Sui controller in deployments/sui.json: run pnpm deploy:sui');
  return {
    contract: fromHex(sui.controllerId), contractText: sui.controllerId,
    treasuryBytes: fromHex(sui.treasury), treasuryText: sui.treasury,
    domainSeparator: fromHex(sui.domainSeparatorHex), dwallet: dw.pda as Address, dwalletPubkey,
  };
}

main().catch((e) => {
  console.error('\n\x1b[31msetup failed:\x1b[0m', e);
  process.exit(1);
});
