/** Formatting helpers shared by the console and the executor. */
import bs58 from 'bs58';
import { chainById } from './chains.js';

export function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}
export function fromHex(h: string): Uint8Array {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  if (s.length % 2) throw new Error('odd hex length');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export const toBase58 = (b: Uint8Array): string => bs58.encode(b);
export const fromBase58 = (s: string): Uint8Array => bs58.decode(s);

/** Format base units with `decimals` (grouped, trims trailing zeros). */
export function formatAmount(amount: bigint, decimals: number, opts: { maxFraction?: number } = {}): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, '0');
  const maxFraction = opts.maxFraction ?? 2;
  frac = frac.slice(0, maxFraction).replace(/0+$/, '');
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${w}${frac ? '.' + frac : ''}`;
}

/** Parse a human amount ("2,500,000.5") into base units. */
export function parseAmount(text: string, decimals: number): bigint {
  const clean = text.replace(/[,\s_]/g, '');
  if (!/^\d*(\.\d*)?$/.test(clean) || clean === '' || clean === '.') throw new Error(`invalid amount: ${text}`);
  const [w, f = ''] = clean.split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt(frac || '0');
}

/** Render a chain-native address from raw bytes. */
export function formatChainAddress(chainId: number, bytes: Uint8Array): string {
  const meta = chainById(chainId);
  if (bytes.length === 0) return '';
  switch (meta.addressBytes) {
    case 20:
      return `0x${toHex(bytes)}`;
    case 32:
      return meta.key === 'solana' ? toBase58(bytes) : `0x${toHex(bytes)}`;
  }
}

/** Parse a chain-native address string into the bytes stored on-chain. */
export function parseChainAddress(chainId: number, text: string): Uint8Array {
  const meta = chainById(chainId);
  const t = text.trim();
  switch (meta.addressBytes) {
    case 20: {
      const b = fromHex(t);
      if (b.length !== 20) throw new Error('EVM address must be 20 bytes');
      return b;
    }
    case 32: {
      const b = meta.key === 'solana' ? fromBase58(t) : fromHex(t);
      if (b.length !== 32) throw new Error('address must be 32 bytes');
      return b;
    }
  }
}

/** Render a destination tx hash for a chain. */
export function formatTxHash(chainId: number, bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const meta = chainById(chainId);
  if (meta.key === 'solana') return toBase58(bytes);
  if (meta.key === 'sui') return toBase58(bytes);
  return `0x${toHex(bytes)}`;
}

export function shortAddress(s: string, head = 6, tail = 4): string {
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export function bytesToUtf8(b: Uint8Array): string {
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  return new TextDecoder().decode(b.slice(0, end));
}
export function utf8Padded(s: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  const enc = new TextEncoder().encode(s);
  if (enc.length > len) throw new Error(`string longer than ${len} bytes`);
  out.set(enc);
  return out;
}
