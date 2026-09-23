/**
 * BCS wire types for the Ika pre-alpha gRPC service.
 *
 * Adapted from `chains/solana/clients/typescript/src/bcs-types.ts` in
 * <https://github.com/dwallet-labs/ika-pre-alpha> (BSD-3-Clause-Clear,
 * Copyright (c) dWallet Labs, Ltd.). Must match `crates/ika-dwallet-types`.
 */
import { bcs } from '@mysten/bcs';

const vecU8 = () => bcs.vector(bcs.u8());

export const ChainId = bcs.enum('ChainId', { Solana: null, Sui: null });
export const DWalletCurve = bcs.enum('DWalletCurve', { Secp256k1: null, Secp256r1: null, Curve25519: null, Ristretto: null });
export const DWalletSignatureAlgorithm = bcs.enum('DWalletSignatureAlgorithm', {
  ECDSASecp256k1: null,
  ECDSASecp256r1: null,
  Taproot: null,
  EdDSA: null,
  SchnorrkelSubstrate: null,
});
export const DWalletSignatureScheme = bcs.enum('DWalletSignatureScheme', {
  EcdsaKeccak256: null,
  EcdsaSha256: null,
  EcdsaDoubleSha256: null,
  TaprootSha256: null,
  EcdsaBlake2b256: null,
  EddsaSha512: null,
  SchnorrkelMerlin: null,
});
export const ApprovalProof = bcs.enum('ApprovalProof', {
  Solana: bcs.struct('ApprovalProofSolana', { transaction_signature: vecU8(), slot: bcs.u64() }),
  Sui: bcs.struct('ApprovalProofSui', { effects_certificate: vecU8() }),
});
export const UserSignature = bcs.enum('UserSignature', {
  Ed25519: bcs.struct('UserSignatureEd25519', { signature: vecU8(), public_key: vecU8() }),
  Secp256k1: bcs.struct('UserSignatureSecp256k1', { signature: vecU8(), public_key: vecU8() }),
  Secp256r1: bcs.struct('UserSignatureSecp256r1', { signature: vecU8(), public_key: vecU8() }),
});
export const NetworkSignedAttestation = bcs.struct('NetworkSignedAttestation', {
  attestation_data: vecU8(),
  network_signature: vecU8(),
  network_pubkey: vecU8(),
  epoch: bcs.u64(),
});
export const SignDuringDKGRequest = bcs.struct('SignDuringDKGRequest', {
  presign_session_identifier: vecU8(),
  presign: vecU8(),
  signature_scheme: DWalletSignatureScheme,
  message: vecU8(),
  message_metadata: vecU8(),
  message_centralized_signature: vecU8(),
});
/**
 * Zero-trust vs trust-minimized dWallets. The issuer demo uses `Encrypted`:
 * the user share is encrypted to the issuer's key and never revealed to the
 * network, so a signature needs BOTH the on-chain policy (network share) and
 * the issuer-held user share.
 */
export const UserSecretKeyShare = bcs.enum('UserSecretKeyShare', {
  Encrypted: bcs.struct('UserSecretKeyShareEncrypted', {
    encrypted_centralized_secret_share_and_proof: vecU8(),
    encryption_key: vecU8(),
    signer_public_key: vecU8(),
  }),
  Public: bcs.struct('UserSecretKeySharePublic', { public_user_secret_key_share: vecU8() }),
});
export const DWalletRequest = bcs.enum('DWalletRequest', {
  DKG: bcs.struct('DKG', {
    dwallet_network_encryption_public_key: vecU8(),
    curve: DWalletCurve,
    centralized_public_key_share_and_proof: vecU8(),
    user_secret_key_share: UserSecretKeyShare,
    user_public_output: vecU8(),
    sign_during_dkg_request: bcs.option(SignDuringDKGRequest),
  }),
  Sign: bcs.struct('Sign', {
    message: vecU8(),
    message_metadata: vecU8(),
    presign_session_identifier: vecU8(),
    message_centralized_signature: vecU8(),
    dwallet_attestation: NetworkSignedAttestation,
    approval_proof: ApprovalProof,
  }),
  ImportedKeySign: bcs.struct('ImportedKeySign', {
    message: vecU8(),
    message_metadata: vecU8(),
    presign_session_identifier: vecU8(),
    message_centralized_signature: vecU8(),
    dwallet_attestation: NetworkSignedAttestation,
    approval_proof: ApprovalProof,
  }),
  Presign: bcs.struct('Presign', {
    dwallet_network_encryption_public_key: vecU8(),
    curve: DWalletCurve,
    signature_algorithm: DWalletSignatureAlgorithm,
  }),
  PresignForDWallet: bcs.struct('PresignForDWallet', {
    dwallet_network_encryption_public_key: vecU8(),
    dwallet_public_key: vecU8(),
    dwallet_attestation: NetworkSignedAttestation,
    curve: DWalletCurve,
    signature_algorithm: DWalletSignatureAlgorithm,
  }),
  ImportedKeyVerification: bcs.struct('ImportedKeyVerification', {
    dwallet_network_encryption_public_key: vecU8(),
    curve: DWalletCurve,
    centralized_party_message: vecU8(),
    user_secret_key_share: UserSecretKeyShare,
    user_public_output: vecU8(),
  }),
  ReEncryptShare: bcs.struct('ReEncryptShare', {
    dwallet_network_encryption_public_key: vecU8(),
    dwallet_public_key: vecU8(),
    dwallet_attestation: NetworkSignedAttestation,
    encrypted_centralized_secret_share_and_proof: vecU8(),
    encryption_key: vecU8(),
  }),
  MakeSharePublic: bcs.struct('MakeSharePublic', {
    dwallet_public_key: vecU8(),
    dwallet_attestation: NetworkSignedAttestation,
    public_user_secret_key_share: vecU8(),
  }),
  FutureSign: bcs.struct('FutureSign', {
    dwallet_public_key: vecU8(),
    dwallet_attestation: NetworkSignedAttestation,
    presign_session_identifier: vecU8(),
    message: vecU8(),
    message_metadata: vecU8(),
    message_centralized_signature: vecU8(),
    signature_scheme: DWalletSignatureScheme,
  }),
  SignWithPartialUserSig: bcs.struct('SignWithPartialUserSig', {
    partial_user_signature_attestation: NetworkSignedAttestation,
    dwallet_attestation: NetworkSignedAttestation,
    approval_proof: ApprovalProof,
  }),
  ImportedKeySignWithPartialUserSig: bcs.struct('ImportedKeySignWithPartialUserSig', {
    partial_user_signature_attestation: NetworkSignedAttestation,
    dwallet_attestation: NetworkSignedAttestation,
    approval_proof: ApprovalProof,
  }),
});
export const SignedRequestData = bcs.struct('SignedRequestData', {
  session_identifier_preimage: bcs.fixedArray(32, bcs.u8()),
  epoch: bcs.u64(),
  chain_id: ChainId,
  intended_chain_sender: vecU8(),
  request: DWalletRequest,
});
export const TransactionResponseData = bcs.enum('TransactionResponseData', {
  Signature: bcs.struct('SignatureResponse', { signature: vecU8() }),
  Attestation: NetworkSignedAttestation,
  Error: bcs.struct('ErrorResponse', { message: bcs.string() }),
});
export const VersionedDWalletDataAttestation = bcs.enum('VersionedDWalletDataAttestation', {
  V1: bcs.struct('DWalletDataAttestationV1', {
    session_identifier: bcs.fixedArray(32, bcs.u8()),
    intended_chain_sender: vecU8(),
    curve: DWalletCurve,
    public_key: vecU8(),
    public_output: vecU8(),
    is_imported_key: bcs.bool(),
    sign_during_dkg_signature: bcs.option(vecU8()),
  }),
});
export const VersionedPresignDataAttestation = bcs.enum('VersionedPresignDataAttestation', {
  V1: bcs.struct('PresignDataAttestationV1', {
    session_identifier: bcs.fixedArray(32, bcs.u8()),
    epoch: bcs.u64(),
    presign_session_identifier: vecU8(),
    presign_data: vecU8(),
    curve: DWalletCurve,
    signature_algorithm: DWalletSignatureAlgorithm,
    dwallet_public_key: bcs.option(vecU8()),
    user_pubkey: vecU8(),
  }),
});

export const CURVE_NAMES = ['Secp256k1', 'Secp256r1', 'Curve25519', 'Ristretto'] as const;
export const ALGORITHM_NAMES = ['ECDSASecp256k1', 'ECDSASecp256r1', 'Taproot', 'EdDSA', 'SchnorrkelSubstrate'] as const;

export type CurveInput = typeof DWalletCurve.$inferInput;
export type AlgorithmInput = typeof DWalletSignatureAlgorithm.$inferInput;
export type DWalletRequestInput = typeof DWalletRequest.$inferInput;

export function curveVariant(curve: number): CurveInput {
  switch (curve) {
    case 0: return { Secp256k1: true };
    case 1: return { Secp256r1: true };
    case 2: return { Curve25519: true };
    case 3: return { Ristretto: true };
    default: throw new Error(`unknown curve ${curve}`);
  }
}
export function algorithmVariant(alg: number): AlgorithmInput {
  switch (alg) {
    case 0: return { ECDSASecp256k1: true };
    case 1: return { ECDSASecp256r1: true };
    case 2: return { Taproot: true };
    case 3: return { EdDSA: true };
    case 4: return { SchnorrkelSubstrate: true };
    default: throw new Error(`unknown algorithm ${alg}`);
  }
}
