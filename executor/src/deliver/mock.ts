/**
 * Mock delivery: no destination-chain RPC. Produces a deterministic fake tx
 * hash formatted for the chain so the console can render a plausible link,
 * and logs the signed authorization that a relayer would submit.
 */
import { chainById, keccak256, toBase58, toHex } from '@ika-rwa/ledger-sdk';

export interface Delivery {
  txHash: string;
  txHashBytes: Uint8Array;
  explorer: string;
  note: string;
}

export function mockDeliver(chainId: number, digest: Uint8Array, signature: Uint8Array): Delivery {
  const meta = chainById(chainId);
  const h = keccak256(digest, signature, new TextEncoder().encode('mock-delivery'));
  const txHash = meta.key === 'sui' ? toBase58(h) : `0x${toHex(h)}`;
  return {
    txHash,
    txHashBytes: h,
    explorer: meta.explorerTx(txHash),
    note: `simulated ${meta.name} delivery (signature ${toHex(signature).slice(0, 16)}…)`,
  };
}
