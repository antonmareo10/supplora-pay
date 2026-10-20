import { agentStream } from "@/lib/agent-stream";
import { claudeAvailable } from "@/lib/claude";
import { assertSameOrigin, errorResponse, eurosToCents, HttpError, readJson } from "@/lib/http";
import { fmt } from "@/lib/money";
import { runPaymentPlanner } from "@/lib/planner";
import { auditEntry, updateState } from "@/lib/state";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!claudeAvailable()) throw new HttpError("Claude is not configured: add ANTHROPIC_API_KEY to .env.local.", 503);
    const body = await readJson<{ cashCapEur?: unknown }>(request);
    if (body.cashCapEur !== undefined) {
      const cents = eurosToCents(body.cashCapEur, { min: 1, max: 100_000 });
      await updateState((s) => {
        if (s.settings.cashCapCents !== cents) {
          s.audit.push(auditEntry({ actor: "owner", message: `Cash cap for the payment run set to ${fmt(cents)}.`, amountCents: cents }));
          s.settings.cashCapCents = cents;
        }
      });
    }
    return await agentStream("payment-run", (emit, signal) => runPaymentPlanner(emit, signal), request.signal);
  } catch (err) {
    return errorResponse(err);
  }
}
