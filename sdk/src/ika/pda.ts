/**
 * Ika dWallet program PDAs (browser-safe). Mirrors `DWalletPdaSeeds` in the
 * pre-alpha program: `["dwallet", chunks_of(curve_u16_le || public_key)]`.
 */
import { getProgramDerivedAddress, type Address } from '@solana/kit';
import { u16le } from '../layout.js';

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Seeds shared by every dWallet-derived PDA. */
export function dwalletSeeds(curve: number, publicKey: Uint8Array): Uint8Array[] {
  const payload = new Uint8Array(2 + publicKey.length);
  payload.set(u16le(curve), 0);
  payload.set(publicKey, 2);
  const seeds: Uint8Array[] = [utf8('dwallet')];
  for (let i = 0; i < payload.length; i += 32) seeds.push(payload.slice(i, Math.min(i + 32, payload.length)));
  return seeds;
}

export async function findDwalletPda(ikaProgram: Address, curve: number, publicKey: Uint8Array): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({ programAddress: ikaProgram, seeds: dwalletSeeds(curve, publicKey) });
}

/** `["dwallet", chunks..., "message_approval", scheme_u16_le, message_digest]` (no metadata digest). */
export async function findMessageApprovalPda(
  ikaProgram: Address,
  curve: number,
  publicKey: Uint8Array,
  scheme: number,
  digest: Uint8Array,
): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({
    programAddress: ikaProgram,
    seeds: [...dwalletSeeds(curve, publicKey), utf8('message_approval'), u16le(scheme), digest],
  });
}

export async function findCoordinatorPda(ikaProgram: Address): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({ programAddress: ikaProgram, seeds: [utf8('dwallet_coordinator')] });
}

/** `["gas_deposit", user_pubkey]` */
export async function findGasDepositPda(ikaProgram: Address, userPubkey: Uint8Array): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({ programAddress: ikaProgram, seeds: [utf8('gas_deposit'), userPubkey] });
}

/** Ika `TransferOwnership` (disc 24) instruction data. */
export function transferOwnershipData(newAuthority: Uint8Array): Uint8Array {
  const d = new Uint8Array(33);
  d[0] = 24;
  d.set(newAuthority, 1);
  return d;
}

/** DKG attestation PDA: `["dwallet", chunks…, "attestation"]`. */
export async function findDwalletAttestationPda(ikaProgram: Address, curve: number, publicKey: Uint8Array): Promise<readonly [Address, number]> {
  const seeds = [...dwalletSeeds(curve, publicKey), new TextEncoder().encode('attestation')];
  return getProgramDerivedAddress({ programAddress: ikaProgram, seeds });
}
