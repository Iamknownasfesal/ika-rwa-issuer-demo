/**
 * Off-chain executor for the issuer ledger.
 *
 * Runs one leg of an approved intent end-to-end:
 *
 *   1. `execute_leg` on Solana: the ledger re-checks caps, then either mints /
 *      burns Token-2022 (Solana leg) or CPIs Ika `approve_message` (foreign leg).
 *   2. For foreign legs: wait for the `MessageApproval` PDA, ask the Ika
 *      network for a presign + signature over the authorization message,
 *      wait for the network to commit the signature on-chain.
 *   3. Deliver the signed authorization to the destination chain (mock or EVM).
 *   4. `confirm_leg` with the destination tx hash.
 *
 * Trust model: the dWallets are zero-trust: the encrypted user share is held
 * by the issuer (this executor's key in the demo; an HSM / custodian backup
 * in production) and the network share only signs after the Solana policy
 * program approved the exact message digest. The executor cannot originate a
 * mint on its own: without a `MessageApproval` created by the program's CPI
 * authority, the network refuses to sign.
 */
import {
  LegKind, LegStatus, MESSAGE_APPROVAL, authorizationMessage, chainById, decodeMessageApproval, fetchAsset, fetchChains, fetchIntents,
  findChainPda, findCpiAuthorityPda, findCoordinatorPda, findIntentPda, findMessageApprovalPda, findMintAuthorityPda, formatAmount,
  keccak256, legNonce, presignAlgorithmForCurve, toHex,
  buildConfirmLegIx, buildExecuteLegForeignIx, buildExecuteLegSolanaIx, bytesEqual,
  type Address, type Authorization, type ChainDeployment, type Intent,
} from '@ika-rwa/ledger-sdk';
import { createIkaClient, describeGrpcError, fetchDWalletAttestation } from '@ika-rwa/ledger-sdk/ika';
import { explainError, extractLedgerErrorCode } from '@ika-rwa/ledger-sdk';
import { getAddressDecoder, getAddressEncoder } from '@solana/kit';
import { deliverEvm, evmBalanceOf, loadEvmDeployments } from './deliver/evm.js';
import { deliverSui, loadSuiDeployment, loadSuiKeypair, suiBalanceOf } from './deliver/sui.js';
import { mockDeliver, type Delivery } from './deliver/mock.js';
import bs58 from 'bs58';
import { createClient, explorerAddress, explorerTx, pollAccount, sendInstructions } from './solana.js';
import type { ExecutorConfig } from './config.js';

export * from './config.js';
export * from './solana.js';
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
  messageApproval?: string;
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
  const [messageApproval, maBump] = await findMessageApprovalPda(cfg.ikaProgram, chain.curve, chain.dwalletPubkey, chain.signatureScheme, digest);
  const [coordinator] = await findCoordinatorPda(cfg.ikaProgram);

  const ix = buildExecuteLegForeignIx({
    programId: cfg.programId, asset: cfg.asset, intent: intentPda, chain: chainPda, authority: executor.address, payer: executor.address,
    legIndex, messageApprovalBump: maBump, cpiAuthorityBump, ikaProgram: cfg.ikaProgram, coordinator, messageApproval, dwallet: chain.dwallet, cpiAuthority,
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

  let sent: { signature: string; signatureBytes: Uint8Array; slot: bigint };
  if (resuming) {
    // The ledger already authorized this leg (MessageApproval exists); resume from the signature step
    // using the transaction that created the MessageApproval as the approval proof.
    const sigs = await rpc.getSignaturesForAddress(messageApproval, { limit: 20 }).send();
    const first = sigs[sigs.length - 1];
    if (!first) throw new Error(`no transaction found for MessageApproval ${messageApproval}`);
    sent = { signature: first.signature, signatureBytes: bs58.decode(first.signature), slot: first.slot };
    yield ev(legIndex, 'policy', 'ok', { detail: `already authorized by the ledger (resuming)`, txHash: sent.signature, explorer: explorerTx(sent.signature), messageApproval });
  } else {
    try {
      sent = await sendInstructions(client, executor, [ix]);
    } catch (e) {
      yield ev(legIndex, 'policy', 'error', { detail: describeSolanaError(e) });
      throw e;
    }
    yield ev(legIndex, 'policy', 'ok', {
      detail: `Ledger approved digest ${toHex(digest).slice(0, 16)}… and CPI'd Ika approve_message via ${cpiAuthority}`,
      txHash: sent.signature,
      explorer: explorerTx(sent.signature),
      messageApproval,
    });
  }

  // ── 2. Ika MessageApproval + signature ──
  yield ev(legIndex, 'ika-approval', 'start', { detail: `waiting for MessageApproval ${messageApproval}`, messageApproval });
  try {
    const data = await pollAccount(rpc, messageApproval, (d) => d[0] === MESSAGE_APPROVAL.DISC, cfg.timeouts?.messageApproval ?? 30_000);
    const ma = decodeMessageApproval(messageApproval, data);
    if (!bytesEqual(ma.messageDigest, digest)) throw new Error('MessageApproval digest mismatch');
    yield ev(legIndex, 'ika-approval', 'ok', { detail: `MessageApproval pending (dWallet ${chain.dwallet}, scheme ${ma.scheme})`, messageApproval, explorer: explorerAddress(messageApproval) });
  } catch (e) {
    yield ev(legIndex, 'ika-approval', 'error', { detail: describeSolanaError(e) });
    throw e;
  }

  yield ev(legIndex, 'ika-signature', 'start', { detail: `presign + sign via ${cfg.grpcUrl} (${meta.curve === 0 ? 'secp256k1 ECDSA' : 'ed25519'})` });
  let signature: Uint8Array;
  const executorPubkey = new Uint8Array(getAddressEncoder().encode(executor.address));
  const ika = createIkaClient(cfg.grpcUrl, { publicKey: executorPubkey });
  try {
    // Zero-trust dWallet: the issuer's (encrypted) user share participates here.
    // In the pre-alpha the user-side MPC inputs are placeholders.
    const attestation = await fetchDWalletAttestation(rpc, cfg.ikaProgram, chain.curve, chain.dwalletPubkey);
    // The network resolves the dWallet from the DKG session identifier, so both requests carry it as the session preimage.
    const session = { sessionPreimage: attestation.sessionIdentifier };
    const presignId = await ika.requestPresign(chain.curve, presignAlgorithmForCurve(chain.curve), chain.dwalletPubkey, false, session);
    signature = await ika.requestSign(chain.dwalletPubkey, message, presignId, sent.signatureBytes, sent.slot, attestation, session);
    // The network also commits the signature on-chain; verify it matches.
    try {
      const signed = await pollAccount(rpc, messageApproval, (d) => d[MESSAGE_APPROVAL.STATUS] === 1, cfg.timeouts?.signature ?? 30_000);
      const ma = decodeMessageApproval(messageApproval, signed);
      if (!bytesEqual(ma.signature, signature)) throw new Error('on-chain signature differs from gRPC signature');
      yield ev(legIndex, 'ika-signature', 'ok', { detail: `signature committed on-chain by the network`, signature: toHex(signature), messageApproval });
    } catch (e) {
      yield ev(legIndex, 'ika-signature', 'ok', { detail: `signature received via gRPC (on-chain commit not observed: ${(e as Error).message})`, signature: toHex(signature), messageApproval });
    }
  } catch (e) {
    yield ev(legIndex, 'ika-signature', 'error', { detail: describeGrpcError(e) });
    throw e;
  } finally {
    ika.close();
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
