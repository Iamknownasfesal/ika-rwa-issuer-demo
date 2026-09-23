/**
 * Server-side bridge to the real ledger: Solana devnet program + Ika pre-alpha.
 * Used only by the API routes. Loads the workspace packages dynamically so the
 * app compiles in mock mode without them.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import type { ApproverId } from "@/demoConfig";
import { demoConfig } from "@/demoConfig";
import { CHAINS, chainById } from "@/lib/chains";
import { base58, hex } from "@/lib/hashes";
import { explainProgramError } from "@/policy/policy";
import type { ActivityEntry, Asset, ChainDeployment, ChainKey, DWallet, Intent, IntentDraft, IntentStatus, LedgerState, Leg, LegExecution, StepEvent } from "@/types";
import type { Address, Deployment, ExecutorSdk, LedgerSdk, SdkChain, SdkIntent } from "./contract";

const ROOT = path.resolve(process.cwd(), "..");
const DEPLOYMENT_FILE = process.env.LEDGER_DEPLOYMENT_FILE ?? path.join(ROOT, "deployments", "devnet.json");
const KEYS_DIR = process.env.LEDGER_KEYS_DIR ?? path.join(ROOT, "keys");

// `pnpm build` bundles each package into dist/server.mjs. Loading those natively keeps the bundler
// out of code that reads files next to itself, and `outputFileTracingIncludes` ships them to Vercel.
async function loadBundle<T>(pkg: "sdk" | "executor"): Promise<T> {
  const file = pathToFileURL(path.join(ROOT, pkg, "dist", "server.mjs")).href;
  return (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ file)) as T;
}
const loadSdk = () => loadBundle<LedgerSdk>("sdk");
const loadExecutor = () => loadBundle<ExecutorSdk>("executor");

let deploymentCache: { mtime: number; value: Deployment } | undefined;
/** Re-read when `pnpm setup:devnet` rewrites the file, so a new asset shows up without a restart. */
export async function deployment(): Promise<Deployment> {
  const { mtimeMs } = await stat(/* turbopackIgnore: true */ DEPLOYMENT_FILE);
  if (deploymentCache?.mtime !== mtimeMs) {
    deploymentCache = { mtime: mtimeMs, value: JSON.parse(await readFile(/* turbopackIgnore: true */ DEPLOYMENT_FILE, "utf8")) as Deployment };
  }
  return deploymentCache.value;
}

/** `LEDGER_KEY_APPROVER_ALICE`-style env vars (a solana-keygen JSON array) win over `keys/<name>.json`. */
async function signer(name: string): Promise<KeyPairSigner> {
  const env = process.env[`LEDGER_KEY_${name.toUpperCase().replace(/-/g, "_")}`];
  const raw = JSON.parse(env ?? (await readFile(/* turbopackIgnore: true */ path.join(KEYS_DIR, `${name}.json`), "utf8"))) as number[];
  return createKeyPairSignerFromBytes(new Uint8Array(raw));
}
const approverSigner = (id: ApproverId) => signer(`approver-${id}`);
const executorSigner = () => signer("executor");

function rpcs(d: Deployment) {
  const rpc = createSolanaRpc(d.rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(d.wsUrl ?? d.rpcUrl.replace(/^http/, "ws"));
  return { rpc, rpcSubscriptions };
}

async function send(d: Deployment, payer: KeyPairSigner, ixs: Instruction[]): Promise<string> {
  const { rpc, rpcSubscriptions } = rpcs(d);
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  assertIsTransactionWithBlockhashLifetime(tx);
  await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(tx, { commitment: "confirmed" });
  return getSignatureFromTransaction(tx);
}

// ───────────────────────────── encoding helpers ───────────────────────────


function bytesToChainString(chain: ChainKey, b: Uint8Array): string {
  if (b.length === 0) return "";
  switch (chain) {
    case "solana":
      return base58(b);
    default:
      return "0x" + hex(b);
  }
}

export function chainStringToBytes(chain: ChainKey, s: string): Uint8Array {
  const t = s.trim();
  if (chain === "solana") return base58Decode(t);
  return Uint8Array.from(Buffer.from(t.replace(/^0x/, ""), "hex"));
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(s: string): Uint8Array {
  const bytes = [0];
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    if (carry < 0) throw new Error("bad base58");
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

const STATUS: IntentStatus[] = ["pending_approval", "approved", "executing", "executed"];
const KIND = ["mint", "burn", "move"] as const;
const iso = (secs: bigint) => (secs > 0n ? new Date(Number(secs) * 1000).toISOString() : undefined);

function mapChain(d: Deployment, c: SdkChain): ChainDeployment {
  const meta = chainById(c.chainId)!;
  const key = meta.key;
  const authority =
    key === "solana"
      ? { authority: d.mintAuthority, authorityKind: "pda" as const, dwalletId: "program-pda" as const }
      : key === "sui"
        ? { authority: d.dwallets.curve25519.suiAddress, authorityKind: "address" as const, dwalletId: "dw-ed25519" as const }
        : { authority: d.dwallets.secp256k1.evmAddress, authorityKind: "address" as const, dwalletId: "dw-secp256k1" as const };
  return {
    chain: key,
    chainId: c.chainId,
    name: meta.name,
    testnet: meta.testnet,
    contractAddress: bytesToChainString(key, c.contract),
    ...authority,
    encoding: meta.encoding,
    authorized: Number(c.authorized),
    cap: Number(c.cap),
    explorerPrefix: meta.explorerTx(""),
  };
}

function approverIds(d: Deployment): ApproverId[] {
  return d.approvers.map((a) => a.name.toLowerCase() as ApproverId);
}

function mapIntent(d: Deployment, it: SdkIntent, chains: ChainDeployment[]): Intent {
  const ids = approverIds(d);
  const kind = KIND[it.kind];
  const chainOf = (id: number) => chains.find((c) => c.chainId === id)!.chain;
  const legs: Leg[] = it.legs.map((l) => ({
    action: l.action === 0 ? "mint" : "burn",
    chain: chainOf(l.chainId),
    amount: Number(it.amount),
    account: bytesToChainString(chainOf(l.chainId), l.action === 0 ? it.recipient : it.source),
  }));
  const execution: LegExecution[] = it.legs.map((l, i) => {
    const key = legs[i].chain;
    const dep = chains.find((c) => c.chain === key)!;
    const meta = CHAINS[key];
    const base: LegExecution = { status: "pending", dwalletId: dep.dwalletId, curve: meta.curve };
    if (l.status === 0) return base;
    return {
      ...base,
      status: l.status === 2 ? "confirmed" : "signing",
      messageApproval: l.messageApproval ?? undefined,
      messageDigest: l.messageDigest.some((b) => b) ? "0x" + hex(l.messageDigest) : undefined,
      // Sui transaction digests are base58, unlike Sui addresses.
      destTxHash: l.destTx.length ? (key === "sui" ? base58(l.destTx) : bytesToChainString(key, l.destTx)) : undefined,
    };
  });
  const approvals = ids.filter((_, i) => (it.approvalsBitmap >> i) & 1).map((approver) => ({ approver, at: iso(it.approvedAt) ?? iso(it.createdAt) ?? "" }));
  return {
    id: `INT-${String(Number(it.index) + 1).padStart(4, "0")}`,
    index: Number(it.index),
    type: kind,
    legs,
    amount: Number(it.amount),
    recipient: kind === "burn" ? undefined : bytesToChainString(chainOf(it.dstChain), it.recipient),
    source: kind === "mint" ? undefined : bytesToChainString(chainOf(it.srcChain), it.source),
    memo: it.memo,
    proposer: ids[d.approvers.findIndex((a) => a.pubkey === it.proposer)] ?? "alice",
    status: STATUS[it.status],
    policyResults: [],
    approvals,
    approvedAt: iso(it.approvedAt),
    createdAt: iso(it.createdAt) ?? new Date().toISOString(),
    execution: it.status === 0 ? undefined : { legs: execution },
  };
}

// ───────────────────────────── public API ─────────────────────────────────

export async function getLedger(): Promise<LedgerState> {
  const d = await deployment();
  const sdk = await loadSdk();
  const { rpc } = rpcs(d);
  const programId = d.programId as Address;
  const assetAddr = d.asset as Address;
  const chainIds = Object.keys(d.chains).map(Number);
  const [asset, sdkChains, sdkIntents] = await Promise.all([
    sdk.fetchAsset(rpc, assetAddr),
    sdk.fetchChains(rpc, programId, assetAddr, chainIds),
    sdk.fetchIntents(rpc, programId, assetAddr),
  ]);
  const chains = sdkChains.map((c) => mapChain(d, c)).sort((a, b) => a.chainId - b.chainId);
  const appAsset: Asset = { id: asset.symbol.toLowerCase(), name: asset.symbol, decimals: asset.decimals, globalCap: Number(asset.globalCap), chains };
  const intents = sdkIntents.map((it) => mapIntent(d, it, chains)).sort((a, b) => b.index - a.index);
  for (const c of chains) c.lastActivity = intents.find((i) => i.legs.some((l) => l.chain === c.chain))?.createdAt;
  const ids = approverIds(d);
  const dwallets: DWallet[] = [
    {
      id: "dw-secp256k1",
      curve: "secp256k1",
      publicKey: d.dwallets.secp256k1.publicKeyHex,
      identities: [{ label: "EVM address", value: d.dwallets.secp256k1.evmAddress }],
      chains: ["ethereum", "base", "tempo"],
      onChainAddress: d.dwallets.secp256k1.pda,
      policyProgram: d.programId,
      userShareLocation: "Issuer HSM, custodian backup (in production)",
      networkShareControl: `Authority = CPI PDA ${d.cpiAuthority}`,
    },
    {
      id: "dw-ed25519",
      curve: "ed25519",
      publicKey: d.dwallets.curve25519.publicKeyHex,
      identities: [{ label: "Sui address", value: d.dwallets.curve25519.suiAddress }],
      chains: ["sui"],
      onChainAddress: d.dwallets.curve25519.pda,
      policyProgram: d.programId,
      userShareLocation: "Issuer HSM, custodian backup (in production)",
      networkShareControl: `Authority = CPI PDA ${d.cpiAuthority}`,
    },
  ];
  return {
    asset: appAsset,
    dwallets,
    config: {
      globalCap: Number(asset.globalCap),
      chainCaps: Object.fromEntries(chains.map((c) => [c.chain, c.cap])) as Record<ChainKey, number>,
      allowlist: Object.fromEntries(
        sdkChains.map((c) => {
          const key = chainById(c.chainId)!.key;
          return [key, c.allowlist.map((a, i) => ({ label: i === 0 ? `${CHAINS[key].name} treasury` : `Allowed #${i + 1}`, address: bytesToChainString(key, a) }))];
        }),
      ) as LedgerState["config"]["allowlist"],
      approvers: d.approvers.map((a, i) => ({ id: ids[i], name: a.name, pubkey: a.pubkey })),
      threshold: asset.threshold,
      timelockSeconds: Number(asset.timelockSecs),
    },
    intents,
    meta: {
      mode: "devnet",
      programId: d.programId,
      assetPda: d.asset,
      cpiAuthority: d.cpiAuthority,
      mintAuthority: d.mintAuthority,
      ikaProgram: d.ikaProgram,
      rpcUrl: d.rpcUrl,
      grpcUrl: d.grpcUrl,
      cluster: "devnet",
    },
  };
}

export async function createIntent(draft: IntentDraft, approver: ApproverId): Promise<Intent> {
  const d = await deployment();
  const sdk = await loadSdk();
  const { rpc } = rpcs(d);
  const programId = d.programId as Address;
  const assetAddr = d.asset as Address;
  const asset = await sdk.fetchAsset(rpc, assetAddr);
  const [intentPda, bump] = await sdk.findIntentPda(programId, assetAddr, asset.intentCount);
  const kind = KIND.indexOf(draft.type) as 0 | 1 | 2;
  const src = draft.srcChain ? CHAINS[draft.srcChain].id : 0;
  const dst = draft.dstChain ? CHAINS[draft.dstChain].id : 0;
  const proposer = await approverSigner(approver);
  const ix = sdk.buildCreateIntentIx({
    programId,
    asset: assetAddr,
    intent: intentPda,
    bump,
    proposer: proposer.address,
    payer: proposer.address,
    kind,
    amount: BigInt(draft.amount),
    srcChain: src,
    dstChain: dst,
    recipient: draft.recipient && draft.dstChain ? chainStringToBytes(draft.dstChain, draft.recipient) : new Uint8Array(),
    source: draft.source && draft.srcChain ? chainStringToBytes(draft.srcChain, draft.source) : new Uint8Array(),
    memo: draft.memo,
    srcChainPda: src ? (d.chains[String(src)].pda as Address) : undefined,
    dstChainPda: dst ? (d.chains[String(dst)].pda as Address) : undefined,
  });
  try {
    await send(d, proposer, [ix]);
  } catch (e) {
    const code = sdk.extractLedgerErrorCode?.(e);
    throw new Error(explainProgramError(code ?? String((e as Error).message ?? e)));
  }
  const ledger = await getLedger();
  const created = ledger.intents.find((i) => i.index === Number(asset.intentCount));
  if (!created) throw new Error("Intent not found after creation");
  return created;
}

export async function approve(intentId: string, approver: ApproverId): Promise<Intent> {
  const d = await deployment();
  const sdk = await loadSdk();
  const index = BigInt(indexOf(intentId));
  const programId = d.programId as Address;
  const assetAddr = d.asset as Address;
  const [intentPda] = await sdk.findIntentPda(programId, assetAddr, index);
  const s = await approverSigner(approver);
  try {
    await send(d, s, [sdk.buildApproveIntentIx({ programId, asset: assetAddr, intent: intentPda, approver: s.address })]);
  } catch (e) {
    const code = sdk.extractLedgerErrorCode?.(e);
    throw new Error(explainProgramError(code ?? String((e as Error).message ?? e)));
  }
  const ledger = await getLedger();
  return ledger.intents.find((i) => i.id === intentId)!;
}

export function indexOf(intentId: string): number {
  const m = intentId.match(/^INT-(\d+)$/);
  if (!m) throw new Error(`Bad intent id ${intentId}`);
  return Number(m[1]) - 1;
}

/** Runs every remaining leg through the executor and yields app StepEvents. */
export async function* execute(intentId: string): AsyncGenerator<StepEvent | { done: true; intent: Intent }> {
  const d = await deployment();
  const executor = await loadExecutor();
  const index = indexOf(intentId);
  let ledger = await getLedger();
  let intent = ledger.intents.find((i) => i.id === intentId);
  if (!intent) throw new Error("Unknown intent");
  const cfg = {
    rpcUrl: d.rpcUrl,
    wsUrl: d.wsUrl ?? d.rpcUrl.replace(/^http/, "ws"),
    grpcUrl: d.grpcUrl,
    programId: d.programId,
    ikaProgram: d.ikaProgram,
    asset: d.asset,
    executorKeypair: await executorSigner(),
    deliver: (process.env.LEDGER_DELIVER === "live" || process.env.LEDGER_DELIVER === "evm" ? "live" : "mock") as "mock" | "live",
    evm: process.env.EVM_RPC_URL
      ? { rpcUrl: process.env.EVM_RPC_URL, mintController: process.env.EVM_MINT_CONTROLLER ?? "", privateKey: process.env.EVM_RELAYER_KEY ?? "" }
      : undefined,
  };
  for (let leg = 0; leg < intent.legs.length; leg++) {
    const ex: LegExecution = { ...(intent.execution?.legs[leg] ?? { status: "pending" }) };
    if (ex.status === "confirmed") continue;
    const step = (s: string): 1 | 2 | 3 => (s === "policy" || s === "ika-approval" ? 1 : s === "ika-signature" ? 2 : 3);
    for await (const ev of executor.runLeg(cfg, BigInt(index), leg)) {
      const st = step(ev.step);
      ex.status = st === 1 ? "policy" : st === 2 ? "signing" : "broadcast";
      if (ev.step === "policy" && ev.txHash) ex.policyTxHash = ev.txHash;
      if (ev.messageApproval) ex.messageApproval = ev.messageApproval;
      if (ev.step === "ika-signature" && ev.signature) {
        ex.signature = ev.signature;
        ex.ikaSignatureId = `sig-${ev.signature.replace(/^0x/, "").slice(0, 12)}`;
      }
      // Foreign legs report the destination tx at deliver; confirm then carries the Solana signature.
      if (ev.txHash && (ev.step === "deliver" || (ev.step === "confirm" && !ex.destTxHash))) ex.destTxHash = ev.txHash;
      if (ev.status === "error") ex.error = ev.detail;
      yield { intentId, leg, step: st, status: ev.status, detail: ev.detail, execution: { ...ex } };
      if (ev.status === "error") throw new Error(ev.detail ?? `Leg ${leg} failed at ${ev.step}`);
    }
    ex.status = "confirmed";
    ledger = await getLedger();
    intent = ledger.intents.find((i) => i.id === intentId)!;
    const legs = intent.execution?.legs ?? [];
    legs[leg] = { ...legs[leg], ...ex };
    intent.execution = { legs };
    yield { intentId, leg, step: 3, status: "ok", execution: { ...ex }, intent, asset: ledger.asset };
  }
  yield { done: true, intent };
}

export const timelockSeconds = () => demoConfig.timelockSeconds;

// ───────────────────────────── activity ───────────────────────────────────

const IX_KIND: Record<number, ActivityEntry["kind"]> = { 2: "create", 3: "approve", 4: "execute", 5: "confirm" };

type RpcTx = Awaited<ReturnType<ReturnType<ReturnType<typeof createSolanaRpc>["getTransaction"]>["send"]>>;
const TX_CACHE = new Map<string, NonNullable<RpcTx>>();

async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts - 1 || !/429|Too Many/i.test(String((e as Error).message))) throw e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
}

/**
 * Every Solana transaction that touched this intent, read back from devnet:
 * create_intent, each approve_intent, execute_leg and confirm_leg on the intent
 * account, plus the Ika network's CommitSignature on each MessageApproval.
 */
export async function activity(intentId: string): Promise<ActivityEntry[]> {
  const d = await deployment();
  const sdk = await loadSdk();
  const { rpc } = rpcs(d);
  const programId = d.programId as Address;
  const assetAddr = d.asset as Address;
  const index = indexOf(intentId);
  const [intentPda] = await sdk.findIntentPda(programId, assetAddr, BigInt(index));
  const names = new Map<string, string>([[d.executor, "Executor"], ...d.approvers.map((a) => [a.pubkey, a.name] as [string, string])]);

  const intent = (await sdk.fetchIntents(rpc, programId, assetAddr)).find((i) => Number(i.index) === index);
  const approvals = (intent?.legs ?? []).map((l) => l.messageApproval).filter((a): a is Address => !!a);

  const load = async (account: Address) => {
    const sigs = await withRetry(() => rpc.getSignaturesForAddress(account, { limit: 50 }).send());
    const rows = [];
    // One at a time: the public devnet RPC rate-limits bursts. Finalized transactions never change, so cache them.
    for (const s of sigs.filter((x) => !x.err)) {
      let tx: RpcTx = TX_CACHE.get(s.signature) ?? null;
      if (!tx) {
        tx = await withRetry(() => rpc.getTransaction(s.signature, { encoding: "json", maxSupportedTransactionVersion: 0 }).send());
        if (tx) TX_CACHE.set(s.signature, tx);
      }
      rows.push({ s, tx });
    }
    return rows;
  };

  const out: ActivityEntry[] = [];
  for (const { s, tx } of await load(intentPda)) {
    if (!tx) continue;
    const keys = tx.transaction.message.accountKeys as readonly string[];
    const ix = tx.transaction.message.instructions.find((i) => keys[i.programIdIndex] === programId);
    if (!ix) continue;
    const data = base58Decode(ix.data as string);
    const kind = IX_KIND[data[0]];
    if (!kind) continue;
    out.push({
      kind,
      signer: keys[0],
      signerName: names.get(keys[0]) ?? "Unknown key",
      signature: s.signature,
      slot: Number(s.slot),
      at: s.blockTime ? new Date(Number(s.blockTime) * 1000).toISOString() : undefined,
      leg: kind === "execute" || kind === "confirm" ? data[1] : undefined,
    });
  }
  // The network's signature lands on the MessageApproval in its own transaction.
  for (const [leg, ma] of approvals.entries()) {
    for (const { s, tx } of await load(ma)) {
      if (!tx || out.some((e) => e.signature === s.signature)) continue;
      const signer = (tx.transaction.message.accountKeys as readonly string[])[0];
      out.push({
        kind: "ika-sign",
        signer,
        signerName: "Ika network",
        signature: s.signature,
        slot: Number(s.slot),
        at: s.blockTime ? new Date(Number(s.blockTime) * 1000).toISOString() : undefined,
        leg,
      });
    }
  }
  return out.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
}
