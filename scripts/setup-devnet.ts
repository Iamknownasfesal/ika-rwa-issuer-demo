#!/usr/bin/env tsx
/**
 * One-shot devnet setup for the issuer demo.
 *
 *   pnpm setup:devnet [--program-id <id>] [--fresh] [--skip-contracts] [--rpc <url>] [--grpc <url>]
 *
 * 1. keys/            admin, executor, alice, bob, carol (generated once; funded from the Solana CLI wallet)
 * 2. Ika              the issuer becomes a user of the network (encryption keys, gas deposit), then two
 *                     zero-trust dWallets (secp256k1 for EVM chains, curve25519 for Sui) through the SDK
 * 3. Token-2022       TBILL mint (authority = mint_authority PDA) + PDA-owned treasury account
 * 4. init_asset       TBILL, cap 100M, 2-of-3 approvers, 5 s timelock, the issuer's Ika request key
 * 4b. contracts       MintController on Sepolia / Base Sepolia / Tempo Moderato, Move package on Sui testnet
 * 5. add_chain × 5    Solana, Ethereum, Base, Sui, Tempo with the seed supply
 * 5b. hand-over       each dWallet's owner becomes the ledger's CPI authority, after its rules exist
 * 6. deployments/devnet.json
 *
 * Re-running resumes: existing keys, dWallets, asset and chain accounts are reused. A new asset is
 * created when the Ika network, the issuer's request key or a dWallet changed (an Ika wipe), or
 * with `--fresh`.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import {
  AccountRole, createKeyPairSignerFromPrivateKeyBytes, getAddressDecoder, getAddressEncoder,
  type Address, type Instruction, type KeyPairSigner,
} from '@solana/kit';
import {
  CHAIN_LIST, ChainId, IKA_DEVNET_PRE_ALPHA, IkaCurve, LegKind, SOLANA_DEVNET_RPC, TOKEN_2022_PROGRAM,
  buildAddChainIx, buildInitAssetIx, fetchDWallet, findAssetPda, findChainPda, findCpiAuthorityPda, findMintAuthorityPda,
  rawDomainSeparator, toHex, fromHex,
  type ChainMeta,
} from '@ika-rwa/ledger-sdk';
import { sdkCurve } from '@ika-rwa/ledger-sdk/ika';
import {
  accountExists, connectIka, createClient, ikaIssuerPath, loadIkaIssuer, loadIssuer, loadKeypair, registerIssuer, repoRoot, saveIkaIssuer, sendIka,
  sendInstructions, type DWalletName, type Deployment, type IkaIssuerSecrets, type SolanaClient,
} from '@ika-rwa/executor';
import { homedir } from 'node:os';
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
const GRPC_URL = arg('grpc') ?? process.env.GRPC_URL ?? IKA_DEVNET_PRE_ALPHA.grpcUrl;
// The ledger program is built for one Ika program (`--features devnet-pre-alpha`); this must be the same one.
const IKA_PROGRAM = (process.env.IKA_PROGRAM ?? IKA_DEVNET_PRE_ALPHA.programId) as Address;
const IKA_NETWORK_KEY = process.env.IKA_NETWORK_KEY ?? IKA_DEVNET_PRE_ALPHA.networkKey;
const IKA_NET = { programId: IKA_PROGRAM, grpcUrl: GRPC_URL, networkKey: IKA_NETWORK_KEY, chainNumber: IKA_DEVNET_PRE_ALPHA.chainNumber, networkValue: IKA_DEVNET_PRE_ALPHA.networkValue };
/** What the deployment file records about the Ika network. */
const IKA_FIELDS = { ikaProgram: IKA_PROGRAM, grpcUrl: GRPC_URL, ikaNetworkKey: IKA_NETWORK_KEY, ikaChainNumber: IKA_NET.chainNumber, ikaNetworkValue: IKA_NET.networkValue };

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

/** System program `Transfer`. */
function transferIx(from: Address, to: Address, amount: bigint): Instruction {
  const data = new Uint8Array(12);
  data.set([2, 0, 0, 0], 0);
  data.set(u64(amount), 4);
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: from, role: AccountRole.WRITABLE_SIGNER },
      { address: to, role: AccountRole.WRITABLE },
    ],
    data,
  };
}

/**
 * Top `who` up to `minSol` from the funding wallet. The devnet RPC faucet is closed, so the SOL
 * comes from a wallet that already holds some: `FUNDER_KEYPAIR`, or the Solana CLI's default key.
 */
/** A new keypair, written over `keys/<name>.json`. */
async function freshKey(name: string): Promise<KeyPairSigner> {
  const seed = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  writeFileSync(resolve(KEYS, `${name}.json`), JSON.stringify(Array.from([...seed, ...pubkeyBytes(signer.address)])));
  return signer;
}

async function ensureFunded(client: SolanaClient, who: KeyPairSigner, minSol: number): Promise<void> {
  const bal = await client.rpc.getBalance(who.address).send();
  const missing = BigInt(Math.round(minSol * 1e9)) - bal.value;
  if (missing <= 0n) return;
  const funderPath = process.env.FUNDER_KEYPAIR ?? resolve(homedir(), '.config/solana/id.json');
  if (!existsSync(funderPath)) throw new Error(`${who.address} needs ${Number(missing) / 1e9} SOL: fund it at https://faucet.solana.com, or set FUNDER_KEYPAIR`);
  const funder = await loadKeypair(funderPath);
  await sendInstructions(client, funder, [transferIx(funder.address, who.address, missing)]);
  ok(`funded ${who.address} with ${Number(missing) / 1e9} SOL from ${funder.address}`);
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
  val('ika network', GRPC_URL);
  val('ika program', IKA_PROGRAM);
  const client = createClient(RPC_URL, WS_URL);

  // ── 1. keys ──
  log('1/6', 'keys');
  const admin = await loadOrCreateKey('admin');
  const executor = await loadOrCreateKey('executor');
  const approverNames = ['alice', 'bob', 'carol'];
  const approvers = await Promise.all(approverNames.map((n) => loadOrCreateKey(`approver-${n}`)));
  await ensureFunded(client, admin, 0.3);
  await ensureFunded(client, executor, 0.3);
  for (const a of approvers) await ensureFunded(client, a, 0.1);
  const [cpiAuthority] = await findCpiAuthorityPda(programId);

  // ── 2. the issuer on Ika, and its dWallets ──
  log('2/6', 'Ika: the issuer and its dWallets (zero-trust: the issuer holds the user share, the ledger decides what is signed)');
  const secrets: IkaIssuerSecrets = loadIkaIssuer() ?? { rootSeed: globalThis.crypto.getRandomValues(new Uint8Array(32)), dwallets: {} };
  // The root seed decrypts the user share of every dWallet made with it: keep it before anything is created.
  saveIkaIssuer(secrets);
  const dwallets: Record<string, DWalletRecord> = {};
  let ikaSigningKey: Uint8Array;
  const { ikaClient, close } = connectIka(client.rpc, IKA_NET);
  try {
    const issuer = await loadIssuer(ikaClient, secrets.rootSeed);
    ikaSigningKey = issuer.requestKey;
    val('issuer request key', toHex(ikaSigningKey));
    const created = await registerIssuer(client, ikaClient, executor, issuer);
    ok(created.length ? `registered with the network: ${created.join(', ')}` : 'already registered with the network');

    for (const [name, curve] of [
      ['secp256k1', IkaCurve.Secp256k1],
      ['curve25519', IkaCurve.Curve25519],
    ] as const satisfies readonly (readonly [DWalletName, number])[]) {
      const keys = issuer.keys[curve];
      let dWallet = secrets.dwallets[name];
      // A dWallet kept from an earlier run is reused while its account is still on Solana (a wipe removes it).
      if (dWallet && !(await accountExists(client.rpc, ikaClient.getDWalletAddress(dWallet)))) dWallet = undefined;
      if (!dWallet) {
        log('DKG', `${name} …`);
        ({ dWallet } = await ikaClient.requestDWalletDKG({ curve: sdkCurve(curve), userShareEncryptionKeys: keys, owner: executor.address }));
        // Keep the dWallet before its share is accepted: its user share exists nowhere else.
        secrets.dwallets[name] = dWallet;
        saveIkaIssuer(secrets);
      }
      const pda = ikaClient.getDWalletAddress(dWallet);
      const onChain = await fetchDWallet(client.rpc, pda);
      if (!onChain) throw new Error(`dWallet ${pda} is not on Solana`);
      if (onChain.state !== 1) {
        // The network wrote the dWallet and left the issuer's share waiting; the acceptance makes it usable.
        await sendIka(client, ikaClient, executor, keys, (tx) => tx.acceptEncryptedUserShare({ dWallet }));
        await ikaClient.waitForDWallet(dWallet, { timeout: 300_000, interval: 2_000 });
      }
      if (dWallet.acceptance) {
        delete dWallet.acceptance;
        saveIkaIssuer(secrets);
      }
      ok(`${name} dWallet ${pda}, public key ${toHex(dWallet.publicKey)}`);
      const rec: DWalletRecord = { pda, publicKeyHex: toHex(dWallet.publicKey) };
      if (curve === IkaCurve.Secp256k1) rec.evmAddress = `0x${toHex(evmAddressFromSecp256k1(dWallet.publicKey))}`;
      else rec.suiAddress = `0x${toHex(suiAddressFromEd25519(dWallet.publicKey))}`;
      dwallets[name] = rec;
    }

    // ── the asset this run works on ──
    // An asset is bound to its Ika network, its signing key and its dWallets. When one of them
    // changed (an Ika wipe, a new root seed), the old asset cannot sign any more: start a new one.
    const same = previous.asset !== undefined && !flag('fresh') && previous.ikaProgram === IKA_PROGRAM && previous.ikaSigningKey === toHex(ikaSigningKey)
      && previous.dwallets?.secp256k1?.pda === dwallets.secp256k1.pda && previous.dwallets?.curve25519?.pda === dwallets.curve25519.pda;
    if (!same && previous.asset) ok(`the Ika network, signing key or dWallets changed since ${previous.asset}: creating a new asset`);
    const resume: Partial<Deployment> = same ? previous : {};
    await setupAsset({ client, ikaClient, issuer, programId, admin, executor, approvers, approverNames, cpiAuthority, dwallets, secrets, ikaSigningKey, resume });
  } finally {
    close();
  }
  console.log('\n\x1b[1m\x1b[32m═══ setup complete ═══\x1b[0m\n');
}

interface AssetSetup {
  client: SolanaClient;
  ikaClient: ReturnType<typeof connectIka>['ikaClient'];
  issuer: Awaited<ReturnType<typeof loadIssuer>>;
  programId: Address;
  admin: KeyPairSigner;
  executor: KeyPairSigner;
  approvers: KeyPairSigner[];
  approverNames: string[];
  cpiAuthority: Address;
  dwallets: Record<string, DWalletRecord>;
  secrets: IkaIssuerSecrets;
  ikaSigningKey: Uint8Array;
  /** The previous deployment, when this run continues it; empty for a new asset. */
  resume: Partial<Deployment>;
}

async function setupAsset(x: AssetSetup): Promise<void> {
  const { client, ikaClient, issuer, programId, admin, executor, approvers, approverNames, cpiAuthority, dwallets, secrets, ikaSigningKey, resume: previous } = x;
  const createKey = previous.createKey ? fromHex(previous.createKey) : globalThis.crypto.getRandomValues(new Uint8Array(32));
  const [asset, assetBump] = await findAssetPda(programId, createKey);
  const [mintAuthority, mintAuthorityBump] = await findMintAuthorityPda(programId, asset);
  val('asset', asset);
  val('mint authority', mintAuthority);
  val('cpi authority', cpiAuthority);
  const base = { programId, ...IKA_FIELDS, ikaSigningKey: toHex(ikaSigningKey), rpcUrl: RPC_URL, wsUrl: WS_URL, createKey: toHex(createKey), dwallets };

  // Persist what we have so far: a later failure must not lose the asset createKey.
  mkdirSync(resolve(ROOT, 'deployments'), { recursive: true });
  writeFileSync(DEPLOYMENT, JSON.stringify({ ...previous, ...base, asset, mintAuthority, cpiAuthority, executor: executor.address }, null, 2) + '\n');

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
    // A new asset gets a new mint: the mint authority is the asset's own PDA.
    const [mintKp, treasuryKp] = await Promise.all([freshKey('tbill-mint'), freshKey('tbill-treasury')]);
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
      timelockSecs: BigInt(process.env.TIMELOCK_SECS ?? 5), globalCap: 100_000_000n * ONE, executor: executor.address, ikaSigningKey,
      mintAuthorityBump, approvers: approvers.map((a) => a.address),
    });
    const sent = await sendInstructions(client, admin, [ix]);
    ok(`asset ${asset} (${sent.signature})`);
  }
  // Persist the asset so the destination-chain deploy scripts can bind their controllers to it.
  writeFileSync(DEPLOYMENT, JSON.stringify({
    ...previous, ...base,
    asset, mintAuthority, cpiAuthority, executor: executor.address,
    chains: { ...previous.chains, [String(ChainId.Solana)]: { pda: (await findChainPda(programId, asset, ChainId.Solana))[0], contract: mint, treasury } },
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

  // ── 5b. hand the dWallets to the ledger ──
  // Last, once every chain's rules are on Solana: from here only the ledger's CPI authority can
  // issue a signature voucher for them, and only for a leg that passed the policy.
  log('5b', 'dWallets → the ledger');
  for (const [name, curve] of [['secp256k1', IkaCurve.Secp256k1], ['curve25519', IkaCurve.Curve25519]] as const) {
    const dWallet = secrets.dwallets[name]!;
    const onChain = await fetchDWallet(client.rpc, dwallets[name].pda as Address);
    if (onChain?.owner === cpiAuthority) {
      ok(`${name} already owned by ${cpiAuthority}`);
    } else if (onChain?.owner === executor.address) {
      const { sent } = await sendIka(client, ikaClient, executor, issuer.keys[curve], (tx) => tx.transferDWallet({ dWallet, newOwner: cpiAuthority }));
      ok(`${name} owner → ${cpiAuthority} (${sent.signature})`);
    } else {
      throw new Error(`${name} dWallet ${dwallets[name].pda} is owned by ${onChain?.owner}, neither the executor nor the ledger`);
    }
  }

  // ── 6. deployments/devnet.json ──
  log('6/6', 'writing deployments/devnet.json');
  const deployment: Deployment = {
    ...base, asset, mintAuthority, cpiAuthority,
    executor: executor.address,
    approvers: approverNames.map((n, i) => ({ name: n[0].toUpperCase() + n.slice(1), pubkey: approvers[i].address })),
    dwallets, chains,
  };
  mkdirSync(resolve(ROOT, 'deployments'), { recursive: true });
  writeFileSync(DEPLOYMENT, JSON.stringify(deployment, null, 2) + '\n');
  ok(DEPLOYMENT);
  ok(`${ikaIssuerPath()} holds the issuer's Ika root seed and dWallet shares: keep it secret`);
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
