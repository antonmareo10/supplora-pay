import { handleWrite, HttpError, readJson } from "@/lib/http";
import { paypalConfigured } from "@/lib/paypal";
import { settleDelivery } from "@/lib/restock";

export const maxDuration = 60;

// The signed delivery note for an authorized restock order is in: capture what it confirms (one
// final capture), or void the authorization when nothing arrived. Amounts are computed in code.
export async function POST(request: Request, ctx: RouteContext<"/api/orders/[id]/delivery">) {
  return handleWrite(request, async () => {
    const { id } = await ctx.params;
    if (!/^[A-Z0-9]{10,30}$/.test(id)) throw new HttpError("Order not found.", 404);
    if (!paypalConfigured()) throw new HttpError("PayPal is not configured: add the sandbox credentials to .env.local.", 503);
    const body = await readJson<{ outcome?: unknown }>(request);
    if (body.outcome !== "scripted" && body.outcome !== "nothing") throw new HttpError('Send { "outcome": "scripted" } or { "outcome": "nothing" }.', 400);
    const order = await settleDelivery(id, body.outcome);
    return Response.json({ order });
  });
}
