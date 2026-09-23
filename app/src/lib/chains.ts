import type { ChainKey, Curve } from "@/types";
import { fake } from "./hashes";

export interface ChainMeta {
  key: ChainKey;
  id: number;
  name: string;
  testnet: string;
  curve: Curve | "n/a";
  encoding: "eip712" | "raw" | "native";
  addressPlaceholder: string;
  explorerTx: (hash: string) => string;
  explorerAddress: (addr: string) => string;
  fakeTx: (seed: string) => string;
  isValidAddress: (s: string) => boolean;
}

const evm = (key: ChainKey, id: number, name: string, testnet: string, explorer: string): ChainMeta => ({
  key,
  id,
  name,
  testnet,
  curve: "secp256k1",
  encoding: "eip712",
  addressPlaceholder: "0x… (20 bytes)",
  explorerTx: (h) => `${explorer}/tx/${h}`,
  explorerAddress: (a) => `${explorer}/address/${a}`,
  fakeTx: fake.evmTx,
  isValidAddress: (s) => /^0x[0-9a-fA-F]{40}$/.test(s),
});

export const CHAINS: Record<ChainKey, ChainMeta> = {
  solana: {
    key: "solana",
    id: 1,
    name: "Solana",
    testnet: "devnet",
    curve: "n/a",
    encoding: "native",
    addressPlaceholder: "base58 token account",
      explorerTx: (h) => `https://explorer.solana.com/tx/${h}?cluster=devnet`,
    explorerAddress: (a) => `https://explorer.solana.com/address/${a}?cluster=devnet`,
    fakeTx: fake.solanaTx,
    isValidAddress: (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s),
  },
  ethereum: evm("ethereum", 2, "Ethereum", "Sepolia", "https://sepolia.etherscan.io"),
  base: evm("base", 3, "Base", "Base Sepolia", "https://sepolia.basescan.org"),
  sui: {
    key: "sui",
    id: 4,
    name: "Sui",
    testnet: "testnet",
    curve: "ed25519",
    encoding: "raw",
    addressPlaceholder: "0x… (32 bytes)",
      explorerTx: (h) => `https://suiscan.xyz/testnet/tx/${h}`,
    explorerAddress: (a) => `https://suiscan.xyz/testnet/account/${a}`,
    fakeTx: fake.suiTx,
    isValidAddress: (s) => /^0x[0-9a-fA-F]{64}$/.test(s),
  },
  tempo: evm("tempo", 5, "Tempo", "Moderato", "https://explore.testnet.tempo.xyz"),
};

export const CHAIN_ORDER: ChainKey[] = ["solana", "ethereum", "base", "sui", "tempo"];

export function chainById(id: number): ChainMeta | undefined {
  return CHAIN_ORDER.map((k) => CHAINS[k]).find((c) => c.id === id);
}
