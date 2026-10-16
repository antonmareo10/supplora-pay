// Shared Anthropic client and error mapping (server only).

import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.SUPPLORA_MODEL || "claude-opus-5-5";

const g = globalThis as typeof globalThis & { __supploraAnthropic?: Anthropic };

export function claudeConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function anthropic(): Anthropic {
  if (!claudeConfigured()) throw new Error("Claude is not configured: set ANTHROPIC_API_KEY in .env.local.");
  return (g.__supploraAnthropic ??= new Anthropic({ maxRetries: 2, timeout: 180_000 }));
}

/** Owner-readable message for an Anthropic SDK error. */
export function claudeErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Claude rejected the API key. Check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate-limiting this account. Wait a minute and try again.";
  if (err instanceof Anthropic.BadRequestError) return `Claude could not process this request: ${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return "Claude is temporarily unavailable (server error). Try again shortly.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Claude API (network).";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ""}: ${err.message}`;
  return err instanceof Error ? err.message : "Unexpected error";
}

export function usageLabel(usage: { input_tokens?: number | null; output_tokens?: number | null } | undefined): string {
  if (!usage) return "";
  return `${(usage.input_tokens ?? 0).toLocaleString("en")} in / ${(usage.output_tokens ?? 0).toLocaleString("en")} out tokens`;
}
