import { handleWrite, HttpError, readJson } from "@/lib/http";
import { approveProposal, declineProposal } from "@/lib/restock";

export const maxDuration = 120;

export async function POST(request: Request, ctx: RouteContext<"/api/restock/[id]">) {
  return handleWrite(request, async () => {
    const { id } = await ctx.params;
    if (!/^rst_[a-f0-9]{12}$/.test(id)) throw new HttpError("Restock proposal not found.", 404);
    const body = await readJson<{ action?: string }>(request);
    if (body.action === "approve") await approveProposal(id);
    else if (body.action === "decline") await declineProposal(id);
    else throw new HttpError("Unknown action.", 400);
    return Response.json({ ok: true });
  });
}
