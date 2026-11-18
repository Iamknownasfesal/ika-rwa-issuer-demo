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
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
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

/** Sui testnet full node, gRPC. Public full nodes no longer serve JSON-RPC. `SUI_RPC_URL` overrides. */
export const SUI_TESTNET_GRPC = 'https://fullnode.testnet.sui.io:443';

/** A gRPC client of Sui testnet: `SUI_RPC_URL`, else `preferred` when it is a gRPC endpoint, else the public full node. */
export function suiClient(preferred?: string): SuiGrpcClient {
  return new SuiGrpcClient({ network: 'testnet', baseUrl: suiRpcUrl(preferred) });
}

export function suiRpcUrl(preferred?: string): string {
  // Deployment files written before the gRPC migration name JSON-RPC providers that are gone.
  const usable = preferred && !/publicnode|suiscan|blockvision|suiet/.test(preferred) ? preferred : undefined;
  return process.env.SUI_RPC_URL ?? usable ?? SUI_TESTNET_GRPC;
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

/** Whether the controller already consumed `nonce`, asked of the Move module itself (`tbill::nonce_used`). */
async function suiNonceUsed(client: SuiGrpcClient, dep: SuiDeployment, nonce: bigint, sender: string): Promise<boolean> {
  const tx = new Transaction();
  tx.setSender(sender);
  tx.moveCall({ target: `${dep.packageId}::tbill::nonce_used`, arguments: [tx.object(dep.controllerId), tx.pure.u64(nonce)] });
  const res = await client.simulateTransaction({ transaction: tx, include: { commandResults: true } });
  const value = res.commandResults?.[0]?.returnValues[0]?.bcs;
  if (!value) throw new Error(`could not read tbill::nonce_used(${nonce}) on Sui`);
  return value[0] === 1;
}

/** Digest of the transaction whose `Authorized` event carries `nonce`, if this package emitted one. */
async function findSuiDelivery(client: SuiGrpcClient, dep: SuiDeployment, nonce: bigint): Promise<string | null> {
  let before: string | undefined;
  // A filtered gRPC page can be short, even empty, with more to read: follow `hasNextPage`.
  for (let page = 0; page < 200; page++) {
    const res = await client.listEvents({ filter: { eventType: `${dep.packageId}::tbill::Authorized` }, limit: 50, ...(before ? { before } : { order: 'descending' as const }) });
    const hit = res.events.find((e) => e.json !== null && BigInt(String((e.json as { nonce: string | number }).nonce)) === nonce);
    if (hit) return hit.transactionDigest;
    if (!res.hasNextPage || !res.endCursor) return null;
    before = res.endCursor;
  }
  return null;
}

export async function deliverSui({ auth, message, signature, suiDeployment: dep, relayerKey, rpcUrl }: SuiDeliverArgs): Promise<Delivery> {
  const client = suiClient(rpcUrl ?? dep.rpcUrl);
  const relayer = relayerKey.toSuiAddress();
  // Idempotent: a run that timed out after its transaction landed must not deliver twice.
  if (await suiNonceUsed(client, dep, auth.nonce, relayer)) {
    const prior = await findSuiDelivery(client, dep, auth.nonce);
    if (!prior) throw new Error(`Sui already consumed nonce ${auth.nonce}, but its transaction was not found among the package's events`);
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
    const { balance } = await client.getBalance({ owner: relayer, coinType: dep.coinType });
    if (BigInt(balance.balance) < auth.amount) throw new Error(`relayer holds ${balance.balance} base units of TBILL, needs ${auth.amount}`);
    // A coin of exactly `amount`, merged and split from the relayer's coins when the transaction is built.
    const exact = coinWithBalance({ type: dep.coinType, balance: auth.amount });
    tx.moveCall({
      target: `${dep.packageId}::tbill::burn_with_authorization`,
      arguments: [tx.object(dep.controllerId), tx.pure.vector('u8', Array.from(message)), tx.pure.vector('u8', Array.from(signature)), exact],
    });
  }

  const res = await client.signAndExecuteTransaction({ signer: relayerKey, transaction: tx, include: { effects: true } });
  const executed = res.Transaction ?? res.FailedTransaction;
  if (!executed.status.success) {
    throw new Error(`Sui transaction ${executed.digest} failed: ${JSON.stringify(executed.status.error)}`);
  }
  await client.waitForTransaction({ digest: executed.digest });
  return {
    txHash: executed.digest,
    txHashBytes: bs58.decode(executed.digest),
    explorer: suiExplorerTx(executed.digest, dep.network),
    note: `${auth.action === 0 ? 'minted' : 'burned'} ${auth.amount} base units on Sui ${dep.network} via ${dep.packageId.slice(0, 10)}…::tbill (relayer ${relayer.slice(0, 10)}…)`,
  };
}

/** TBILL balance of `owner` on Sui (base units). */
export async function suiBalanceOf(dep: SuiDeployment, owner: Uint8Array, rpcUrl?: string): Promise<bigint> {
  const { balance } = await suiClient(rpcUrl ?? dep.rpcUrl).getBalance({ owner: `0x${toHex(owner)}`, coinType: dep.coinType });
  return BigInt(balance.balance);
}
