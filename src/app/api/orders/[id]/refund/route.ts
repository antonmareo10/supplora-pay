import { handleWrite, HttpError } from "@/lib/http";
import { paypalConfigured } from "@/lib/paypal";
import { refundDamagedItem } from "@/lib/restock";

export const maxDuration = 60;

// After the capture, the kitchen reports damaged goods: refund them on the capture (PayPal Payments v2).
// In the public demo the damage report is scripted (and labelled); amounts are computed in code.
export async function POST(request: Request, ctx: RouteContext<"/api/orders/[id]/refund">) {
  return handleWrite(request, async () => {
    const { id } = await ctx.params;
    if (!/^[A-Z0-9]{10,30}$/.test(id)) throw new HttpError("Order not found.", 404);
    if (!paypalConfigured()) throw new HttpError("PayPal is not configured: add the sandbox credentials to .env.local.", 503);
    const order = await refundDamagedItem(id);
    return Response.json({ order });
  });
}
