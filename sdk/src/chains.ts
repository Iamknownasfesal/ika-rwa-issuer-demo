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
  Arc: 5,
} as const;
export type ChainIdValue = (typeof ChainId)[keyof typeof ChainId];

export type ChainKey = 'solana' | 'ethereum' | 'base' | 'sui' | 'arc';

/** `ChainDeployment.leg_kind`: 0 = Token-2022 CPI on Solana, 1 = Ika `issue_signature_voucher` CPI. */
export const LegKind = { SolanaNative: 0, IkaForeign: 1 } as const;
/** `ChainDeployment.encoding`: 0 = raw authorization bytes, 1 = EIP-712. */
export const Encoding = { Raw: 0, Eip712: 1 } as const;
/** Ika `DWalletCurve` (u16). */
export const IkaCurve = { Secp256k1: 0, Secp256r1: 1, Curve25519: 2, Ristretto: 3 } as const;
/** Ika `DWalletSignatureScheme` (u16). */
export const IkaScheme = { EcdsaKeccak256: 0, EddsaSha512: 5 } as const;

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
  [ChainId.Arc]: evm(ChainId.Arc, 'arc', 'Arc', 'arc-testnet', 5042002, 'https://testnet.arcscan.app'),
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

/**
 * The Ika Solana devnet pre-alpha. A wipe can move the program and change the network key;
 * the coordinator account records the chain number and the network value.
 */
export const IKA_DEVNET_PRE_ALPHA = {
  programId: '8siGnE3tCZbu4LTuX8QoBPErvWeGBF4pRSJDnaGdHyQv',
  grpcUrl: 'https://solana-alpha-dev-1.ika-network.net',
  networkKey: 'fe8a6482521cc4bae052c55cd5b3c92d05c8749bcc2c584046de3efb077d65ed',
  chainNumber: 1,
  networkValue: 3,
} as const;
export const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com';
export const SOLANA_DEVNET_WS = 'wss://api.devnet.solana.com';
