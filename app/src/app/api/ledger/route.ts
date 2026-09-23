import { getLedger } from "@/server/devnet";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getLedger());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
