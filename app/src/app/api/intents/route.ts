import { createIntent } from "@/server/devnet";
import type { ApproverId } from "@/demoConfig";
import type { IntentDraft } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { draft, approver } = (await req.json()) as { draft: IntentDraft; approver: ApproverId };
    return Response.json(await createIntent(draft, approver));
  } catch (e) {
    return Response.json({ error: (e as Error).message, results: [] }, { status: 400 });
  }
}
