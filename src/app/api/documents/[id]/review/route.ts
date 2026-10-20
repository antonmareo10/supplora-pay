import { claudeAvailable } from "@/lib/claude";
import { handleWrite, HttpError } from "@/lib/http";
import { reviewDocument } from "@/lib/review";

export const maxDuration = 300;

const g = globalThis as typeof globalThis & { __supploraReviews?: { active: number } };
const reviews = (g.__supploraReviews ??= { active: 0 });

export async function POST(request: Request, ctx: RouteContext<"/api/documents/[id]/review">) {
  return handleWrite(request, async () => {
    const { id } = await ctx.params;
    if (!/^(doc-\d{2}|up_[a-f0-9]{12})$/.test(id)) throw new HttpError("Document not found", 404);
    if (!claudeAvailable()) throw new HttpError("Claude is not configured: add ANTHROPIC_API_KEY to .env.local.", 503);
    if (reviews.active >= 3) throw new HttpError("Three documents are already being reviewed. Try again in a moment.", 429);
    reviews.active++;
    try {
      const document = await reviewDocument(id);
      return Response.json({ document });
    } finally {
      reviews.active--;
    }
  });
}
