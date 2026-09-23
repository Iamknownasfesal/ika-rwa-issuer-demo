import { NextResponse } from "next/server";
import { GATE_COOKIE, gateToken, sameToken } from "@/lib/gate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const expected = await gateToken();
  if (!process.env.DEMO_PASSWORD || !password || !sameToken(await gateToken(password), expected)) {
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ error: "That password is not right." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
