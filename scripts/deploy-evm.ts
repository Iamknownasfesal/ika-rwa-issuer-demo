/**
 * Deploy `MintController` (contracts/evm) to the EVM testnets and record the addresses.
 *
 *   pnpm deploy:evm [--only sepolia,base-sepolia,tempo-moderato] [--force]
 *
 * Env (see .env.example): EVM_DEPLOYER_KEY (0x-prefixed private key; generated into keys/evm-deployer.json
 * when unset), SEPOLIA_RPC_URL, BASE_SEPOLIA_RPC_URL, TEMPO_RPC_URL.
 *
 * Reads `dwalletSigner` (the secp256k1 dWallet's EVM address) and `ledger` (the Solana Asset PDA) from
 * deployments/devnet.json, so the controller is bound to exactly this ledger and signer. Writes
 * deployments/evm.json. Chains that cannot be funded are skipped with the faucet instructions printed.
 */
import { createPublicClient, createWalletClient, http, type Hex, type Address, formatEther, parseAbi } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { sepolia, baseSepolia, tempoModerato } from 'viem/chains';
import { createClient as createTempoClient, Addresses as TempoAddresses } from 'viem/tempo';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVM_DIR = resolve(ROOT, 'contracts/evm');
const OUT = resolve(ROOT, 'deployments/evm.json');
const SEED = JSON.parse(readFileSync(resolve(ROOT, 'scripts/seed-supply.json'), 'utf8')) as Record<string, { authorized: string }>;
/** Ledger chain ids: Ethereum 2, Base 3, Tempo 5. */
const LEDGER_CHAIN: Record<string, string> = { sepolia: '2', 'base-sepolia': '3', 'tempo-moderato': '5' };
const genesisFor = (key: string): bigint => BigInt(SEED[LEDGER_CHAIN[key]]?.authorized ?? '0');
const args = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (n: string) => args.includes(`--${n}`);

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m: string) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const log = (m: string) => console.log(`\x1b[36m${m}\x1b[0m`);

interface Target { key: string; chain: typeof sepolia; rpc: string; faucets: string[]; tempo?: boolean }
const TARGETS: Target[] = [
  { key: 'sepolia', chain: sepolia, rpc: process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com',
    faucets: ['https://cloud.google.com/application/web3/faucet/ethereum/sepolia', 'https://www.alchemy.com/faucets/ethereum-sepolia', 'https://sepoliafaucet.com'] },
  { key: 'base-sepolia', chain: baseSepolia as unknown as typeof sepolia, rpc: process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
    faucets: ['https://www.alchemy.com/faucets/base-sepolia', 'https://faucet.quicknode.com/base/sepolia', 'https://docs.base.org/base-chain/tools/network-faucets'] },
  { key: 'tempo-moderato', chain: tempoModerato as unknown as typeof sepolia, rpc: process.env.TEMPO_RPC_URL ?? 'https://rpc.moderato.tempo.xyz',
    faucets: ['cast rpc tempo_fundAddress <ADDRESS> --rpc-url https://rpc.moderato.tempo.xyz'], tempo: true },
];

export interface EvmDeploymentRecord {
  chainKey: string;
  chainId: number;
  mintController: Address;
  dwalletSigner: Address;
  ledger: Hex;
  domainSeparator: Hex;
  treasury: Address;
  deployer: Address;
  explorer: string;
  txHash: Hex;
  rpcUrl: string;
  feeToken?: Address;
}

function loadDeployerKey(): Hex {
  if (process.env.EVM_DEPLOYER_KEY) return process.env.EVM_DEPLOYER_KEY as Hex;
  const path = resolve(ROOT, 'keys/evm-deployer.json');
  if (existsSync(path)) return (JSON.parse(readFileSync(path, 'utf8')) as { privateKey: Hex }).privateKey;
  const privateKey = generatePrivateKey();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ privateKey, address: privateKeyToAccount(privateKey).address }, null, 2) + '\n');
  ok(`generated EVM deployer/relayer key → ${path}`);
  return privateKey;
}

function artifact(): { abi: unknown; bytecode: Hex } {
  execSync('forge build', { cwd: EVM_DIR, stdio: 'pipe', env: { ...process.env, PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}` } });
  const j = JSON.parse(readFileSync(resolve(EVM_DIR, 'out/MintController.sol/MintController.json'), 'utf8'));
  return { abi: j.abi, bytecode: j.bytecode.object as Hex };
}

async function main() {
  const devnet = JSON.parse(readFileSync(resolve(ROOT, 'deployments/devnet.json'), 'utf8')) as {
    asset?: string; dwallets?: { secp256k1?: { evmAddress?: string } };
  };
  const dwalletSigner = devnet.dwallets?.secp256k1?.evmAddress as Address | undefined;
  if (!dwalletSigner || !devnet.asset) throw new Error('deployments/devnet.json needs dwallets.secp256k1.evmAddress and asset: run pnpm setup:devnet first');
  const ledger = `0x${Buffer.from(bs58.decode(devnet.asset)).toString('hex')}` as Hex;

  const key = loadDeployerKey();
  const account = privateKeyToAccount(key);
  log(`═══ MintController deployment ═══`);
  console.log(`  deployer/relayer: ${account.address}\n  dWallet signer:   ${dwalletSigner}\n  ledger (asset):   ${devnet.asset} = ${ledger}`);

  const { abi, bytecode } = artifact();
  const previous: Record<string, EvmDeploymentRecord> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  const only = arg('only')?.split(',');
  const out: Record<string, EvmDeploymentRecord> = { ...previous };

  for (const t of TARGETS) {
    if (only && !only.includes(t.key)) continue;
    const chainId = t.chain.id;
    log(`\n[${t.key}] chain ${chainId} via ${t.rpc}`);
    const prev = previous[String(chainId)];
    if (prev && !flag('force') && prev.dwalletSigner.toLowerCase() === dwalletSigner.toLowerCase() && prev.ledger === ledger) {
      ok(`already deployed at ${prev.mintController} for this signer/ledger (use --force to redeploy)`);
      continue;
    }
    try {
      const publicClient = createPublicClient({ chain: t.chain, transport: http(t.rpc) });
      let hash: Hex;
      let feeToken: Address | undefined;
      if (t.tempo) {
        // Tempo has no native gas token: fees are paid in a stablecoin (pathUSD) with the 0x76 tx type,
        // which viem's Tempo client serializes for us. The public faucet funds any address.
        feeToken = TempoAddresses.pathUsd;
        const tempo = createTempoClient({ account, chain: tempoModerato, transport: http(t.rpc), feeToken });
        // Fund from the public faucet (idempotent on testnet; 1M of each test stablecoin).
        try {
          await tempo.faucet.fundSync({ account: account.address });
          ok('funded from the Tempo faucet (tempo_fundAddress)');
        } catch (e) {
          warn(`faucet: ${(e as Error).message.split('\n')[0].slice(0, 120)}`);
        }
        const bal = await tempo.token.getBalance({ account: account.address, token: feeToken });
        ok(`pathUSD balance ${JSON.stringify(bal, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
        hash = await tempo.deployContract({ abi: abi as never, bytecode, args: [dwalletSigner, ledger, 'Tokenized T-Bill Fund', 'TBILL', account.address, genesisFor(t.key)] });
      } else {
        const bal = await publicClient.getBalance({ address: account.address });
        if (bal === 0n) {
          warn(`deployer ${account.address} has 0 ETH on ${t.key}. Fund it, then rerun. Faucets:`);
          for (const f of t.faucets) console.log(`      ${f}`);
          continue;
        }
        ok(`balance ${formatEther(bal)} ETH`);
        const wallet = createWalletClient({ account, chain: t.chain, transport: http(t.rpc) });
        hash = await wallet.deployContract({ abi: abi as never, bytecode, args: [dwalletSigner, ledger, 'Tokenized T-Bill Fund', 'TBILL', account.address, genesisFor(t.key)] });
      }
      ok(`deploy tx ${hash} (genesis ${genesisFor(t.key) / 1_000_000n} TBILL to the treasury)`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress) throw new Error('no contractAddress in receipt');
      const mintController = receipt.contractAddress;
      // Public RPCs can lag a block behind the receipt: retry the first read instead of failing the chain.
      let domainSeparator: `0x${string}` | undefined;
      for (let i = 0; i < 10 && !domainSeparator; i++) {
        try {
          domainSeparator = await publicClient.readContract({ address: mintController, abi: parseAbi(['function DOMAIN_SEPARATOR() view returns (bytes32)']), functionName: 'DOMAIN_SEPARATOR' });
        } catch (e) {
          if (i === 9) throw e;
          await new Promise((r) => setTimeout(r, 2_000));
        }
      }
      if (!domainSeparator) throw new Error('DOMAIN_SEPARATOR read failed');
      const explorer = `${t.chain.blockExplorers?.default.url ?? ''}/address/${mintController}`;
      out[String(chainId)] = { chainKey: t.key, chainId, mintController, dwalletSigner, ledger, domainSeparator, treasury: account.address, deployer: account.address, explorer, txHash: hash, rpcUrl: t.rpc, feeToken };
      ok(`MintController ${mintController}  ${explorer}`);
      ok(`domain separator ${domainSeparator}`);
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
    } catch (e) {
      warn(`${t.key} failed: ${(e as Error).message.split('\n')[0].slice(0, 200)}`);
    }
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`\n  wrote ${OUT}`);
}

main().catch((e) => { console.error('\x1b[31mdeploy failed:\x1b[0m', e); process.exit(1); });
