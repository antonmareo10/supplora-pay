import { after } from "next/server";
import { handleWrite, HttpError, readJson } from "@/lib/http";
import { approvePayments, sweepStaleDemoPayouts } from "@/lib/payments";
import { paypalConfigured } from "@/lib/paypal";

export const maxDuration = 60;

export async function POST(request: Request, ctx: RouteContext<"/api/plans/[id]/approve">) {
  return handleWrite(request, async () => {
    const { id } = await ctx.params;
    if (!/^plan_[a-f0-9]{12}$/.test(id)) throw new HttpError("Payment plan not found.", 404);
    if (!paypalConfigured()) throw new HttpError("PayPal is not configured: add the sandbox credentials to .env.local.", 503);
    const body = await readJson<{ docIds?: unknown }>(request);
    const docIds = body.docIds;
    if (!Array.isArray(docIds) || !docIds.every((d) => typeof d === "string" && /^(doc-\d{2}|up_[a-f0-9]{12})$/.test(d))) {
      throw new HttpError("Select the payments to approve.", 400);
    }
    const batch = await approvePayments(id, docIds as string[]);
    // Public demo: return stale unclaimed payouts (any session) after responding.
    after(sweepStaleDemoPayouts);
    return Response.json({ batch });
  });
}
