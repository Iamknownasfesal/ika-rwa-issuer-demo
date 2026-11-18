/**
 * The Ika network, through the official SDK (`@ika.xyz/pre-alpha-solana/kit`).
 *
 * The issuer is one Ika user: one root seed gives its encryption keys (one set
 * per curve) and its request key, which signs every request to the network and
 * is the only key the ledger's signature vouchers accept a sign request from.
 *
 * The Solana devnet pre-alpha is a mock network: one backend holds an ordinary
 * key for each dWallet and signs alone, so the client runs in mock mode. The
 * program, the transactions and the SDK's checks are the real ones.
 */
import { withMockCryptography } from '@ika.xyz/pre-alpha-core/mock';
import { DWalletGrpcClient } from '@ika.xyz/pre-alpha-core/web';
import { Curve, Hash, IkaClient, SignatureAlgorithm, UserShareEncryptionKeys } from '@ika.xyz/pre-alpha-solana/kit';
import type { Address } from '@solana/kit';
import { IkaCurve, IkaScheme } from '../chains.js';
import { fromHex } from '../format.js';

export { Curve, Hash, IkaClient, IkaTransaction, SignatureAlgorithm, UserShareEncryptionKeys } from '@ika.xyz/pre-alpha-solana/kit';
export type { DWallet, Presign } from '@ika.xyz/pre-alpha-solana/kit';

/** Where an Ika network is: its program on Solana, its gRPC-Web endpoint and the values its coordinator records. */
export interface IkaNetworkConfig {
  programId: Address;
  /** `https://` URL of the network's gRPC-Web endpoint. */
  grpcUrl: string;
  /** The network key every answer is checked against, hex. */
  networkKey: string;
  chainNumber: number;
  networkValue: number;
}

export interface IkaConnection {
  ikaClient: IkaClient;
  close(): void;
}

/** Connect to an Ika network in mock mode. `rpc` is a kit RPC, as `createSolanaRpc` makes it. */
export function connectIka(rpc: ConstructorParameters<typeof IkaClient>[0]['rpc'], net: IkaNetworkConfig): IkaConnection {
  const grpc = new DWalletGrpcClient(net.grpcUrl);
  const ikaClient = new IkaClient(
    withMockCryptography({
      rpc,
      grpc,
      config: {
        network: { custom: { networkPublicKeys: [fromHex(net.networkKey)] } },
        programId: net.programId,
        chainNumber: net.chainNumber,
        networkValue: net.networkValue,
      },
    }),
  );
  return { ikaClient, close: () => grpc.close() };
}

/** The SDK's curve for a `DWalletCurve` number, as a `ChainDeployment` stores it. */
export function sdkCurve(curve: number): Curve {
  if (curve === IkaCurve.Secp256k1) return Curve.SECP256K1;
  if (curve === IkaCurve.Curve25519) return Curve.ED25519;
  throw new Error(`unsupported dWallet curve ${curve}`);
}

/** The SDK's algorithm and hash for a `DWalletSignatureScheme` number. */
export function sdkScheme(scheme: number): { signatureAlgorithm: SignatureAlgorithm; hashScheme: Hash } {
  if (scheme === IkaScheme.EcdsaKeccak256) return { signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1, hashScheme: Hash.KECCAK256 };
  if (scheme === IkaScheme.EddsaSha512) return { signatureAlgorithm: SignatureAlgorithm.EdDSA, hashScheme: Hash.SHA512 };
  throw new Error(`unsupported signature scheme ${scheme}`);
}

/** The issuer's keys for one curve. The request key is the same for every curve of one root seed. */
export function issuerKeys(rootSeed: Uint8Array, curve: number): Promise<UserShareEncryptionKeys> {
  if (rootSeed.length !== 32) throw new Error('the Ika root seed must be 32 bytes');
  return UserShareEncryptionKeys.fromRootSeedKey(rootSeed, sdkCurve(curve));
}

/**
 * The 64-byte `r || s` (ECDSA) or `R || S` (EdDSA) a destination contract verifies.
 * The network returns ECDSA signatures as 65 bytes: the recovery byte, then `r` and `s`.
 */
export function compactSignature(scheme: number, signature: Uint8Array): Uint8Array {
  return scheme === IkaScheme.EcdsaKeccak256 && signature.length === 65 ? signature.slice(1) : signature;
}
