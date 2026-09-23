import { NextResponse, type NextRequest } from "next/server";
import { GATE_COOKIE, gateEnabled, gateToken, sameToken } from "@/lib/gate";

/** Everything sits behind the demo password when `DEMO_PASSWORD` is set. */
export async function proxy(req: NextRequest) {
  if (!gateEnabled()) return NextResponse.next();
  const cookie = req.cookies.get(GATE_COOKIE)?.value ?? "";
  if (cookie && sameToken(cookie, await gateToken())) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "This demo is private. Unlock it first." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = req.nextUrl.pathname === "/" ? "" : `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!unlock|api/unlock|_next/|icon.svg|favicon.ico|robots.txt).*)"],
};
