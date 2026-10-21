import { handlePayPalWebhook, MAX_WEBHOOK_BYTES } from "@/lib/webhooks";

export const maxDuration = 30;

// PayPal → Supplora Pay (server to server, so no same-origin check): verified, deduplicated
// webhook events update payout items, authorizations and captures. See src/lib/webhooks.ts.
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_WEBHOOK_BYTES) return Response.json({ error: "Webhook body too large." }, { status: 413 });
  const raw = await request.text();
  const { status, body } = await handlePayPalWebhook(raw, request.headers);
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
