import { handleWrite } from "@/lib/http";
import { returnSessionDemoPayouts } from "@/lib/payments";
import { resetState } from "@/lib/state";

export async function POST(request: Request) {
  return handleWrite(request, async () => {
    // Public demo: give this session's unclaimed sandbox payouts back to the demo account first.
    await returnSessionDemoPayouts().catch(() => undefined);
    await resetState();
    return Response.json({ ok: true });
  });
}
