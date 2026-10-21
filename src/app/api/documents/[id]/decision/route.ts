import { RESTAURANT } from "@/data/seed";
import { ACTION_LABEL, isPaidOrSent, withholdableCents } from "@/lib/ap";
import { handleWrite, HttpError, readJson } from "@/lib/http";
import { auditEntry, updateState } from "@/lib/state";
import type { PayAction } from "@/lib/types";

const ACTIONS: PayAction[] = ["pay_full", "pay_partial", "hold"];

export async function POST(request: Request, ctx: RouteContext<"/api/documents/[id]/decision">) {
  return handleWrite(request, async () => {
    const { id } = await ctx.params;
    const body = await readJson<{ action?: string; note?: string }>(request);
    const action = body.action as PayAction;
    if (!ACTIONS.includes(action)) throw new HttpError("Choose pay_full, pay_partial or hold.", 400);
    const note = typeof body.note === "string" ? body.note.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300) : undefined;
    const document = await updateState((s) => {
      const doc = s.documents.find((d) => d.id === id);
      if (!doc) throw new HttpError("Document not found", 404);
      if (!doc.review) throw new HttpError("Review the document first.", 409);
      if (isPaidOrSent(doc)) throw new HttpError("This invoice has already been sent to PayPal or is being paid.", 409);
      // A partial payment only makes sense when there are line-level overcharges to withhold.
      // Without this, overriding a held invoice (duplicate / unknown supplier / changed details)
      // to "pay partial" would withhold nothing and pay it in full.
      if (action === "pay_partial" && withholdableCents(doc) <= 0) {
        throw new HttpError("Nothing to withhold on this invoice — choose pay in full or hold.", 409);
      }
      const recommended = doc.review.recommendation;
      doc.decision = action === recommended ? undefined : { action, by: "owner", at: new Date().toISOString(), note };
      // A plan built on the old decision is no longer valid.
      for (const p of s.plans) {
        if (p.status === "awaiting_approval" && (p.payments.some((x) => x.docId === id) || p.deferred.some((x) => x.docId === id))) {
          p.status = "superseded";
        }
      }
      const number = doc.review.extraction.invoice_number ?? doc.fileName;
      s.audit.push(
        auditEntry({
          actor: "owner",
          message:
            action === recommended
              ? `${RESTAURANT.ownerFirstName} kept the recommendation for ${number}: ${ACTION_LABEL[action]}.`
              : `${RESTAURANT.ownerFirstName} overrode the recommendation for ${number}: ${ACTION_LABEL[recommended]} → ${ACTION_LABEL[action]}${note ? ` (“${note}”)` : ""}.`,
          ref: { docId: id },
        }),
      );
      return doc;
    });
    return Response.json({ document });
  });
}
