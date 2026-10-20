// Streams an agent run to the browser as NDJSON events.

import { acquireRun, encodeLine } from "./http";
import { currentStateKey, runWithStateKey } from "./session";
import type { AgentEvent } from "./types";

export async function agentStream(
  kind: string,
  run: (emit: (e: AgentEvent) => void, signal: AbortSignal) => Promise<unknown>,
  signal: AbortSignal,
): Promise<Response> {
  // The run keeps working after this handler returns its streaming Response: pin the visitor's
  // state key so every read and write inside it hits the same session.
  const key = await currentStateKey();
  const release = acquireRun(`${key}:${kind}`);
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encodeLine(e));
        } catch {
          closed = true;
        }
      };
      try {
        await runWithStateKey(key, () => run(emit, signal));
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : "Unexpected error" });
      } finally {
        emit({ type: "done", elapsedMs: Date.now() - started });
        closed = true;
        release();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      release();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
