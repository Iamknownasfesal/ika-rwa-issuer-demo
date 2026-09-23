/**
 * Create and approve an intent on devnet from the CLI (no console needed).
 *
 *   pnpm demo:intent --kind mint --dst 3 --amount 2500000            # mint 2.5M on Base to its treasury
 *   pnpm demo:intent --kind burn --src 1 --amount 1000000            # burn 1M on Solana from the treasury
 *   pnpm demo:intent --kind move --src 2 --dst 4 --amount 5000000    # move 5M Ethereum → Sui
 *   pnpm demo:intent ... --no-approve                                # leave it pending
 *
 * Proposer = Alice, approvers = Bob + Carol. Prints the intent index; then run
 * `pnpm executor run --intent <index>` to execute every leg.
 */
import {
  buildApproveIntentIx, buildCreateIntentIx, fetchAsset, findChainPda, findIntentPda, parseChainAddress, chainById,
} from '@ika-rwa/ledger-sdk';
import { createClient, loadDeployment, loadKeypair, repoRoot, sendInstructions } from '@ika-rwa/executor';
import { resolve } from 'node:path';
import type { Address } from '@solana/kit';

const args = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (n: string) => args.includes(`--${n}`);

const KIND = { mint: 0, burn: 1, move: 2 } as const;
const kindText = (arg('kind') ?? 'mint') as keyof typeof KIND;
const kind = KIND[kindText];
const src = Number(arg('src') ?? 0);
const dst = Number(arg('dst') ?? 0);
const amount = BigInt(arg('amount') ?? '1000000') * 1_000_000n;
const ONE = 1_000_000n;

const d = loadDeployment();
const client = createClient(d.rpcUrl, d.wsUrl ?? d.rpcUrl.replace('https', 'wss'));
const programId = d.programId as Address;
const asset = d.asset as Address;
const keys = (n: string) => resolve(repoRoot(), 'keys', `${n}.json`);
const alice = await loadKeypair(keys('approver-alice'));
const bob = await loadKeypair(keys('approver-bob'));
const carol = await loadKeypair(keys('approver-carol'));

const a = await fetchAsset(client.rpc, asset);
const index = a.intentCount;
const [intent, bump] = await findIntentPda(programId, asset, index);
const recipient = dst ? parseChainAddress(dst, arg('to') ?? d.chains[String(dst)].treasury) : new Uint8Array();
const source = src ? parseChainAddress(src, arg('from') ?? d.chains[String(src)].treasury) : new Uint8Array();

console.log(`intent #${index}: ${kindText} ${amount / ONE} ${src ? chainById(src).name : ''}${src && dst ? ' → ' : ''}${dst ? chainById(dst).name : ''}`);
const ix = buildCreateIntentIx({
  programId, asset, intent, bump, proposer: alice.address, payer: alice.address, kind, amount, srcChain: src, dstChain: dst,
  recipient, source, memo: arg('memo') ?? `demo ${kindText}`,
  srcChainPda: src ? (await findChainPda(programId, asset, src))[0] : undefined,
  dstChainPda: dst ? (await findChainPda(programId, asset, dst))[0] : undefined,
});
const created = await sendInstructions(client, alice, [ix]);
console.log(`  created ${intent} (${created.signature})`);

if (!flag('no-approve')) {
  for (const who of [bob, carol]) {
    const s = await sendInstructions(client, who, [buildApproveIntentIx({ programId, asset, intent, approver: who.address })]);
    console.log(`  approved by ${who.address} (${s.signature})`);
  }
  console.log(`  approved; timelock ${a.timelockSecs}s. Next: pnpm executor run --intent ${index}`);
}
