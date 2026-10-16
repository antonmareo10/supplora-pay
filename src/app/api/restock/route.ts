import { agentStream } from "@/lib/agent-stream";
import { claudeConfigured } from "@/lib/claude";
import { assertSameOrigin, errorResponse, eurosToCents, HttpError, readJson } from "@/lib/http";
import { fmt } from "@/lib/money";
import { paypalConfigured } from "@/lib/paypal";
import { runRestockAgent } from "@/lib/restock";
import { auditEntry, updateState } from "@/lib/state";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!claudeConfigured()) throw new HttpError("Claude is not configured: add ANTHROPIC_API_KEY to .env.local.", 503);
    if (!paypalConfigured()) throw new HttpError("PayPal is not configured: add the sandbox credentials to .env.local.", 503);
    const body = await readJson<{ limitEur?: unknown }>(request);
    if (body.limitEur !== undefined) {
      const cents = eurosToCents(body.limitEur, { min: 5, max: 5_000 });
      await updateState((s) => {
        if (s.settings.restockLimitCents !== cents) {
          s.audit.push(auditEntry({ actor: "owner", message: `Restock spending limit set to ${fmt(cents)}.`, amountCents: cents }));
          s.settings.restockLimitCents = cents;
        }
      });
    }
    return agentStream("restock", (emit, signal) => runRestockAgent(emit, signal), request.signal);
  } catch (err) {
    return errorResponse(err);
  }
}
