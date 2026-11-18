/**
 * The issuer as an Ika user: its keys, the one-time registration with the network, and the
 * transactions the official SDK builds, sent with this package's kit helpers.
 */
import { IkaCurve } from '@ika-rwa/ledger-sdk';
import {
  IkaTransaction, connectIka, issuerKeys, sdkCurve,
  type IkaClient, type IkaConnection, type IkaNetworkConfig, type UserShareEncryptionKeys,
} from '@ika-rwa/ledger-sdk/ika';
import type { KeyPairSigner } from '@solana/kit';
import { sendInstructions, waitForFinalized, type SentTx, type SolanaClient } from './solana.js';

export type { IkaClient, IkaConnection, UserShareEncryptionKeys };
export { connectIka, issuerKeys };

/** The curves the demo's dWallets use: secp256k1 for the EVM chains, Curve25519 for Sui. */
export const ISSUER_CURVES = [IkaCurve.Secp256k1, IkaCurve.Curve25519] as const;

/**
 * Build a transaction of Ika instructions with `build`, send it signed by `owner` and wait until
 * it is finalized, because the network reads Solana at finalized commitment.
 */
export async function sendIka<T>(
  client: SolanaClient,
  ikaClient: IkaClient,
  owner: KeyPairSigner,
  keys: UserShareEncryptionKeys,
  build: (ikaTx: IkaTransaction) => T | Promise<T>,
): Promise<{ result: T; sent: SentTx }> {
  const ikaTx = new IkaTransaction({ ikaClient, owner, userShareEncryptionKeys: keys });
  const result = await build(ikaTx);
  const sent = await sendInstructions(client, owner, ikaTx.instructions, [...ikaTx.signers]);
  await waitForFinalized(client.rpc, sent.signature);
  return { result, sent };
}

export interface Issuer {
  /** The issuer's keys, by `DWalletCurve` number. */
  keys: Record<number, UserShareEncryptionKeys>;
  /** The Ed25519 key that signs every request to the network; vouchers name it as their signing key. */
  requestKey: Uint8Array;
}

/** The issuer's keys for every curve the demo uses, from its root seed. */
export async function loadIssuer(ikaClient: IkaClient, rootSeed: Uint8Array): Promise<Issuer> {
  const keys: Record<number, UserShareEncryptionKeys> = {};
  for (const curve of ISSUER_CURVES) keys[curve] = await issuerKeys(rootSeed, curve);
  const requestKey = ikaClient.getRequestPublicKey(keys[ISSUER_CURVES[0]]);
  for (const curve of ISSUER_CURVES) {
    const other = ikaClient.getRequestPublicKey(keys[curve]);
    if (other.length !== requestKey.length || other.some((b, i) => b !== requestKey[i])) {
      throw new Error('the issuer request key differs between curves; one asset can name only one signing key');
    }
  }
  return { keys, requestKey };
}

/**
 * Make the issuer a user of the network, once per root seed: an encryption key registered for
 * each curve, and a gas deposit for the request key. `wallet` pays and owns the deposit.
 * Returns what it had to create.
 */
export async function registerIssuer(client: SolanaClient, ikaClient: IkaClient, wallet: KeyPairSigner, issuer: Issuer): Promise<string[]> {
  const done: string[] = [];
  for (const curve of ISSUER_CURVES) {
    const keys = issuer.keys[curve];
    const registered = await ikaClient.getEncryptionKey(keys.getSigningPublicKeyBytes(), sdkCurve(curve)).then(() => true, () => false);
    if (registered) continue;
    // The registration carries the whole encryption key, so it goes in a transaction of its own.
    await sendIka(client, ikaClient, wallet, keys, (tx) => tx.registerEncryptionKey({ curve: sdkCurve(curve) }));
    done.push(`encryption key (${sdkCurve(curve)})`);
  }
  if ((await ikaClient.getGasDeposit(issuer.requestKey)) === null) {
    // The pre-alpha charges nothing, so an empty deposit is enough, but it must exist.
    await sendIka(client, ikaClient, wallet, issuer.keys[ISSUER_CURVES[0]], (tx) => tx.createGasDeposit());
    done.push('gas deposit');
  }
  return done;
}
