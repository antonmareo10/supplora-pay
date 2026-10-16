// Streams an agent run to the browser as NDJSON events.

import { acquireRun, encodeLine } from "./http";
import type { AgentEvent } from "./types";

export function agentStream(kind: string, run: (emit: (e: AgentEvent) => void, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal): Response {
  const release = acquireRun(kind);
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
        await run(emit, signal);
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
