/** PDA derivations for the issuer ledger program. */
import { getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import { u16le, u64le } from './layout.js';

const utf8 = (s: string) => new TextEncoder().encode(s);
const addr = () => getAddressEncoder();

export type Pda = readonly [Address, number];

/** `["asset", create_key]` */
export async function findAssetPda(programId: Address, createKey: Uint8Array): Promise<Pda> {
  return getProgramDerivedAddress({ programAddress: programId, seeds: [utf8('asset'), createKey] });
}

/** `["chain", asset, chain_id_le(2)]` */
export async function findChainPda(programId: Address, asset: Address, chainId: number): Promise<Pda> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [utf8('chain'), addr().encode(asset), u16le(chainId)],
  });
}

/** `["intent", asset, index_le(8)]` */
export async function findIntentPda(programId: Address, asset: Address, index: bigint): Promise<Pda> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [utf8('intent'), addr().encode(asset), u64le(index)],
  });
}

/** `["mint_authority", asset]`: Token-2022 mint authority and treasury owner on Solana. */
export async function findMintAuthorityPda(programId: Address, asset: Address): Promise<Pda> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [utf8('mint_authority'), addr().encode(asset)],
  });
}

/** `["signature_voucher", intent, leg_index(1)]`: the Ika signature voucher the ledger issues for one foreign leg. */
export async function findSignatureVoucherPda(programId: Address, intent: Address, legIndex: number): Promise<Pda> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [utf8('signature_voucher'), addr().encode(intent), new Uint8Array([legIndex])],
  });
}

/** `["dwallet_coordinator"]` under the Ika program. */
export async function findCoordinatorPda(ikaProgram: Address): Promise<Pda> {
  return getProgramDerivedAddress({ programAddress: ikaProgram, seeds: [utf8('dwallet_coordinator')] });
}

/** `["__ika_cpi_authority"]`: the dWallet owner that only this program can sign for. */
export async function findCpiAuthorityPda(programId: Address): Promise<Pda> {
  return getProgramDerivedAddress({ programAddress: programId, seeds: [utf8('__ika_cpi_authority')] });
}
