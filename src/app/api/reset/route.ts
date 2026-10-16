import { handleWrite } from "@/lib/http";
import { resetState } from "@/lib/state";

export async function POST(request: Request) {
  return handleWrite(request, async () => {
    await resetState();
    return Response.json({ ok: true });
  });
}
