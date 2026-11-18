/** Deployment config + key loading for the executor and scripts. */
import type { DWallet, IkaNetworkConfig } from '@ika-rwa/ledger-sdk/ika';
import { createKeyPairSignerFromBytes, type Address, type KeyPairSigner } from '@solana/kit';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DeploymentChain {
  pda: string;
  contract: string;
  treasury: string;
}

export interface Deployment {
  programId: string;
  ikaProgram: string;
  rpcUrl: string;
  wsUrl?: string;
  /** The Ika network's gRPC-Web endpoint. */
  grpcUrl: string;
  /** The Ika network key every answer is checked against, hex. */
  ikaNetworkKey: string;
  /** The chain number and network value the Ika coordinator records. */
  ikaChainNumber: number;
  ikaNetworkValue: number;
  /** The issuer's Ika request key, hex: the signing key of every voucher the asset issues. */
  ikaSigningKey: string;
  createKey: string;
  asset: string;
  mintAuthority: string;
  cpiAuthority: string;
  executor: string;
  approvers: { name: string; pubkey: string }[];
  dwallets: Record<string, { pda: string; publicKeyHex: string; evmAddress?: string; suiAddress?: string }>;
  chains: Record<string, DeploymentChain>;
}

/** `mock` simulates every destination; `live` delivers to chains that have a real deployment in
 *  `deployments/evm.json` / `deployments/sui.json` and simulates the rest. `evm` is a legacy alias for `live`. */
export type DeliverMode = 'mock' | 'live' | 'evm';

/** A dWallet's name in the deployment file and in the issuer's secrets, by curve. */
export type DWalletName = 'secp256k1' | 'curve25519';

/**
 * What the issuer keeps to use its dWallets: the root seed of its Ika keys, the keys derived from
 * it, and each dWallet as the key generation returned it, user share included. It is a secret, like the issuer's HSM
 * material in production. `keys/ika-issuer.json`, or the `LEDGER_IKA_ISSUER` env var.
 */
export interface IkaIssuerSecrets {
  rootSeed: Uint8Array;
  dwallets: Partial<Record<DWalletName, DWallet>>;
  /**
   * The issuer's keys for each curve, as the SDK serializes them. Deriving them from the root
   * seed is real class-groups key generation, about five seconds, which mock mode does not skip.
   * Setup derives them once; everything after restores them from here and computes nothing.
   */
  keys?: Partial<Record<DWalletName, Uint8Array>>;
}

export interface ExecutorConfig {
  rpcUrl: string;
  wsUrl: string;
  programId: Address;
  asset: Address;
  /** The Ika network the ledger was built for. */
  ika: IkaNetworkConfig;
  /** Signs execute_leg / confirm_leg. */
  executorKeypair: KeyPairSigner;
  /** Signs the requests to the Ika network and holds the user share of each dWallet. */
  issuer: IkaIssuerSecrets;
  deliver: DeliverMode;
  /** Poll timeouts in ms. */
  timeouts?: { voucher?: number; signature?: number };
}

/** Repo root = two levels above `executor/src`. */
export function repoRoot(): string {
  return resolve(new URL('../..', import.meta.url).pathname);
}

export function loadDeployment(path = process.env.DEPLOYMENT_FILE ?? resolve(repoRoot(), 'deployments/devnet.json')): Deployment {
  return JSON.parse(readFileSync(path, 'utf8')) as Deployment;
}

/** Load a `solana-keygen` style JSON keypair (64-byte secret array). */
export async function loadKeypair(path: string): Promise<KeyPairSigner> {
  const bytes = new Uint8Array(JSON.parse(readFileSync(resolve(path), 'utf8')) as number[]);
  if (bytes.length !== 64) throw new Error(`${path}: expected 64-byte keypair`);
  return createKeyPairSignerFromBytes(bytes);
}

// ── the issuer's Ika secrets ──

const hexOf = (b: Uint8Array) => Buffer.from(b).toString('hex');

/** JSON with byte arrays as `{ "$hex": "…" }` and bigints as `{ "$big": "…" }`. */
function encodeSecrets(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v instanceof Uint8Array ? { $hex: hexOf(v) } : typeof v === 'bigint' ? { $big: v.toString() } : v), 2);
}
function decodeSecrets<T>(text: string): T {
  return JSON.parse(text, (_k, v) => {
    if (v && typeof v === 'object' && typeof v.$hex === 'string') return Uint8Array.from(Buffer.from(v.$hex, 'hex'));
    if (v && typeof v === 'object' && typeof v.$big === 'string') return BigInt(v.$big);
    return v;
  }) as T;
}

export function ikaIssuerPath(): string {
  return process.env.LEDGER_IKA_ISSUER_FILE ?? resolve(repoRoot(), 'keys/ika-issuer.json');
}

/** The issuer's Ika secrets from `LEDGER_IKA_ISSUER` (the file's content) or `keys/ika-issuer.json`; null when neither exists. */
export function loadIkaIssuer(): IkaIssuerSecrets | null {
  const text = process.env.LEDGER_IKA_ISSUER ?? (existsSync(ikaIssuerPath()) ? readFileSync(ikaIssuerPath(), 'utf8') : null);
  if (text === null) return null;
  const secrets = decodeSecrets<IkaIssuerSecrets>(text);
  if (!(secrets.rootSeed instanceof Uint8Array) || secrets.rootSeed.length !== 32) throw new Error('the Ika issuer secrets hold no 32-byte root seed');
  return { rootSeed: secrets.rootSeed, dwallets: secrets.dwallets ?? {}, ...(secrets.keys ? { keys: secrets.keys } : {}) };
}

export function saveIkaIssuer(secrets: IkaIssuerSecrets): void {
  writeFileSync(ikaIssuerPath(), encodeSecrets(secrets) + '\n', { mode: 0o600 });
}

export function ikaNetworkOf(d: Pick<Deployment, 'ikaProgram' | 'grpcUrl' | 'ikaNetworkKey' | 'ikaChainNumber' | 'ikaNetworkValue'>): IkaNetworkConfig {
  return { programId: d.ikaProgram as Address, grpcUrl: d.grpcUrl, networkKey: d.ikaNetworkKey, chainNumber: d.ikaChainNumber, networkValue: d.ikaNetworkValue };
}

export async function configFromDeployment(d: Deployment, executorKeypair: KeyPairSigner, deliver: DeliverMode = 'mock'): Promise<ExecutorConfig> {
  const issuer = loadIkaIssuer();
  if (!issuer) throw new Error(`no Ika issuer secrets: set LEDGER_IKA_ISSUER or run pnpm setup:devnet to write ${ikaIssuerPath()}`);
  return {
    rpcUrl: d.rpcUrl,
    wsUrl: d.wsUrl ?? d.rpcUrl.replace(/^http/, 'ws'),
    programId: d.programId as Address,
    asset: d.asset as Address,
    ika: ikaNetworkOf(d),
    executorKeypair,
    issuer,
    deliver,
  };
}
