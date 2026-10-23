// Server-side switch for the Studio Agent Framework on /ledger/studio: which mode the chat runs in,
// and which Claude model answers live turns.

import type { StudioAiConfig } from "@/components/client/ledger-studio/ai/config";
import { claudeConfigured, MODEL } from "./claude";
import { demoMode } from "./session";

/** The model behind live Studio turns: the app's model unless STUDIO_AI_MODEL overrides it. */
export function studioAiModel(): string {
  return process.env.STUDIO_AI_MODEL?.trim() || MODEL;
}

/**
 * Live calls Claude: always when running locally with a key, and on the public demo only when the
 * deployment opts in with STUDIO_AI_LIVE=1 (per-visitor caps apply). The public demo otherwise
 * replays recordings of real runs, like the rest of the app. STUDIO_AI=off hides the chat.
 */
export function studioAiLive(): boolean {
  if (process.env.STUDIO_AI?.trim() === "off" || !claudeConfigured()) return false;
  return !demoMode() || process.env.STUDIO_AI_LIVE?.trim() === "1";
}

export function studioAiConfig(): StudioAiConfig {
  if (process.env.STUDIO_AI?.trim() === "off") return { mode: "off", model: studioAiModel() };
  return { mode: studioAiLive() ? "live" : "replay", model: studioAiModel() };
}
