import seed from "./seed.json";
import { demoConfig, type ApproverId } from "./demoConfig";
import { CHAINS, CHAIN_ORDER } from "./lib/chains";
import { fake } from "./lib/hashes";
import { toBase } from "./lib/format";
import type { AllowlistEntry, Asset, ChainDeployment, ChainKey, DWallet, Intent, LedgerState, PolicyConfig } from "./types";

/** Fixed demo identities (deterministic, correctly formatted per chain). */
export const IDS = {
  policyProgram: "DkXkmLYeR63gxhvD4FkV2oAJjkKzUUGJhDoqA6ULdauE",
  assetPda: fake.solanaAddress("issuer-ledger-asset"),
  cpiAuthority: fake.solanaAddress("issuer-ledger-cpi-authority"),
  mintAuthority: fake.solanaAddress("issuer-ledger-mint-authority"),
  ikaProgram: "87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY",
  secpPubkey: "02" + fake.pubkeyHex("dw-secp256k1", 32),
  edPubkey: fake.pubkeyHex("dw-ed25519", 32),
  evmAddress: fake.evmAddress("dw-secp256k1-evm"),
  suiAddress: fake.suiAddress("dw-ed25519-sui"),
  contracts: {
    solana: fake.solanaAddress("tbill-mint"),
    ethereum: fake.evmAddress("tbill-mintcontroller-eth"),
    base: fake.evmAddress("tbill-mintcontroller-base"),
    sui: fake.suiAddress("tbill-move-package") + "::tbill::TBILL",
    tempo: fake.evmAddress("tbill-mintcontroller-tempo"),
  } satisfies Record<ChainKey, string>,
  treasuries: {
    solana: fake.solanaAddress("tbill-treasury-solana"),
    ethereum: fake.evmAddress("tbill-treasury-eth"),
    base: fake.evmAddress("tbill-treasury-base"),
    sui: fake.suiAddress("tbill-treasury-sui"),
    tempo: fake.evmAddress("tbill-treasury-tempo"),
  } satisfies Record<ChainKey, string>,
};

function authorityFor(chain: ChainKey): Pick<ChainDeployment, "authority" | "authorityKind" | "dwalletId"> {
  switch (chain) {
    case "solana":
      return { authority: IDS.mintAuthority, authorityKind: "pda", dwalletId: "program-pda" };
    case "ethereum":
    case "base":
    case "tempo":
      return { authority: IDS.evmAddress, authorityKind: "address", dwalletId: "dw-secp256k1" };
    case "sui":
      return { authority: IDS.suiAddress, authorityKind: "address", dwalletId: "dw-ed25519" };
  }
}

export function buildSeed(): LedgerState {
  const chains: ChainDeployment[] = seed.chains.map((c) => {
    const key = c.chain as ChainKey;
    const meta = CHAINS[key];
    return {
      chain: key,
      chainId: meta.id,
      name: meta.name,
      testnet: meta.testnet,
      contractAddress: IDS.contracts[key],
      ...authorityFor(key),
      encoding: meta.encoding,
      authorized: toBase(c.authorized),
      cap: toBase(c.cap),
      explorerPrefix: meta.explorerTx(""),
    };
  });

  const asset: Asset = {
    id: seed.asset.id,
    name: seed.asset.name,
    decimals: seed.asset.decimals,
    globalCap: toBase(seed.asset.globalCap),
    chains,
  };

  const approvers = demoConfig.approvers.map((a) => ({ id: a.id, name: a.name, pubkey: fake.solanaAddress(`approver-${a.id}`) }));

  const allowlist = Object.fromEntries(
    CHAIN_ORDER.map((k) => [k, [{ label: `${CHAINS[k].name} treasury`, address: IDS.treasuries[k] }] as AllowlistEntry[]]),
  ) as Record<ChainKey, AllowlistEntry[]>;

  const config: PolicyConfig = {
    globalCap: asset.globalCap,
    chainCaps: Object.fromEntries(chains.map((c) => [c.chain, c.cap])) as Record<ChainKey, number>,
    allowlist,
    approvers,
    threshold: seed.threshold,
    timelockSeconds: demoConfig.timelockSeconds,
  };

  const dwallets: DWallet[] = [
    {
      id: "dw-secp256k1",
      curve: "secp256k1",
      publicKey: IDS.secpPubkey,
      identities: [{ label: "EVM address", value: IDS.evmAddress }],
      chains: ["ethereum", "base", "tempo"],
      onChainAddress: fake.solanaAddress("dwallet-pda-secp"),
      policyProgram: IDS.policyProgram,
      userShareLocation: "Issuer HSM, custodian backup (in production)",
      networkShareControl: `Signs only MessageApprovals created by policy program ${IDS.policyProgram}`,
    },
    {
      id: "dw-ed25519",
      curve: "ed25519",
      publicKey: IDS.edPubkey,
      identities: [{ label: "Sui address", value: IDS.suiAddress }],
      chains: ["sui"],
      onChainAddress: fake.solanaAddress("dwallet-pda-ed"),
      policyProgram: IDS.policyProgram,
      userShareLocation: "Issuer HSM, custodian backup (in production)",
      networkShareControl: `Signs only MessageApprovals created by policy program ${IDS.policyProgram}`,
    },
  ];

  const now = Date.now();
  const intents: Intent[] = seed.history.map((h, i) => {
    const chain = h.chain as ChainKey;
    const meta = CHAINS[chain];
    const amount = toBase(h.amount);
    const created = new Date(now - h.daysAgo * 86_400_000);
    const approvedAt = new Date(created.getTime() + 90_000);
    const dep = chains.find((c) => c.chain === chain)!;
    const tag = `hist-${i}`;
    const isSolana = chain === "solana";
    return {
      id: `INT-${String(i + 1).padStart(4, "0")}`,
      index: i,
      type: "mint",
      legs: [{ action: "mint", chain, amount, account: IDS.treasuries[chain] }],
      amount,
      recipient: IDS.treasuries[chain],
      memo: `Initial ${meta.name} allocation`,
      proposer: h.proposer as ApproverId,
      status: "executed",
      policyResults: [],
      approvals: h.approvers.map((a, j) => ({ approver: a as ApproverId, at: new Date(created.getTime() + 30_000 * (j + 1)).toISOString() })),
      approvedAt: approvedAt.toISOString(),
      createdAt: created.toISOString(),
      execution: {
        legs: [
          {
            status: "confirmed",
            policyTxHash: fake.solanaTx(`${tag}-policy`),
            messageApproval: isSolana ? undefined : fake.solanaAddress(`${tag}-ma`),
            messageDigest: isSolana ? undefined : fake.digest(`${tag}-digest`),
            ikaSignatureId: isSolana ? undefined : `sig-${fake.pubkeyHex(`${tag}-sig`, 6)}`,
            signature: isSolana ? undefined : "0x" + fake.pubkeyHex(`${tag}-sigbytes`, 64),
            dwalletId: dep.dwalletId,
            curve: meta.curve,
            destTxHash: meta.fakeTx(`${tag}-dest`),
            block: fake.block(`${tag}-block`),
          },
        ],
      },
    };
  });
  for (const c of chains) {
    const last = intents.filter((i) => i.legs.some((l) => l.chain === c.chain)).at(-1);
    c.lastActivity = last?.createdAt;
  }

  return {
    asset,
    dwallets,
    config,
    intents: intents.reverse(),
    meta: {
      mode: "mock",
      programId: IDS.policyProgram,
      assetPda: IDS.assetPda,
      cpiAuthority: IDS.cpiAuthority,
      mintAuthority: IDS.mintAuthority,
      ikaProgram: IDS.ikaProgram,
      cluster: "simulated",
    },
  };
}
