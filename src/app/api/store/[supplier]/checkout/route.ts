import { handleWrite, HttpError, readJson } from "@/lib/http";
import { paypalConfigured } from "@/lib/paypal";
import { ownerCheckout } from "@/lib/restock";

export const maxDuration = 120;

export async function POST(request: Request, ctx: RouteContext<"/api/store/[supplier]/checkout">) {
  return handleWrite(request, async () => {
    const { supplier } = await ctx.params;
    if (!paypalConfigured()) throw new HttpError("PayPal is not configured: add the sandbox credentials to .env.local.", 503);
    const body = await readJson<{ items?: unknown }>(request);
    const items = body.items;
    const valid =
      Array.isArray(items) &&
      items.every((i) => i && typeof i === "object" && typeof (i as { sku?: unknown }).sku === "string" && typeof (i as { qty?: unknown }).qty === "number");
    if (!valid) throw new HttpError("Send items as [{ sku, qty }].", 400);
    const order = await ownerCheckout(supplier, items as { sku: string; qty: number }[]);
    return Response.json({ order }, { status: 201 });
  });
}
