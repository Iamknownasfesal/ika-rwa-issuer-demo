import { approve } from "@/server/devnet";
import type { ApproverId } from "@/demoConfig";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ index: string }> }) {
  try {
    const { index } = await ctx.params;
    const { approver } = (await req.json()) as { approver: ApproverId };
    return Response.json(await approve(index, approver));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
