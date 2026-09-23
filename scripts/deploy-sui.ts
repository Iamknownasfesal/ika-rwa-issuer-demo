/**
 * Publish the TBILL Move package to Sui testnet and bind its MintController to the
 * Curve25519 dWallet + ledger recorded in deployments/devnet.json.
 *
 *   pnpm deploy:sui                # publish + set_params, writes deployments/sui.json
 *   pnpm deploy:sui --rebind       # only re-run set_params on the existing deployment
 *
 * Deployer key: keys/sui-deployer.json ({ "secretKey": "suiprivkey1…" }); generated if missing and
 * funded from the testnet faucet. It is also the Sui treasury and relayer, so it must be a fresh
 * testnet-only key: never a key from the Sui CLI keystore, which may hold mainnet assets.
 */
import { fetchChains, fromBase58, keccak256, toHex } from '@ika-rwa/ledger-sdk';
import { createClient, loadDeployment, repoRoot } from '@ika-rwa/executor';
// Not yet re-exported from the executor index (integration pending); import the module directly.
import { pickSuiRpc } from '../executor/src/deliver/sui.js';
import { SuiClient } from '@mysten/sui/client';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Address } from '@solana/kit';

const ROOT = repoRoot();
const PKG_DIR = resolve(ROOT, 'contracts/sui/tbill');
const KEY_FILE = resolve(ROOT, 'keys/sui-deployer.json');
const OUT = resolve(ROOT, 'deployments/sui.json');
const NETWORK = 'testnet' as const;
const CHAIN_SUI = 4;
const MIN_BALANCE = 300_000_000n; // 0.3 SUI

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const val = (k: string, v: string) => console.log(`  \x1b[33m→\x1b[0m ${k}: ${v}`);
const log = (s: string, m: string) => console.log(`\x1b[36m[${s}]\x1b[0m ${m}`);

function loadOrCreateKey(): Ed25519Keypair {
  if (existsSync(KEY_FILE)) {
    const { secretKey } = JSON.parse(readFileSync(KEY_FILE, 'utf8')) as { secretKey: string };
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  const kp = new Ed25519Keypair();
  mkdirSync(resolve(ROOT, 'keys'), { recursive: true });
  writeFileSync(KEY_FILE, JSON.stringify({ secretKey: kp.getSecretKey(), address: kp.toSuiAddress() }, null, 2) + '\n');
  ok(`generated sui-deployer → ${kp.toSuiAddress()}`);
  return kp;
}

async function balance(client: SuiClient, addr: string): Promise<bigint> {
  return BigInt((await client.getBalance({ owner: addr })).totalBalance);
}

async function ensureFunded(client: SuiClient, preferred: Ed25519Keypair): Promise<Ed25519Keypair> {
  const addr = preferred.toSuiAddress();
  if ((await balance(client, addr)) >= MIN_BALANCE) return preferred;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await requestSuiFromFaucetV2({ host: getFaucetHost(NETWORK), recipient: addr });
      await new Promise((r) => setTimeout(r, 4_000));
      const b = await balance(client, addr);
      if (b >= MIN_BALANCE) {
        ok(`faucet funded ${addr} (${Number(b) / 1e9} SUI)`);
        return preferred;
      }
    } catch (e) {
      console.warn(`  faucet attempt ${attempt} failed: ${(e as Error).message.split('\n')[0]}`);
      await new Promise((r) => setTimeout(r, 5_000 * attempt));
    }
  }
  throw new Error(
    `could not fund ${addr}. Get testnet SUI via https://faucet.sui.io/?network=testnet or \`sui client faucet --address ${addr}\`, then re-run.`,
  );
}

interface BuildOutput { modules: string[]; dependencies: string[] }

function buildPackage(): BuildOutput {
  const out = execSync(`sui move build --dump-bytecode-as-base64 --path "${PKG_DIR}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const json = out.slice(out.indexOf('{'));
  return JSON.parse(json) as BuildOutput;
}

async function main(): Promise<void> {
  console.log('\n\x1b[1m═══ TBILL on Sui testnet ═══\x1b[0m\n');
  const dev = loadDeployment();
  const dw = dev.dwallets?.curve25519;
  if (!dw) throw new Error('deployments/devnet.json has no curve25519 dWallet; run pnpm setup:devnet first');
  const dwalletPubkey = Buffer.from(dw.publicKeyHex, 'hex');
  const ledger = fromBase58(dev.asset);
  val('dWallet pubkey', dw.publicKeyHex);
  val('ledger (Asset PDA)', dev.asset);

  // Domain separator: whatever the Solana ChainDeployment for Sui stores (so live messages verify),
  // falling back to the canonical constant for a fresh deployment.
  let domain = keccak256(new TextEncoder().encode('ika-rwa:sui-testnet'));
  try {
    const sol = createClient(dev.rpcUrl, dev.wsUrl ?? '');
    const [chain] = await fetchChains(sol.rpc, dev.programId as Address, dev.asset as Address, [CHAIN_SUI]);
    if (chain) domain = chain.domainSeparator;
  } catch (e) {
    console.warn(`  could not read the Sui ChainDeployment from Solana (${(e as Error).message}); using keccak256("ika-rwa:sui-testnet")`);
  }
  val('domain separator', toHex(domain));

  const RPC = await pickSuiRpc();
  val('rpc', RPC);
  const client = new SuiClient({ url: RPC });
  log('1/3', 'deployer');
  const deployer = await ensureFunded(client, loadOrCreateKey());
  const deployerAddr = deployer.toSuiAddress();
  val('deployer', deployerAddr);

  let packageId: string;
  let controllerId: string;
  let adminCapId: string;
  let upgradeCapId: string | undefined;
  let txDigest: string;
  const previous = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as Record<string, string>) : null;

  if (flag('rebind') && previous) {
    ({ packageId, controllerId, adminCapId, upgradeCapId, txDigest } = previous as never);
    ok(`reusing package ${packageId}`);
  } else {
    log('2/3', 'sui move build + publish');
    const { modules, dependencies } = buildPackage();
    const tx = new Transaction();
    tx.setSender(deployerAddr);
    const [cap] = tx.publish({ modules, dependencies });
    tx.transferObjects([cap], deployerAddr);
    const res = await client.signAndExecuteTransaction({ signer: deployer, transaction: tx, options: { showObjectChanges: true, showEffects: true } });
    if (res.effects?.status.status !== 'success') throw new Error(`publish failed: ${res.effects?.status.error}`);
    await client.waitForTransaction({ digest: res.digest });
    txDigest = res.digest;
    const changes = res.objectChanges ?? [];
    const published = changes.find((c) => c.type === 'published');
    if (!published || published.type !== 'published') throw new Error('no published package in object changes');
    packageId = published.packageId;
    const created = (suffix: string) => {
      const c = changes.find((x) => x.type === 'created' && x.objectType.endsWith(suffix));
      if (!c || c.type !== 'created') throw new Error(`created object ${suffix} not found`);
      return c.objectId;
    };
    controllerId = created('::tbill::MintController');
    adminCapId = created('::tbill::AdminCap');
    upgradeCapId = created('::package::UpgradeCap');
    ok(`published ${packageId} (${txDigest})`);
    val('MintController', controllerId);
    val('AdminCap', adminCapId);
  }

  log('3/3', 'set_params (dWallet pubkey, ledger, domain)');
  const tx = new Transaction();
  tx.setSender(deployerAddr);
  tx.moveCall({
    target: `${packageId}::tbill::set_params`,
    arguments: [
      tx.object(adminCapId),
      tx.object(controllerId),
      tx.pure.vector('u8', Array.from(dwalletPubkey)),
      tx.pure.vector('u8', Array.from(ledger)),
      tx.pure.vector('u8', Array.from(domain)),
    ],
  });
  // A fresh package mints Sui's starting supply to the treasury (the relayer), matching the ledger.
  const rebinding = flag('rebind') && previous;
  const genesis = BigInt((JSON.parse(readFileSync(resolve(ROOT, 'scripts/seed-supply.json'), 'utf8')) as Record<string, { authorized: string }>)['4'].authorized);
  if (!rebinding) {
    tx.moveCall({
      target: `${packageId}::tbill::genesis_mint`,
      arguments: [tx.object(adminCapId), tx.object(controllerId), tx.pure.u64(genesis), tx.pure.address(deployerAddr)],
    });
  }
  const res = await client.signAndExecuteTransaction({ signer: deployer, transaction: tx, options: { showEffects: true } });
  if (res.effects?.status.status !== 'success') throw new Error(`set_params failed: ${res.effects?.status.error}`);
  await client.waitForTransaction({ digest: res.digest });
  ok(`controller bound${rebinding ? '' : `, genesis ${genesis / 1_000_000n} TBILL to ${deployerAddr}`} (${res.digest})`);

  const out = {
    network: NETWORK,
    rpcUrl: RPC,
    packageId,
    controllerId,
    adminCapId,
    upgradeCapId,
    coinType: `${packageId}::tbill::TBILL`,
    dwalletPubkeyHex: dw.publicKeyHex,
    ledger: dev.asset,
    domainSeparatorHex: toHex(domain),
    treasury: deployerAddr,
    deployer: deployerAddr,
    txDigest,
    explorer: `https://suiscan.xyz/${NETWORK}/object/${packageId}`,
  };
  mkdirSync(resolve(ROOT, 'deployments'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  ok(OUT);
  console.log(`\n\x1b[1m\x1b[32m═══ Sui deployment complete ═══\x1b[0m\n  ${out.explorer}\n`);
}

main().catch((e) => {
  console.error('\n\x1b[31mdeploy-sui failed:\x1b[0m', e);
  process.exit(1);
});
