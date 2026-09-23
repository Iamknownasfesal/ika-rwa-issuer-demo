import { activity } from "@/server/devnet";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ index: string }> }) {
  try {
    const { index } = await ctx.params;
    return Response.json(await activity(index));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
