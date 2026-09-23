/** Probe: which session_identifier_preimage does the pre-alpha signer expect for Sign? */
import { fetchAsset, fetchChains, fetchIntents, findMessageApprovalPda, authorizationMessage, keccak256, findDwalletPda, fromBase58 } from '@ika-rwa/ledger-sdk';
import { createIkaClient, fetchDWalletAttestation } from '@ika-rwa/ledger-sdk/ika';
import { presignAlgorithmForCurve } from '@ika-rwa/ledger-sdk';
import { createClient, loadDeployment, loadKeypair, repoRoot, authorizationFor } from '@ika-rwa/executor';
import { getAddressEncoder, type Address } from '@solana/kit';
import { resolve } from 'node:path';

const d = loadDeployment();
const client = createClient(d.rpcUrl, d.wsUrl ?? '');
const programId = d.programId as Address; const asset = d.asset as Address; const ika = d.ikaProgram as Address;
const executor = await loadKeypair(resolve(repoRoot(), 'keys/executor.json'));
const intentIndex = BigInt(process.argv[2] ?? '1');
const a = await fetchAsset(client.rpc, asset);
const intents = await fetchIntents(client.rpc, programId, asset, a.intentCount);
const intent = intents.find((i) => i.index === intentIndex)!;
const leg = intent.legs[0];
const [chain] = await fetchChains(client.rpc, programId, asset, [leg.chainId]);
const auth = authorizationFor(asset, intent, 0, chain);
const message = authorizationMessage(chain.encoding, auth);
const digest = keccak256(message);
const [ma] = await findMessageApprovalPda(ika, chain.curve, chain.dwalletPubkey, chain.signatureScheme, digest);
const sigs = await client.rpc.getSignaturesForAddress(ma, { limit: 20 }).send();
const first = sigs[sigs.length - 1];
const proof = { sig: fromBase58(first.signature), slot: first.slot };
const att = await fetchDWalletAttestation(client.rpc, ika, chain.curve, chain.dwalletPubkey);
const [dwPda] = await findDwalletPda(ika, chain.curve, chain.dwalletPubkey);
const enc = getAddressEncoder();
const pk32 = chain.dwalletPubkey.length === 32 ? chain.dwalletPubkey : keccak256(chain.dwalletPubkey);
const variants: Record<string, Uint8Array> = {
  'dwallet pda': new Uint8Array(enc.encode(dwPda)),
  'attestation session_identifier': att.attestationData.slice(1, 33),
  'pubkey(32)': pk32,
  'executor pubkey': new Uint8Array(enc.encode(executor.address)),
  'zeros': new Uint8Array(32),
  'random': crypto.getRandomValues(new Uint8Array(32)),
};
const grpc = createIkaClient(d.grpcUrl, { publicKey: new Uint8Array(enc.encode(executor.address)) });
for (const [name, pre] of Object.entries(variants)) {
  for (const presignPre of ['same', 'random'] as const) {
    try {
      const presignId = await grpc.requestPresign(chain.curve, presignAlgorithmForCurve(chain.curve), chain.dwalletPubkey, false, presignPre === 'same' ? { sessionPreimage: pre } : {});
      const sig = await grpc.requestSign(chain.dwalletPubkey, message, presignId, proof.sig, proof.slot, att, { sessionPreimage: pre });
      console.log(`OK   sign preimage=${name} presign=${presignPre} → sig ${Buffer.from(sig).toString('hex').slice(0, 32)}…`);
      process.exit(0);
    } catch (e) {
      console.log(`fail sign preimage=${name} presign=${presignPre}: ${(e as Error).message.slice(0, 110)}`);
    }
  }
}
grpc.close();
