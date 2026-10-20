import { claudeAvailable } from "@/lib/claude";
import { draftDispute, markDisputeSent } from "@/lib/disputes";
import { handleWrite, HttpError, readJson } from "@/lib/http";

export const maxDuration = 120;

export async function POST(request: Request, ctx: RouteContext<"/api/disputes/[id]">) {
  return handleWrite(request, async () => {
    const { id } = await ctx.params;
    if (!/^(doc-\d{2}|up_[a-f0-9]{12})$/.test(id)) throw new HttpError("Document not found", 404);
    const body = await readJson<{ action?: string; subject?: unknown; body?: unknown }>(request);
    if (body.action === "draft") {
      if (!claudeAvailable()) throw new HttpError("Claude is not configured: add ANTHROPIC_API_KEY to .env.local.", 503);
      return Response.json({ document: await draftDispute(id) });
    }
    if (body.action === "sent") {
      const subject = typeof body.subject === "string" ? body.subject : undefined;
      const text = typeof body.body === "string" ? body.body : undefined;
      return Response.json({ document: await markDisputeSent(id, { subject, body: text }) });
    }
    throw new HttpError("Unknown action.", 400);
  });
}
