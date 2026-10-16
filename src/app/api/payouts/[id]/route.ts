import { errorResponse, HttpError } from "@/lib/http";
import { syncBatch } from "@/lib/payments";

export async function GET(_request: Request, ctx: RouteContext<"/api/payouts/[id]">) {
  try {
    const { id } = await ctx.params;
    if (!/^[A-Z0-9]{6,40}$/.test(id)) throw new HttpError("Payout batch not found.", 404);
    const batch = await syncBatch(id);
    return Response.json({ batch }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
