/**
 * Real Sui delivery: submit the dWallet-signed raw authorization to the deployed
 * `tbill::MintController` (contracts/sui/tbill). The relayer only pays gas; the Move module
 * verifies the Ed25519 signature over the 161-byte message, the ledger/domain binding and the
 * nonce. Ika's `EddsaSha512` signatures are standard Ed25519 over the raw message bytes, so they
 * are passed through untouched.
 *
 * Deployed ids are read from `deployments/sui.json` (written by `pnpm deploy:sui`).
 */
import { toHex, type Authorization } from '@ika-rwa/ledger-sdk';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import bs58 from 'bs58';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../config.js';
import type { Delivery } from './mock.js';

export interface SuiDeployment {
  network: 'testnet';
  rpcUrl: string;
  packageId: string;
  controllerId: string;
  adminCapId: string;
  upgradeCapId?: string;
  coinType: string;
  dwalletPubkeyHex: string;
  ledger: string;
  domainSeparatorHex: string;
  /** Relayer / treasury address on Sui (the deployer). */
  treasury: string;
  deployer: string;
  txDigest: string;
  explorer: string;
}

/**
 * Public Sui fullnodes retired JSON-RPC (fullnode.testnet.sui.io answers "Method not found");
 * these third-party providers still serve it. `SUI_RPC_URL` overrides; otherwise the first
 * responding endpoint is used. (Follow-up: migrate to @mysten/sui 2.x gRPC.)
 */
export const SUI_TESTNET_JSON_RPC = [
  'https://sui-testnet-rpc.publicnode.com',
  'https://rpc-testnet.suiscan.xyz:443',
  'https://sui-testnet-endpoint.blockvision.org',
  'https://testnet.suiet.app',
];

export async function pickSuiRpc(preferred?: string): Promise<string> {
  const candidates = [process.env.SUI_RPC_URL, preferred, ...SUI_TESTNET_JSON_RPC].filter((u): u is string => !!u);
  for (const url of candidates) {
    try {
      const c = new SuiClient({ url });
      await c.getLatestCheckpointSequenceNumber();
      return url;
    } catch {
      /* try next */
    }
  }
  throw new Error(`no Sui testnet JSON-RPC endpoint reachable (tried ${candidates.join(', ')})`);
}

export const SUI_DEPLOYMENT_FILE = 'deployments/sui.json';
export const SUI_DEPLOYER_KEY_FILE = 'keys/sui-deployer.json';

export function loadSuiDeployment(path = process.env.SUI_DEPLOYMENT_FILE ?? resolve(repoRoot(), SUI_DEPLOYMENT_FILE)): SuiDeployment | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as SuiDeployment;
}

/** `SUI_RELAYER_SECRET_KEY` (a bech32 `suiprivkey1…`) wins; otherwise `keys/sui-deployer.json` holds
 *  `{ "secretKey": "suiprivkey1…" }` as printed by the Sui CLI. Hosted deployments use a separate relayer key. */
export function loadSuiKeypair(path = process.env.SUI_DEPLOYER_KEY_FILE ?? resolve(repoRoot(), SUI_DEPLOYER_KEY_FILE)): Ed25519Keypair {
  if (process.env.SUI_RELAYER_SECRET_KEY) return Ed25519Keypair.fromSecretKey(process.env.SUI_RELAYER_SECRET_KEY);
  const { secretKey } = JSON.parse(readFileSync(path, 'utf8')) as { secretKey: string };
  return Ed25519Keypair.fromSecretKey(secretKey);
}

export function suiExplorerTx(digest: string, network = 'testnet'): string {
  return `https://suiscan.xyz/${network}/tx/${digest}`;
}

export interface SuiDeliverArgs {
  auth: Authorization;
  /** The full 161-byte raw authorization message the ledger approved. */
  message: Uint8Array;
  /** 64-byte Ed25519 signature produced by the Ika network. */
  signature: Uint8Array;
  suiDeployment: SuiDeployment;
  relayerKey: Ed25519Keypair;
  rpcUrl?: string;
}

/** Digest of the transaction whose `Authorized` event carries `nonce`, if this package emitted one. */
async function findSuiDelivery(client: SuiClient, dep: SuiDeployment, nonce: bigint): Promise<string | null> {
  let cursor: Parameters<SuiClient['queryEvents']>[0]['cursor'] = null;
  for (let page = 0; page < 20; page++) {
    const res = await client.queryEvents({ query: { MoveEventType: `${dep.packageId}::tbill::Authorized` }, cursor, limit: 50, order: 'descending' });
    const hit = res.data.find((e) => BigInt((e.parsedJson as { nonce: string }).nonce) === nonce);
    if (hit) return hit.id.txDigest;
    if (!res.hasNextPage) return null;
    cursor = res.nextCursor ?? null;
  }
  return null;
}

export async function deliverSui({ auth, message, signature, suiDeployment: dep, relayerKey, rpcUrl }: SuiDeliverArgs): Promise<Delivery> {
  const client = new SuiClient({ url: await pickSuiRpc(rpcUrl ?? dep.rpcUrl) });
  const relayer = relayerKey.toSuiAddress();
  // Idempotent: a run that timed out after its transaction landed must not deliver twice.
  const prior = await findSuiDelivery(client, dep, auth.nonce);
  if (prior) {
    return {
      txHash: prior,
      txHashBytes: bs58.decode(prior),
      explorer: suiExplorerTx(prior, dep.network),
      note: `already ${auth.action === 0 ? 'minted' : 'burned'} on Sui ${dep.network}; recording that transaction`,
    };
  }
  const tx = new Transaction();
  tx.setSender(relayer);

  if (auth.action === 0) {
    tx.moveCall({
      target: `${dep.packageId}::tbill::mint_with_authorization`,
      arguments: [tx.object(dep.controllerId), tx.pure.vector('u8', Array.from(message)), tx.pure.vector('u8', Array.from(signature))],
    });
  } else {
    // Burn: the module requires `account == sender` and a coin of exactly `amount`.
    const account = `0x${toHex(auth.account)}`;
    if (account !== relayer) throw new Error(`burn source ${account} is not the relayer ${relayer}; the relayer must hold the coins it burns`);
    const coins = await client.getCoins({ owner: relayer, coinType: dep.coinType });
    const total = coins.data.reduce((s, c) => s + BigInt(c.balance), 0n);
    if (coins.data.length === 0 || total < auth.amount) throw new Error(`relayer holds ${total} base units of TBILL, needs ${auth.amount}`);
    const primary = tx.object(coins.data[0].coinObjectId);
    if (coins.data.length > 1) tx.mergeCoins(primary, coins.data.slice(1).map((c) => tx.object(c.coinObjectId)));
    const [exact] = tx.splitCoins(primary, [tx.pure.u64(auth.amount)]);
    tx.moveCall({
      target: `${dep.packageId}::tbill::burn_with_authorization`,
      arguments: [tx.object(dep.controllerId), tx.pure.vector('u8', Array.from(message)), tx.pure.vector('u8', Array.from(signature)), exact],
    });
  }

  const res = await client.signAndExecuteTransaction({ signer: relayerKey, transaction: tx, options: { showEffects: true, showEvents: true } });
  if (res.effects?.status.status !== 'success') {
    throw new Error(`Sui transaction ${res.digest} failed: ${res.effects?.status.error ?? 'unknown error'}`);
  }
  await client.waitForTransaction({ digest: res.digest });
  return {
    txHash: res.digest,
    txHashBytes: bs58.decode(res.digest),
    explorer: suiExplorerTx(res.digest, dep.network),
    note: `${auth.action === 0 ? 'minted' : 'burned'} ${auth.amount} base units on Sui ${dep.network} via ${dep.packageId.slice(0, 10)}…::tbill (relayer ${relayer.slice(0, 10)}…)`,
  };
}

/** TBILL balance of `owner` on Sui (base units). */
export async function suiBalanceOf(dep: SuiDeployment, owner: Uint8Array, rpcUrl?: string): Promise<bigint> {
  const client = new SuiClient({ url: await pickSuiRpc(rpcUrl ?? dep.rpcUrl) });
  const b = await client.getBalance({ owner: `0x${toHex(owner)}`, coinType: dep.coinType });
  return BigInt(b.totalBalance);
}
