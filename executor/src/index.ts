/**
 * Off-chain executor for the issuer ledger.
 *
 * Runs one leg of an approved intent end-to-end:
 *
 *   1. `execute_leg` on Solana: the ledger re-checks caps, then either mints /
 *      burns Token-2022 (Solana leg) or CPIs Ika `issue_signature_voucher`
 *      (foreign leg). The voucher sits at the ledger's PDA for the leg.
 *   2. For foreign legs: once the voucher is finalized, ask the Ika
 *      network to sign the authorization message under it. The network reads
 *      the voucher on Solana itself and writes the signature into it.
 *   3. Deliver the signed authorization to the destination chain.
 *   4. `confirm_leg` with the destination tx hash.
 *
 * Trust model: the dWallets are zero-trust: the issuer holds the encrypted
 * user share (this executor in the demo; an HSM / custodian backup in
 * production) and the network signs only under a voucher the Solana policy
 * program issued for the exact message digest. The executor cannot originate
 * a mint on its own: the ledger's CPI authority owns the dWallets, so only
 * the ledger can issue a voucher, and it names the issuer's request key as
 * the only key the network accepts the sign request from.
 */
import {
  LegKind, LegStatus, VoucherStatus, authorizationMessage, chainById, decodeSignatureVoucher, fetchAsset, fetchChains, fetchIntents,
  findChainPda, findCpiAuthorityPda, findCoordinatorPda, findIntentPda, findMintAuthorityPda, findSignatureVoucherPda, formatAmount,
  keccak256, legNonce, toHex,
  buildConfirmLegIx, buildExecuteLegForeignIx, buildExecuteLegSolanaIx, bytesEqual,
  type Address, type Authorization, type ChainDeployment, type Intent, type SignatureVoucher,
} from '@ika-rwa/ledger-sdk';
import { compactSignature, connectIka, sdkScheme } from '@ika-rwa/ledger-sdk/ika';
import { dwalletNameOf, issuerKeysOf } from './ika.js';
import { explainError, extractLedgerErrorCode } from '@ika-rwa/ledger-sdk';
import { getAddressDecoder, getAddressEncoder, getBase64Encoder } from '@solana/kit';
import { deliverEvm, evmBalanceOf, loadEvmDeployments } from './deliver/evm.js';
import { deliverSui, loadSuiDeployment, loadSuiKeypair, suiBalanceOf } from './deliver/sui.js';
import { mockDeliver, type Delivery } from './deliver/mock.js';
import { createClient, explorerAddress, explorerTx, sendInstructions, type SolanaRpc } from './solana.js';
import type { ExecutorConfig } from './config.js';

export * from './config.js';
export * from './solana.js';
export * from './ika.js';
export { mockDeliver } from './deliver/mock.js';
export type { Delivery } from './deliver/mock.js';

export type StepName = 'policy' | 'ika-approval' | 'ika-signature' | 'deliver' | 'confirm';
export type StepStatus = 'start' | 'ok' | 'error';

export interface StepEvent {
  leg: number;
  step: StepName;
  status: StepStatus;
  detail?: string;
  txHash?: string;
  explorer?: string;
  signature?: string;
  /** The leg's Ika signature voucher. */
  signatureVoucher?: string;
}

/** Human-readable Solana error: message + ledger error code (if any) + last program log lines. */
export function describeSolanaError(e: unknown): string {
  const err = e as { message?: string; context?: { logs?: string[]; __serverMessage?: string }; cause?: unknown };
  const parts: string[] = [String(err?.message ?? e)];
  const code = extractLedgerErrorCode(e);
  if (code !== null) parts.push(`ledger error ${code}: ${explainError(code).message}`);
  const logs = err?.context?.logs ?? (err?.cause as { context?: { logs?: string[] } } | undefined)?.context?.logs;
  if (logs?.length) parts.push(logs.filter((l) => /Error|failed|Custom/i.test(l)).slice(-3).join(' | '));
  return parts.join('. ');
}

function ev(leg: number, step: StepName, status: StepStatus, extra: Omit<StepEvent, 'leg' | 'step' | 'status'> = {}): StepEvent {
  return { leg, step, status, ...extra };
}

async function loadLeg(cfg: ExecutorConfig, rpc: ReturnType<typeof createClient>['rpc'], intentIndex: bigint, legIndex: number) {
  const asset = await fetchAsset(rpc, cfg.asset);
  const intents = await fetchIntents(rpc, cfg.programId, cfg.asset, asset.intentCount);
  const intent = intents.find((i) => i.index === intentIndex);
  if (!intent) throw new Error(`intent #${intentIndex} not found`);
  const leg = intent.legs[legIndex];
  if (!leg) throw new Error(`intent #${intentIndex} has no leg ${legIndex}`);
  const [chain] = await fetchChains(rpc, cfg.programId, cfg.asset, [leg.chainId]);
  if (!chain) throw new Error(`chain ${leg.chainId} not registered`);
  return { asset, intent, leg, chain };
}

/** Message of an Ika or RPC error, with the cause the SDK attaches when it has one. */
export function describeIkaError(e: unknown): string {
  const err = e as { message?: string; cause?: { message?: string } };
  const message = String(err?.message ?? e);
  return err?.cause?.message && !message.includes(err.cause.message) ? `${message}: ${err.cause.message}` : message;
}

/**
 * Read a signature voucher at finalized commitment until `check` accepts it. Finalized, because
 * the network reads the voucher at finalized: a sign request sent earlier is refused.
 */
async function pollVoucher(rpc: SolanaRpc, address: Address, check: (v: SignatureVoucher) => boolean, timeoutMs: number): Promise<SignatureVoucher> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await rpc.getAccountInfo(address, { encoding: 'base64', commitment: 'finalized' }).send();
    if (value) {
      const voucher = decodeSignatureVoucher(address, Uint8Array.from(getBase64Encoder().encode(value.data[0])));
      if (check(voucher)) return voucher;
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error(`timeout waiting for the signature voucher ${address}`);
}

export function authorizationFor(assetAddr: Address, intent: Intent, legIndex: number, chain: ChainDeployment): Authorization {
  const leg = intent.legs[legIndex];
  return {
    action: leg.action,
    amount: intent.amount,
    account: leg.action === 0 ? intent.recipient : intent.source,
    nonce: legNonce(intent.index, legIndex),
    ledger: new Uint8Array(getAddressEncoder().encode(assetAddr)),
    domainSeparator: chain.domainSeparator,
  };
}

/** Run one leg. Yields a StepEvent for every stage; throws on unrecoverable errors after emitting an error event. */
export async function* runLeg(cfg: ExecutorConfig, intentIndex: bigint, legIndex: number): AsyncGenerator<StepEvent> {
  const client = createClient(cfg.rpcUrl, cfg.wsUrl);
  const { rpc } = client;
  const executor = cfg.executorKeypair;
  const { asset, intent, leg, chain } = await loadLeg(cfg, rpc, intentIndex, legIndex);
  const meta = chainById(chain.chainId);
  const amountText = `${formatAmount(intent.amount, asset.decimals)} ${asset.symbol}`;
  const [intentPda] = await findIntentPda(cfg.programId, cfg.asset, intent.index);
  const [chainPda] = await findChainPda(cfg.programId, cfg.asset, chain.chainId);
  const [cpiAuthority, cpiAuthorityBump] = await findCpiAuthorityPda(cfg.programId);

  // ── 1. Solana policy approval (execute_leg) ──
  yield ev(legIndex, 'policy', 'start', { detail: `execute_leg #${intent.index} leg ${legIndex}: ${leg.action === 0 ? 'mint' : 'burn'} ${amountText} on ${meta.name}` });

  const resuming = leg.status === LegStatus.Authorized && chain.legKind !== LegKind.SolanaNative;
  if (leg.status !== LegStatus.Pending && !resuming) {
    yield ev(legIndex, 'policy', 'error', { detail: `leg already in status ${leg.status}` });
    throw new Error('leg not pending');
  }

  if (chain.legKind === LegKind.SolanaNative) {
    const [mintAuthority] = await findMintAuthorityPda(cfg.programId, cfg.asset);
    const decoder = getAddressDecoder();
    const mint = decoder.decode(chain.contract);
    const tokenAccount = decoder.decode(leg.action === 0 ? intent.recipient : intent.source);
    const ix = buildExecuteLegSolanaIx({
      programId: cfg.programId, asset: cfg.asset, intent: intentPda, chain: chainPda, authority: executor.address, payer: executor.address,
      legIndex, cpiAuthorityBump, mint, tokenAccount, mintAuthority,
    });
    let sent;
    try {
      sent = await sendInstructions(client, executor, [ix]);
    } catch (e) {
      yield ev(legIndex, 'policy', 'error', { detail: describeSolanaError(e) });
      throw e;
    }
    yield ev(legIndex, 'policy', 'ok', { detail: `Ledger approved and Token-2022 ${leg.action === 0 ? 'MintTo' : 'Burn'} executed by the mint-authority PDA`, txHash: sent.signature, explorer: explorerTx(sent.signature) });
    // A Solana leg is confirmed by its own transaction: no Ika signature, no delivery, no confirm_leg.
    yield ev(legIndex, 'confirm', 'ok', { detail: 'Solana leg confirmed on-chain', txHash: sent.signature, explorer: explorerTx(sent.signature) });
    return;
  }

  // Foreign leg: compute the authorization the ledger will approve.
  const auth = authorizationFor(cfg.asset, intent, legIndex, chain);
  const message = authorizationMessage(chain.encoding, auth);
  const digest = keccak256(message);
  // The voucher is the ledger's PDA for this leg, so it is found again from the intent alone.
  const [voucher, voucherBump] = await findSignatureVoucherPda(cfg.programId, intentPda, legIndex);
  const [coordinator] = await findCoordinatorPda(cfg.ika.programId);

  const ix = buildExecuteLegForeignIx({
    programId: cfg.programId, asset: cfg.asset, intent: intentPda, chain: chainPda, authority: executor.address, payer: executor.address,
    legIndex, signatureVoucherBump: voucherBump, cpiAuthorityBump, ikaProgram: cfg.ika.programId, coordinator, signatureVoucher: voucher,
    dwallet: chain.dwallet, cpiAuthority,
  });
  // A burn is only authorized if the destination treasury can actually cover it. The ledger moves
  // supply at authorization time, so check first and leave the ledger untouched if it cannot.
  if (!resuming && leg.action === 1 && cfg.deliver !== 'mock') {
    const account = intent.source;
    let held: bigint | null = null;
    if (chain.encoding === 1 && loadEvmDeployments()[String(meta.evmChainId)]) held = await evmBalanceOf(chain.chainId, account);
    const sui = meta.key === 'sui' ? loadSuiDeployment() : null;
    if (sui) {
      // The Move contract only burns coins the sender owns, so the relayer must be the treasury.
      const relayer = loadSuiKeypair().toSuiAddress();
      const treasury = `0x${toHex(account)}`;
      if (relayer.toLowerCase() !== treasury.toLowerCase()) {
        const detail = `Sui burns must be sent by the Sui treasury (${treasury}); this executor relays with ${relayer}. Nothing was authorized on Solana.`;
        yield ev(legIndex, 'policy', 'error', { detail });
        throw new Error(detail);
      }
      held = await suiBalanceOf(sui, account);
    }
    if (held !== null && held < intent.amount) {
      const detail = `${meta.name} treasury holds ${formatAmount(held, asset.decimals)} ${asset.symbol}; this burn needs ${amountText}. Nothing was authorized on Solana.`;
      yield ev(legIndex, 'policy', 'error', { detail });
      throw new Error(detail);
    }
  }


  if (resuming) {
    // The ledger already authorized this leg and its voucher exists; resume from the signature step.
    yield ev(legIndex, 'policy', 'ok', { detail: 'already authorized by the ledger (resuming)', signatureVoucher: voucher });
  } else {
    let sent;
    try {
      sent = await sendInstructions(client, executor, [ix]);
    } catch (e) {
      yield ev(legIndex, 'policy', 'error', { detail: describeSolanaError(e) });
      throw e;
    }
    yield ev(legIndex, 'policy', 'ok', {
      detail: `Ledger approved digest ${toHex(digest).slice(0, 16)}… and issued an Ika signature voucher through ${cpiAuthority}`,
      txHash: sent.signature,
      explorer: explorerTx(sent.signature),
      signatureVoucher: voucher,
    });
  }

  // ── 2. Ika signature voucher + signature ──
  const dwalletName = dwalletNameOf(chain.curve);
  // Restored from the issuer's secrets: no key generation at execution time.
  const keys = await issuerKeysOf(cfg.issuer, chain.curve);
  const { ikaClient, close } = connectIka(rpc, cfg.ika);
  let signature: Uint8Array;
  try {
    yield ev(legIndex, 'ika-approval', 'start', { detail: `waiting for the voucher ${voucher} to be finalized on Solana`, signatureVoucher: voucher });
    let issued: SignatureVoucher;
    try {
      issued = await pollVoucher(rpc, voucher, () => true, cfg.timeouts?.voucher ?? 120_000);
      if (!bytesEqual(issued.messageDigest, digest)) throw new Error('the voucher is for another message digest than this leg');
      if (issued.dwallet !== chain.dwallet) throw new Error('the voucher is for another dWallet than the chain registered');
      const requestKey = ikaClient.getRequestPublicKey(keys);
      if (!issued.signingKey || !bytesEqual(issued.signingKey, requestKey)) {
        throw new Error(`the voucher names another signing key than this executor's Ika request key ${toHex(requestKey)}`);
      }
      if (issued.status === VoucherStatus.ClosedByCharge || issued.status === VoucherStatus.Revoked) {
        throw new Error(`the voucher ended without a signature (status ${issued.status})`);
      }
      yield ev(legIndex, 'ika-approval', 'ok', {
        detail: `Voucher finalized: one ${meta.curve === 0 ? 'secp256k1 ECDSA' : 'Ed25519'} signature of this digest with dWallet ${chain.dwallet}`,
        signatureVoucher: voucher,
        explorer: explorerAddress(voucher),
      });
    } catch (e) {
      yield ev(legIndex, 'ika-approval', 'error', { detail: describeIkaError(e) });
      throw e;
    }

    yield ev(legIndex, 'ika-signature', 'start', { detail: `asking the Ika network to sign under the voucher (${cfg.ika.grpcUrl})` });
    try {
      const scheme = sdkScheme(chain.signatureScheme);
      if (issued.status === VoucherStatus.Signed) {
        // An earlier run got this far: the network already wrote the signature into the voucher.
        signature = issued.signature;
        yield ev(legIndex, 'ika-signature', 'ok', { detail: 'signature read from the voucher on Solana (signed in an earlier run)', signature: toHex(signature), signatureVoucher: voucher });
      } else {
        const dWallet = cfg.issuer.dwallets[dwalletName];
        if (!dWallet) throw new Error(`the issuer secrets hold no ${dwalletName} dWallet; run pnpm setup:devnet`);
        if (!bytesEqual(dWallet.publicKey, chain.dwalletPubkey)) throw new Error(`the issuer's ${dwalletName} dWallet is not the one the chain registered`);
        // The SDK reads the voucher, takes a presign, sends the request signed by the issuer's
        // request key and checks the signature against the dWallet's public key before returning it.
        signature = await ikaClient.requestSign({ dWallet, signatureVoucherId: voucher, message, ...scheme, userShareEncryptionKeys: keys });
        // The network also writes the signature into the voucher, where anyone can read it.
        try {
          const committed = await pollVoucher(rpc, voucher, (v) => v.status === VoucherStatus.Signed, cfg.timeouts?.signature ?? 60_000);
          if (!bytesEqual(committed.signature, signature)) throw new Error('the signature on Solana differs from the one the network returned');
          yield ev(legIndex, 'ika-signature', 'ok', { detail: 'signature returned by the network and committed in the voucher on Solana', signature: toHex(signature), signatureVoucher: voucher });
        } catch (e) {
          yield ev(legIndex, 'ika-signature', 'ok', { detail: `signature returned by the network (on-chain commit not observed: ${(e as Error).message})`, signature: toHex(signature), signatureVoucher: voucher });
        }
      }
      // Destination contracts verify 64 bytes; an ECDSA signature comes with a leading recovery byte.
      signature = compactSignature(chain.signatureScheme, signature);
    } catch (e) {
      yield ev(legIndex, 'ika-signature', 'error', { detail: describeIkaError(e) });
      throw e;
    }
  } finally {
    close();
  }

  // ── 3. Deliver to the destination chain ──
  const live = cfg.deliver !== 'mock';
  const evmDeployment = live && chain.encoding === 1 ? loadEvmDeployments()[String(meta.evmChainId ?? chain.chainId)] : undefined;
  const suiDeployment = live && meta.key === 'sui' ? loadSuiDeployment() : null;
  if (live && !evmDeployment && !suiDeployment) {
    const detail = `no ${meta.name} contract in deployments/${chain.encoding === 1 ? 'evm' : 'sui'}.json`;
    yield ev(legIndex, 'deliver', 'error', { detail });
    throw new Error(detail);
  }
  yield ev(legIndex, 'deliver', 'start', { detail: `${live ? 'submitting' : 'simulating'} ${leg.action === 0 ? 'mint' : 'burn'} on ${meta.name} (${meta.testnet})` });
  let delivery: Delivery;
  try {
    if (evmDeployment) {
      // Relayer pays gas; the contract verifies the dWallet's EIP-712 signature over the exact bytes the ledger authorized.
      delivery = await deliverEvm({ chainId: chain.chainId, auth, message, signature });
    } else if (suiDeployment) {
      // The Move MintController verifies the dWallet's Ed25519 signature over the raw 161-byte authorization.
      delivery = await deliverSui({ auth, message, signature, suiDeployment, relayerKey: loadSuiKeypair() });
    } else {
      delivery = mockDeliver(chain.chainId, digest, signature);
    }
  } catch (e) {
    yield ev(legIndex, 'deliver', 'error', { detail: describeSolanaError(e) });
    throw e;
  }
  yield ev(legIndex, 'deliver', 'ok', { detail: delivery.note, txHash: delivery.txHash, explorer: delivery.explorer });

  // ── 4. confirm_leg ──
  yield ev(legIndex, 'confirm', 'start', { detail: 'recording destination tx on the ledger' });
  try {
    const cix = buildConfirmLegIx({ programId: cfg.programId, asset: cfg.asset, intent: intentPda, authority: executor.address, legIndex, destTx: delivery.txHashBytes });
    const c = await sendInstructions(client, executor, [cix]);
    yield ev(legIndex, 'confirm', 'ok', { detail: 'leg confirmed', txHash: c.signature, explorer: explorerTx(c.signature) });
  } catch (e) {
    yield ev(legIndex, 'confirm', 'error', { detail: describeSolanaError(e) });
    throw e;
  }
}

/** Run every pending leg of an intent in order (a move waits for the burn leg to confirm before minting). */
export async function* runIntent(cfg: ExecutorConfig, intentIndex: bigint): AsyncGenerator<StepEvent> {
  const client = createClient(cfg.rpcUrl, cfg.wsUrl);
  const asset = await fetchAsset(client.rpc, cfg.asset);
  const intents = await fetchIntents(client.rpc, cfg.programId, cfg.asset, asset.intentCount);
  const intent = intents.find((i) => i.index === intentIndex);
  if (!intent) throw new Error(`intent #${intentIndex} not found`);
  for (let i = 0; i < intent.legs.length; i++) {
    if (intent.legs[i].status === LegStatus.Pending || intent.legs[i].status === LegStatus.Authorized) yield* runLeg(cfg, intentIndex, i);
  }
}
