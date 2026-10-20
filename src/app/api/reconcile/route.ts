import { handleWrite, HttpError } from "@/lib/http";
import { paypalConfigured } from "@/lib/paypal";
import { reconcileWithPayPal } from "@/lib/reconcile";

export const maxDuration = 120;

export async function POST(request: Request) {
  return handleWrite(request, async () => {
    if (!paypalConfigured()) throw new HttpError("PayPal is not configured: add the sandbox credentials to .env.local.", 503);
    return Response.json({ reconciliation: await reconcileWithPayPal() });
  });
}
