import { after } from "next/server";
import { handleWrite } from "@/lib/http";
import { returnSessionDemoPayouts } from "@/lib/payments";
import { currentStateKey, demoMode } from "@/lib/session";
import { resetState } from "@/lib/state";

export async function POST(request: Request) {
  return handleWrite(request, async () => {
    const key = await currentStateKey();
    await resetState();
    // Public demo: give this session's unclaimed sandbox payouts back to the demo account, after responding.
    const resetAt = Date.now();
    if (demoMode()) after(() => returnSessionDemoPayouts(key, resetAt));
    return Response.json({ ok: true });
  });
}
