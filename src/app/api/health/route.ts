// Liveness for the host's health checks (Render). Touches no state and no external API.
import { claudeMode } from "@/lib/claude";
import { paypalConfigured } from "@/lib/paypal";
import { demoMode } from "@/lib/session";

export function GET() {
  return Response.json({ ok: true, demo: demoMode(), claude: claudeMode(), paypal: paypalConfigured() }, { headers: { "cache-control": "no-store" } });
}
