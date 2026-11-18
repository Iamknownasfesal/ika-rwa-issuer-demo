#!/usr/bin/env tsx
/**
 * Health check of the Ika pre-alpha, with no ledger involved:
 *
 *   pnpm exec tsx scripts/ika-probe.ts [secp256k1|ed25519]
 *
 * Registers a throwaway issuer (keys/ika-probe-seed.json), creates a dWallet, approves one
 * message as its owner, asks the network to sign it and checks the signature. When this passes
 * and the demo does not, the fault is in the ledger or the executor, not the network.
 */
import { IKA_DEVNET_PRE_ALPHA, IkaCurve, IkaScheme, SOLANA_DEVNET_RPC, toHex, type Address } from '@ika-rwa/ledger-sdk';
import { compactSignature, sdkCurve, sdkScheme } from '@ika-rwa/ledger-sdk/ika';
import { connectIka, createClient, loadIssuer, loadKeypair, registerIssuer, repoRoot, sendIka } from '@ika-rwa/executor';
import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const which = process.argv[2] ?? 'secp256k1';
const curve = which === 'ed25519' ? IkaCurve.Curve25519 : IkaCurve.Secp256k1;
const scheme = which === 'ed25519' ? IkaScheme.EddsaSha512 : IkaScheme.EcdsaKeccak256;
const step = (m: string) => console.log(`\x1b[36m▶\x1b[0m ${m}`);

const rpcUrl = process.env.RPC_URL ?? SOLANA_DEVNET_RPC;
const client = createClient(rpcUrl, rpcUrl.replace(/^http/, 'ws'));
const wallet = await loadKeypair(process.env.PAYER_KEYPAIR ?? resolve(repoRoot(), 'keys/executor.json'));
const seedPath = resolve(repoRoot(), 'keys/ika-probe-seed.json');
if (!existsSync(seedPath)) writeFileSync(seedPath, JSON.stringify(Array.from(crypto.getRandomValues(new Uint8Array(32)))));
const rootSeed = Uint8Array.from(JSON.parse(readFileSync(seedPath, 'utf8')) as number[]);

const { ikaClient, close } = connectIka(client.rpc, { ...IKA_DEVNET_PRE_ALPHA, programId: IKA_DEVNET_PRE_ALPHA.programId as Address });
try {
  const issuer = await loadIssuer(ikaClient, { rootSeed, dwallets: {} });
  const keys = issuer.keys[curve];
  step(`wallet ${wallet.address}, request key ${toHex(issuer.requestKey)}`);
  const created = await registerIssuer(client, ikaClient, wallet, issuer);
  step(created.length ? `registered: ${created.join(', ')}` : 'issuer already registered');

  step(`DKG (${which})`);
  const { dWallet } = await ikaClient.requestDWalletDKG({ curve: sdkCurve(curve), userShareEncryptionKeys: keys, owner: wallet.address });
  await sendIka(client, ikaClient, wallet, keys, (tx) => tx.acceptEncryptedUserShare({ dWallet }));
  const address = await ikaClient.waitForDWallet(dWallet, { timeout: 300_000, interval: 2_000 });
  step(`dWallet ${address}, public key ${toHex(dWallet.publicKey)}`);

  const message = new TextEncoder().encode(`ika-rwa probe ${Date.now()}`);
  const { result: voucher } = await sendIka(client, ikaClient, wallet, keys, (tx) => tx.approveMessage({ dWallet, message, ...sdkScheme(scheme) }));
  step(`voucher ${voucher}`);
  const signature = await ikaClient.requestSign({ dWallet, signatureVoucherId: voucher, message, ...sdkScheme(scheme), userShareEncryptionKeys: keys });
  step(`signature (${signature.length} bytes) ${toHex(signature)}`);

  const compact = compactSignature(scheme, signature);
  const valid = curve === IkaCurve.Curve25519
    ? ed25519.verify(compact, message, dWallet.publicKey)
    : secp256k1.verify(compact, keccak_256(message), dWallet.publicKey, { prehash: false });
  if (!valid) throw new Error('the signature does not verify under the dWallet public key');
  const usable = await ikaClient.getDWallet(address, keys);
  console.log(`\x1b[32m✓\x1b[0m signature verifies; getDWallet returned keys: ${Object.keys(usable).join(', ')}`);
} finally {
  close();
}
