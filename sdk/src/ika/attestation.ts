/**
 * Read a dWallet's DKG attestation back from chain.
 *
 * The Ika network signs every DKG result (`NetworkSignedAttestation`) and the NOA commits it
 * into a `DWalletAttestation` PDA. `Sign` requests must carry that attestation, so an executor
 * that did not run the DKG itself (or lost the gRPC response) reconstructs it from:
 *   - the attestation PDA: `disc(1) | version(1) | noa_signature(64) | bump(1) | attestation_data…`
 *   - the dWallet account: `noa_public_key` at offset 111, `created_epoch` at 103.
 */
import type { Address } from '@solana/kit';
import { findDwalletAttestationPda, findDwalletPda } from './pda.js';

export interface DWalletAttestation {
  attestationData: Uint8Array;
  networkSignature: Uint8Array;
  networkPubkey: Uint8Array;
  epoch: bigint;
  /** DKG session identifier (first field of the V1 attestation). The signer keys the dWallet by it:
   *  pass it as `session_identifier_preimage` in Presign / Sign requests. */
  sessionIdentifier: Uint8Array;
}

interface RpcGet {
  getAccountInfo(address: Address, opts: { encoding: 'base64' }): { send(): Promise<{ value: { data: [string, string] } | null }> };
}

export const DWALLET_ATTESTATION_DISC = 15;

export async function fetchDWalletAttestation(rpc: RpcGet, ikaProgram: Address, curve: number, publicKey: Uint8Array): Promise<DWalletAttestation> {
  const [attPda] = await findDwalletAttestationPda(ikaProgram, curve, publicKey);
  const [dwPda] = await findDwalletPda(ikaProgram, curve, publicKey);
  const [att, dw] = await Promise.all([
    rpc.getAccountInfo(attPda, { encoding: 'base64' }).send(),
    rpc.getAccountInfo(dwPda, { encoding: 'base64' }).send(),
  ]);
  if (!att.value) throw new Error(`DWalletAttestation ${attPda} not found`);
  if (!dw.value) throw new Error(`DWallet ${dwPda} not found`);
  const a = Uint8Array.from(atob(att.value.data[0]), (c) => c.charCodeAt(0));
  const d = Uint8Array.from(atob(dw.value.data[0]), (c) => c.charCodeAt(0));
  if (a[0] !== DWALLET_ATTESTATION_DISC) throw new Error(`unexpected attestation discriminator ${a[0]}`);
  const epoch = new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(103, true);
  const attestationData = a.slice(67);
  return {
    attestationData,
    sessionIdentifier: attestationData.slice(1, 33),
    networkSignature: a.slice(2, 66),
    networkPubkey: d.slice(111, 143),
    epoch,
  };
}
