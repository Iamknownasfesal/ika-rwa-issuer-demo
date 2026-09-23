/** Thin @solana/kit helpers shared by the executor and the setup script. */
import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createSolanaRpcFromTransport,
  createDefaultRpcTransport,
  type RpcTransport,
  createTransactionMessage,
  fetchEncodedAccount,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  sendTransactionWithoutConfirmingFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from '@solana/kit';
import bs58 from 'bs58';

export type SolanaRpc = ReturnType<typeof createSolanaRpc>;
export type SolanaRpcSubscriptions = ReturnType<typeof createSolanaRpcSubscriptions>;

export interface SolanaClient {
  rpc: SolanaRpc;
  rpcSubscriptions: SolanaRpcSubscriptions;
  sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>;
}

/** Default JSON-RPC transport with exponential backoff on HTTP 429 / transient network errors. */
function createRetryingTransport(url: string): RpcTransport {
  const base = createDefaultRpcTransport({ url });
  return async <T>(...args: Parameters<RpcTransport>): Promise<T> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 7; attempt++) {
      try {
        return (await base(...args)) as T;
      } catch (e) {
        lastError = e;
        const text = String((e as Error).message ?? e);
        const transient = /429|Too Many Requests|fetch failed|ECONNRESET|ETIMEDOUT|503|502/.test(text);
        if (!transient || attempt === 6) throw e;
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
    throw lastError;
  };
}

export function createClient(rpcUrl: string, wsUrl: string): SolanaClient {
  const rpc = createSolanaRpcFromTransport(createRetryingTransport(rpcUrl)) as SolanaRpc;
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  // The factory overloads are keyed on cluster URL types; devnet is what we use.
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions } as Parameters<typeof sendAndConfirmTransactionFactory>[0]);
  return { rpc, rpcSubscriptions, sendAndConfirm };
}

/**
 * Attach signers to instruction account metas so kit can sign for every
 * `READONLY_SIGNER` / `WRITABLE_SIGNER` account whose address matches.
 */
export function withSigners(ix: Instruction, signers: KeyPairSigner[]): Instruction {
  const accounts = (ix.accounts ?? []).map((meta) => {
    const s = signers.find((k) => k.address === meta.address);
    return s ? { ...meta, signer: s } : meta;
  });
  return { ...ix, accounts };
}

export interface SentTx {
  signature: Signature;
  signatureBytes: Uint8Array;
  slot: bigint;
}

export async function sendInstructions(client: SolanaClient, payer: KeyPairSigner, ixs: Instruction[], extraSigners: KeyPairSigner[] = []): Promise<SentTx> {
  const signers = [payer, ...extraSigners];
  const { value: latestBlockhash } = await client.rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(ixs.map((ix) => withSigners(ix, signers)), m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  // Send without subscriptions and confirm by polling: the public devnet WebSocket endpoint
  // drops connections under load, and polling keeps the demo path dependency-free.
  const send = sendTransactionWithoutConfirmingFactory({ rpc: client.rpc });
  await send(signed, { commitment: 'confirmed' });
  const signature = getSignatureFromTransaction(signed);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const status = await client.rpc.getSignatureStatuses([signature]).send();
    const s = status.value[0];
    if (s) {
      if (s.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(s.err)}`);
      if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') {
        return { signature, signatureBytes: bs58.decode(signature), slot: s.slot };
      }
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`timeout confirming ${signature}`);
}

export async function accountExists(rpc: SolanaRpc, address: Address): Promise<boolean> {
  const acc = await fetchEncodedAccount(rpc, address);
  return acc.exists;
}

export async function pollAccount(rpc: SolanaRpc, address: Address, check: (data: Uint8Array) => boolean, timeoutMs = 30_000, intervalMs = 1_000): Promise<Uint8Array> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const acc = await fetchEncodedAccount(rpc, address);
    if (acc.exists && check(new Uint8Array(acc.data))) return new Uint8Array(acc.data);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`timeout waiting for ${address}`);
}

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
export function explorerAddress(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}
