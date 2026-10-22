// Small helpers for route handlers: mapping domain errors to HTTP responses, the write wrapper
// (same-origin check + error mapping), NDJSON lines and the one-run-per-kind lock. The request
// guards themselves live in http-guards.ts (pure, unit-tested) and are re-exported here.

import { HttpError, assertSameOrigin } from "./http-guards";
import { PayPalError } from "./paypal";

export { assertSameOrigin, eurosToCents, HttpError, readJson } from "./http-guards";

export function errorResponse(err: unknown): Response {
  if (err instanceof PayPalError) {
    return Response.json({ error: err.message, paypalIssue: err.issue, paypalDebugId: err.debugId }, { status: 502 });
  }
  const status = (err as { status?: unknown })?.status;
  if (err instanceof Error && typeof status === "number" && status >= 400 && status < 600) {
    return Response.json({ error: err.message }, { status });
  }
  console.error("[api] unexpected error:", err);
  return Response.json({ error: err instanceof Error ? err.message : "Unexpected error" }, { status: 500 });
}

/** Wrap a write handler with the same-origin check and error mapping. */
export async function handleWrite(request: Request, fn: () => Promise<Response>): Promise<Response> {
  try {
    assertSameOrigin(request);
    return await fn();
  } catch (err) {
    return errorResponse(err);
  }
}

const encoder = new TextEncoder();
export function encodeLine(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value) + "\n");
}

/** One agent run at a time per kind (protects API credit and keeps state simple). */
const g = globalThis as typeof globalThis & { __supploraRuns?: Set<string> };
const running = (g.__supploraRuns ??= new Set<string>());
export function acquireRun(kind: string): () => void {
  if (running.has(kind)) throw new HttpError("The agent is already working on this. Wait for it to finish.", 429);
  running.add(kind);
  return () => running.delete(kind);
}
