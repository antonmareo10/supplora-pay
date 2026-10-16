import { eurosToCents, handleWrite, readJson } from "@/lib/http";
import { fmt } from "@/lib/money";
import { auditEntry, updateState } from "@/lib/state";

export async function POST(request: Request) {
  return handleWrite(request, async () => {
    const body = await readJson<{ cashCapEur?: unknown; restockLimitEur?: unknown }>(request);
    const cap = body.cashCapEur !== undefined ? eurosToCents(body.cashCapEur, { min: 1, max: 100_000 }) : undefined;
    const limit = body.restockLimitEur !== undefined ? eurosToCents(body.restockLimitEur, { min: 5, max: 5_000 }) : undefined;
    const settings = await updateState((s) => {
      if (cap !== undefined && cap !== s.settings.cashCapCents) {
        s.settings.cashCapCents = cap;
        s.audit.push(auditEntry({ actor: "owner", message: `Cash cap for the payment run set to ${fmt(cap)}.`, amountCents: cap }));
      }
      if (limit !== undefined && limit !== s.settings.restockLimitCents) {
        s.settings.restockLimitCents = limit;
        s.audit.push(auditEntry({ actor: "owner", message: `Restock spending limit set to ${fmt(limit)}.`, amountCents: limit }));
      }
      return s.settings;
    });
    return Response.json({ settings });
  });
}
