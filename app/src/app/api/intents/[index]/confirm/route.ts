import { deployment, indexOf } from "@/server/devnet";

export const dynamic = "force-dynamic";

/**
 * Manual confirmation hook. The executor confirms legs itself after delivery;
 * this route exists for operators who deliver the signed authorization out of band.
 */
export async function POST(req: Request, ctx: { params: Promise<{ index: string }> }) {
  try {
    const { index } = await ctx.params;
    const { leg, txHash } = (await req.json()) as { leg: number; txHash: string };
    const d = await deployment();
    return Response.json({ error: "Out-of-band confirmation is not wired in this build; run the executor CLI: pnpm executor confirm", programId: d.programId, intent: indexOf(index), leg, txHash }, { status: 501 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
