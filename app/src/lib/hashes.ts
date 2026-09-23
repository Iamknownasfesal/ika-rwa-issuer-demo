/** Deterministic pseudo-random identifiers so the demo is repeatable. */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bytes(seed: string, n: number): Uint8Array {
  const r = mulberry32(seedFrom(seed));
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(r() * 256);
  return out;
}

export function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function base58(b: Uint8Array): string {
  const digits = [0];
  for (const byte of b) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let s = "";
  for (const byte of b) {
    if (byte !== 0) break;
    s += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) s += B58[digits[i]];
  return s;
}

export const fake = {
  solanaAddress: (seed: string) => base58(bytes(seed, 32)),
  solanaTx: (seed: string) => base58(bytes(seed, 64)),
  evmAddress: (seed: string) => "0x" + hex(bytes(seed, 20)),
  evmTx: (seed: string) => "0x" + hex(bytes(seed, 32)),
  suiAddress: (seed: string) => "0x" + hex(bytes(seed, 32)),
  suiTx: (seed: string) => base58(bytes(seed, 32)),
  digest: (seed: string) => "0x" + hex(bytes(seed, 32)),
  pubkeyHex: (seed: string, n: number) => hex(bytes(seed, n)),
  block: (seed: string) => 4_000_000 + (seedFrom(seed) % 2_000_000),
};
