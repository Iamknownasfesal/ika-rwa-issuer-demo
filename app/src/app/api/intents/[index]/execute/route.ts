import { execute } from "@/server/devnet";

export const dynamic = "force-dynamic";
// Ika signing plus delivery on the destination chain can take a couple of minutes per intent.
export const maxDuration = 300;

/** Streams NDJSON step events, ending with `{"done":true,"intent":…}`. */
export async function POST(_req: Request, ctx: { params: Promise<{ index: string }> }) {
  const { index } = await ctx.params;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of execute(index)) controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
      } catch (e) {
        controller.enqueue(enc.encode(JSON.stringify({ error: (e as Error).message }) + "\n"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
