import { claudeAvailable } from "@/lib/claude";
import { handleWrite, HttpError } from "@/lib/http";
import { reviewDocument } from "@/lib/review";
import { currentStateKey } from "@/lib/session";

export const maxDuration = 300;

// At most three reviews at a time per session (per visitor in the public demo).
const g = globalThis as typeof globalThis & { __supploraReviewsBySession?: Map<string, number> };
const active = (g.__supploraReviewsBySession ??= new Map());

export async function POST(request: Request, ctx: RouteContext<"/api/documents/[id]/review">) {
  return handleWrite(request, async () => {
    const { id } = await ctx.params;
    if (!/^(doc-\d{2}|up_[a-f0-9]{12})$/.test(id)) throw new HttpError("Document not found", 404);
    if (!claudeAvailable()) throw new HttpError("Claude is not configured: add ANTHROPIC_API_KEY to .env.local.", 503);
    const key = await currentStateKey();
    if ((active.get(key) ?? 0) >= 3) throw new HttpError("Three documents are already being reviewed. Try again in a moment.", 429);
    active.set(key, (active.get(key) ?? 0) + 1);
    try {
      const document = await reviewDocument(id);
      return Response.json({ document });
    } finally {
      const left = (active.get(key) ?? 1) - 1;
      if (left > 0) active.set(key, left);
      else active.delete(key);
    }
  });
}
