/**
 * Chain registry for the demo. Chain ids are the `u16` values stored in each
 * `ChainDeployment` account. Everything else here is off-chain metadata used
 * to render addresses / explorer links and to pick the right Ika curve and
 * signature scheme when a dWallet is created for a chain.
 */

export const ChainId = {
  Solana: 1,
  Ethereum: 2,
  Base: 3,
  Sui: 4,
  Tempo: 5,
} as const;
export type ChainIdValue = (typeof ChainId)[keyof typeof ChainId];

export type ChainKey = 'solana' | 'ethereum' | 'base' | 'sui' | 'tempo';

/** `ChainDeployment.leg_kind`: 0 = Token-2022 CPI on Solana, 1 = Ika `approve_message` CPI. */
export const LegKind = { SolanaNative: 0, IkaForeign: 1 } as const;
/** `ChainDeployment.encoding`: 0 = raw authorization bytes, 1 = EIP-712. */
export const Encoding = { Raw: 0, Eip712: 1 } as const;
/** Ika `DWalletCurve` (u16). */
export const IkaCurve = { Secp256k1: 0, Secp256r1: 1, Curve25519: 2, Ristretto: 3 } as const;
/** Ika `DWalletSignatureScheme` (u16). */
export const IkaScheme = { EcdsaKeccak256: 0, EddsaSha512: 5 } as const;
/** Ika `DWalletSignatureAlgorithm` (used for presigns). */
export const IkaAlgorithm = { ECDSASecp256k1: 0, ECDSASecp256r1: 1, Taproot: 2, EdDSA: 3, Schnorrkel: 4 } as const;

export interface ChainMeta {
  id: number;
  key: ChainKey;
  name: string;
  legKind: 0 | 1;
  encoding: 0 | 1;
  curve: 0 | 2;
  signatureScheme: 0 | 5;
  addressBytes: 20 | 32;
  testnet: string;
  /** EVM chain id where applicable (used for the EIP-712 domain). */
  evmChainId?: number;
  explorerTx: (hash: string) => string;
  explorerAddress: (addr: string) => string;
}

const evm = (id: number, key: ChainKey, name: string, testnet: string, evmChainId: number, base: string): ChainMeta => ({
  id,
  key,
  name,
  legKind: LegKind.IkaForeign,
  encoding: Encoding.Eip712,
  curve: IkaCurve.Secp256k1,
  signatureScheme: IkaScheme.EcdsaKeccak256,
  addressBytes: 20,
  testnet,
  evmChainId,
  explorerTx: (h) => `${base}/tx/${h}`,
  explorerAddress: (a) => `${base}/address/${a}`,
});

export const CHAINS: Record<number, ChainMeta> = {
  [ChainId.Solana]: {
    id: ChainId.Solana,
    key: 'solana',
    name: 'Solana',
    legKind: LegKind.SolanaNative,
    encoding: Encoding.Raw,
    curve: IkaCurve.Curve25519,
    signatureScheme: IkaScheme.EddsaSha512,
    addressBytes: 32,
    testnet: 'devnet',
    explorerTx: (h) => `https://explorer.solana.com/tx/${h}?cluster=devnet`,
    explorerAddress: (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`,
  },
  [ChainId.Ethereum]: evm(ChainId.Ethereum, 'ethereum', 'Ethereum', 'sepolia', 11155111, 'https://sepolia.etherscan.io'),
  [ChainId.Base]: evm(ChainId.Base, 'base', 'Base', 'base-sepolia', 84532, 'https://sepolia.basescan.org'),
  [ChainId.Sui]: {
    id: ChainId.Sui,
    key: 'sui',
    name: 'Sui',
    legKind: LegKind.IkaForeign,
    encoding: Encoding.Raw,
    curve: IkaCurve.Curve25519,
    signatureScheme: IkaScheme.EddsaSha512,
    addressBytes: 32,
    testnet: 'sui-testnet',
    explorerTx: (h) => `https://suiscan.xyz/testnet/tx/${h}`,
    explorerAddress: (a) => `https://suiscan.xyz/testnet/account/${a}`,
  },
  [ChainId.Tempo]: evm(ChainId.Tempo, 'tempo', 'Tempo', 'tempo-moderato', 42431, 'https://explore.testnet.tempo.xyz'),
};

export const CHAIN_LIST: ChainMeta[] = Object.values(CHAINS).sort((a, b) => a.id - b.id);

export function chainByKey(key: ChainKey): ChainMeta {
  const c = CHAIN_LIST.find((x) => x.key === key);
  if (!c) throw new Error(`unknown chain key ${key}`);
  return c;
}

export function chainById(id: number): ChainMeta {
  const c = CHAINS[id];
  if (!c) throw new Error(`unknown chain id ${id}`);
  return c;
}

/** Ika pre-alpha environment. */
export const IKA_DWALLET_PROGRAM_DEVNET = '87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY';
export const IKA_GRPC_DEVNET = 'pre-alpha-dev-1.ika.ika-network.net:443';
export const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com';
export const SOLANA_DEVNET_WS = 'wss://api.devnet.solana.com';

/** Ika presign algorithm for a chain's curve. */
export function presignAlgorithmForCurve(curve: number): number {
  return curve === IkaCurve.Secp256k1 ? IkaAlgorithm.ECDSASecp256k1 : IkaAlgorithm.EdDSA;
}
