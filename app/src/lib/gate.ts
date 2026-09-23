/**
 * Shared-password gate for the hosted demo. Off unless `DEMO_PASSWORD` is set.
 * The cookie holds a hash of the password, so rotating the password signs everyone out.
 */
export const GATE_COOKIE = "ledger_gate";

export function gateEnabled(): boolean {
  return !!process.env.DEMO_PASSWORD;
}

export async function gateToken(password = process.env.DEMO_PASSWORD ?? ""): Promise<string> {
  const data = new TextEncoder().encode(`ika-ledger-demo:${password}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Length-independent comparison of two hex strings. */
export function sameToken(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
