/**
 * Node-only gRPC client for the Ika pre-alpha dWallet service.
 *
 * Trust model in this demo: dWallets are created in **zero-trust** mode
 * (`UserSecretKeyShare.Encrypted`). The user share is held by the issuer
 * (an HSM / custodian backup in production); the network share can only be
 * used after the Solana policy program approves a message. In the pre-alpha
 * the network runs a single mock signer and the user-side MPC inputs are
 * placeholders (zeros), exactly as in the reference examples, but the wire
 * format and the authority flow are the real ones.
 *
 * Adapted from the ika-pre-alpha TypeScript client (BSD-3-Clause-Clear,
 * Copyright (c) dWallet Labs, Ltd.).
 */
import type { DWalletAttestation } from './attestation.js';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import { presignAlgorithmForCurve } from '../chains.js';
import {
  SignedRequestData,
  TransactionResponseData,
  UserSignature,
  VersionedDWalletDataAttestation,
  VersionedPresignDataAttestation,
  algorithmVariant,
  curveVariant,
  type DWalletRequestInput,
} from './bcs.js';

/** Optional per-request session identifier preimage (defaults to random bytes). */
export interface SessionOpts {
  sessionPreimage?: Uint8Array;
}

export interface IkaSigner {
  /** Ed25519 public key that authenticates gRPC requests (= `intended_chain_sender`). */
  publicKey: Uint8Array;
  /** Optional real Ed25519 signer over the BCS payload; the pre-alpha accepts a zero signature. */
  sign?: (payload: Uint8Array) => Promise<Uint8Array>;
}

export interface DkgResult {
  publicKey: Uint8Array;
  publicOutput: Uint8Array;
  attestationData: Uint8Array;
  networkSignature: Uint8Array;
  networkPubkey: Uint8Array;
  epoch: bigint;
}

export interface IkaClient {
  /** Zero-trust DKG: the user share stays encrypted under the issuer's key. */
  requestDkg(curve: number): Promise<DkgResult>;
  requestPresign(curve: number, algorithm: number, dwalletPublicKey: Uint8Array, imported?: boolean, opts?: SessionOpts): Promise<Uint8Array>;
  requestSign(dwalletPublicKey: Uint8Array, message: Uint8Array, presignId: Uint8Array, approvalTxSignature: Uint8Array, slot?: bigint, attestation?: DWalletAttestation, opts?: SessionOpts): Promise<Uint8Array>;
  close(): void;
}

export interface IkaClientOptions {
  /** Force plaintext transport (default: TLS unless host is localhost/127.0.0.1 or `IKA_GRPC_INSECURE=1`). */
  insecure?: boolean;
  epoch?: bigint;
  /** Request timeout in ms (default 60s). */
  timeoutMs?: number;
}

interface RawService {
  SubmitTransaction(
    req: { user_signature: Buffer; signed_request_data: Buffer },
    opts: grpc.CallOptions,
    cb: (err: grpc.ServiceError | null, resp: { response_data: Uint8Array }) => void,
  ): void;
  close(): void;
}

function loadService(url: string, insecure: boolean): RawService {
  const protoPath = fileURLToPath(new URL('./ika_dwallet.proto', import.meta.url));
  const def = protoLoader.loadSync(protoPath, { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true });
  const pkg = grpc.loadPackageDefinition(def) as unknown as {
    ika: { dwallet: { v1: { DWalletService: new (url: string, creds: grpc.ChannelCredentials) => RawService } } };
  };
  const creds = insecure ? grpc.credentials.createInsecure() : grpc.credentials.createSsl();
  return new pkg.ika.dwallet.v1.DWalletService(url, creds);
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** Add context to gRPC transport failures (e.g. HTTP/2 ALPN negotiation). */
export function describeGrpcError(err: unknown): string {
  const e = err as { code?: number; details?: string; message?: string };
  const base = e?.details || e?.message || String(err);
  if (/ALPN|alpn|h2|protocol/i.test(base) || e?.code === 14) {
    return `${base} (gRPC transport failure reaching the Ika pre-alpha endpoint)`;
  }
  return base;
}

export function createIkaClient(grpcUrl: string, signer: IkaSigner, opts: IkaClientOptions = {}): IkaClient {
  const url = grpcUrl.replace(/^https?:\/\//, '');
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(url);
  const insecure = opts.insecure ?? (local || process.env.IKA_GRPC_INSECURE === '1');
  const service = loadService(url, insecure);
  const epoch = opts.epoch ?? 1n;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  async function submit(payload: Uint8Array): Promise<Uint8Array> {
    const sig = signer.sign ? await signer.sign(payload) : new Uint8Array(64);
    const userSig = UserSignature.serialize({ Ed25519: { signature: Array.from(sig), public_key: Array.from(signer.publicKey) } }).toBytes();
    return new Promise((resolve, reject) => {
      service.SubmitTransaction(
        { user_signature: Buffer.from(userSig), signed_request_data: Buffer.from(payload) },
        { deadline: Date.now() + timeoutMs },
        (err, resp) => (err ? reject(new Error(describeGrpcError(err))) : resolve(new Uint8Array(resp.response_data))),
      );
    });
  }

  const sender = () => Array.from(signer.publicKey);
  const emptyAttestation = { attestation_data: Array.from(new Uint8Array(32)), network_signature: Array.from(new Uint8Array(64)), network_pubkey: Array.from(new Uint8Array(32)), epoch };

  return {
    async requestDkg(curve) {
      const common = {
        dwallet_network_encryption_public_key: Array.from(new Uint8Array(32)),
        curve: curveVariant(curve),
        user_public_output: Array.from(new Uint8Array(32)),
      };
      const user_secret_key_share = {
        Encrypted: {
          encrypted_centralized_secret_share_and_proof: Array.from(new Uint8Array(32)),
          encryption_key: Array.from(new Uint8Array(32)),
          signer_public_key: sender(),
        },
      };
      const request: DWalletRequestInput = {
        DKG: { ...common, centralized_public_key_share_and_proof: Array.from(new Uint8Array(32)), user_secret_key_share, sign_during_dkg_request: null },
      };
      const payload = SignedRequestData.serialize({
        session_identifier_preimage: Array.from(randomBytes(32)),
        epoch,
        chain_id: { Solana: true },
        intended_chain_sender: sender(),
        request,
      }).toBytes();
      const resp = TransactionResponseData.parse(await submit(payload));
      if (resp.Error) throw new Error(`DKG failed: ${resp.Error.message}`);
      if (!resp.Attestation) throw new Error(`DKG: unexpected response ${JSON.stringify(resp)}`);
      const att = resp.Attestation;
      const parsed = VersionedDWalletDataAttestation.parse(new Uint8Array(att.attestation_data));
      if (!parsed.V1) throw new Error('DKG: unexpected attestation version');
      return {
        publicKey: new Uint8Array(parsed.V1.public_key),
        publicOutput: new Uint8Array(parsed.V1.public_output),
        attestationData: new Uint8Array(att.attestation_data),
        networkSignature: new Uint8Array(att.network_signature),
        networkPubkey: new Uint8Array(att.network_pubkey),
        epoch: BigInt(att.epoch),
      };
    },

    async requestPresign(curve, algorithm, dwalletPublicKey, imported = false, opts = {}) {
      const payload = SignedRequestData.serialize({
        session_identifier_preimage: Array.from(opts.sessionPreimage ?? randomBytes(32)),
        epoch,
        chain_id: { Solana: true },
        intended_chain_sender: sender(),
        // Global presigns serve any DKG-created (non-imported) dWallet; only imported-key
        // dWallets need the dWallet-bound `PresignForDWallet` request.
        request: imported
          ? {
              PresignForDWallet: {
                dwallet_network_encryption_public_key: Array.from(new Uint8Array(32)),
                dwallet_public_key: Array.from(dwalletPublicKey),
                dwallet_attestation: emptyAttestation,
                curve: curveVariant(curve),
                signature_algorithm: algorithmVariant(algorithm ?? presignAlgorithmForCurve(curve)),
              },
            }
          : {
              Presign: {
                dwallet_network_encryption_public_key: Array.from(new Uint8Array(32)),
                curve: curveVariant(curve),
                signature_algorithm: algorithmVariant(algorithm ?? presignAlgorithmForCurve(curve)),
              },
            },
      }).toBytes();
      const resp = TransactionResponseData.parse(await submit(payload));
      if (resp.Error) throw new Error(`Presign failed: ${resp.Error.message}`);
      if (!resp.Attestation) throw new Error(`Presign: unexpected response ${JSON.stringify(resp)}`);
      const parsed = VersionedPresignDataAttestation.parse(new Uint8Array(resp.Attestation.attestation_data));
      if (!parsed.V1) throw new Error('Presign: unexpected attestation version');
      return new Uint8Array(parsed.V1.presign_session_identifier);
    },

    async requestSign(dwalletPublicKey, message, presignId, approvalTxSignature, slot = 0n, attestation, opts = {}) {
      const dwalletAttestation = attestation
        ? { attestation_data: Array.from(attestation.attestationData), network_signature: Array.from(attestation.networkSignature), network_pubkey: Array.from(attestation.networkPubkey), epoch: attestation.epoch }
        : emptyAttestation;
      const payload = SignedRequestData.serialize({
        session_identifier_preimage: Array.from(opts.sessionPreimage ?? randomBytes(32)),
        epoch,
        chain_id: { Solana: true },
        intended_chain_sender: sender(),
        request: {
          Sign: {
            message: Array.from(message),
            message_metadata: [],
            presign_session_identifier: Array.from(presignId),
            // The user-share partial signature: placeholder in the pre-alpha mock.
            message_centralized_signature: Array.from(new Uint8Array(64)),
            dwallet_attestation: dwalletAttestation,
            approval_proof: { Solana: { transaction_signature: Array.from(approvalTxSignature), slot } },
          },
        },
      }).toBytes();
      void dwalletPublicKey;
      const resp = TransactionResponseData.parse(await submit(payload));
      if (resp.Signature) return new Uint8Array(resp.Signature.signature);
      if (resp.Error) throw new Error(`Sign failed: ${resp.Error.message}`);
      throw new Error(`Sign: unexpected response ${JSON.stringify(resp)}`);
    },

    close() {
      service.close();
    },
  };
}
