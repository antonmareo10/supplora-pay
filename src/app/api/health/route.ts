// Liveness for the host's health checks (Render). Touches no state. In the public demo it also
// schedules the payout housekeeping sweep (src/lib/demo-sweep.ts) to run after the response, at
// most once a minute, so unclaimed sandbox payouts go back to the demo account even when no one
// is clicking.
import { after } from "next/server";
import { claudeMode } from "@/lib/claude";
import { sweepStaleDemoPayouts } from "@/lib/payments";
import { paypalConfigured } from "@/lib/paypal";
import { demoMode } from "@/lib/session";

export function GET() {
  if (demoMode()) after(sweepStaleDemoPayouts);
  return Response.json({ ok: true, demo: demoMode(), claude: claudeMode(), paypal: paypalConfigured() }, { headers: { "cache-control": "no-store" } });
}
