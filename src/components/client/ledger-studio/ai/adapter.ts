// AG Studio LLM adapters for the ledger's agents.
//
//  - claudeAdapter: each turn goes to /api/studio/llm, which calls Claude and streams back AG-UI
//    events (NDJSON) and the final response. It keeps the raw content of every turn (Claude's signed
//    thinking blocks included) and sends it back with later turns, so the server can replay each
//    assistant turn exactly.
//  - replayAdapter: the keyless public demo. A suggested prompt replays a recording of a real Claude
//    run turn by turn, and Studio executes the recorded tool calls against this dashboard.
//
// Neither runs tools: Studio's Direct LLM Runner executes every tool call itself.

import type { AgAiConversationItem, AgAiEvent, AgLlmAdapter, AgLlmRequest, AgLlmResponse } from "ag-studio";
import type { StudioTurnLine } from "@/lib/studio-llm";

/** An async iterable fed as events arrive (Studio may start reading before or after they do). */
class EventQueue implements AsyncIterable<AgAiEvent> {
  private items: AgAiEvent[] = [];
  private waiting: ((r: IteratorResult<AgAiEvent>) => void) | null = null;
  private closed = false;

  push(event: AgAiEvent) {
    if (this.closed) return;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: event, done: false });
    } else this.items.push(event);
  }

  close() {
    this.closed = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<AgAiEvent> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}

function failed(code: string, message: string, status: AgLlmResponse["status"] = "failed"): AgLlmResponse {
  return { id: `failed-${Date.now()}`, createdAt: Date.now(), output: [], status, error: { code, message } };
}

/** The text of the last user message, if nothing (no tool result, no answer) came after it. */
export function pendingPrompt(input: AgAiConversationItem[]): string | null {
  const last = input.at(-1);
  if (!last || last.type !== "message" || last.kind !== "input" || last.role !== "user") return null;
  return last.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join(" ")
    .trim();
}

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------------------------
// Live

export interface RecordedTurn {
  events: AgAiEvent[];
  response: AgLlmResponse;
}

export interface RecordedRun {
  label: string;
  prompt: string;
  turns: RecordedTurn[];
}

/** Collects live turns per suggested prompt, to be saved as replays (local recording only). */
export class RunRecorder {
  readonly runs: RecordedRun[] = [];
  private current: RecordedRun | null = null;

  constructor(private readonly starters: { label: string; prompt: string }[]) {}

  turn(request: AgLlmRequest, events: AgAiEvent[], response: AgLlmResponse) {
    const prompt = pendingPrompt(request.input);
    const starter = prompt ? this.starters.find((s) => normalize(s.prompt) === normalize(prompt)) : undefined;
    if (starter) {
      this.current = { label: starter.label, prompt: starter.prompt, turns: [] };
      this.runs.push(this.current);
    }
    this.current?.turns.push({ events, response });
  }
}

const rawCache = new Map<string, unknown[]>();

function rawFor(input: AgAiConversationItem[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const item of input) {
    const id = "id" in item ? item.id : undefined;
    const at = id ? id.lastIndexOf("#") : -1;
    if (!id || at <= 0) continue;
    const responseId = id.slice(0, at);
    const raw = rawCache.get(responseId);
    if (raw) out[responseId] = raw;
  }
  return out;
}

export function claudeAdapter({ endpoint, recorder }: { endpoint: string; recorder?: RunRecorder }): AgLlmAdapter {
  return {
    executeTurn(request, options) {
      const queue = new EventQueue();
      let settle!: (r: AgLlmResponse) => void;
      const complete = new Promise<AgLlmResponse>((resolve) => (settle = resolve));

      (async () => {
        const events: AgAiEvent[] = [];
        let final: AgLlmResponse | null = null;
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...request, raw: rawFor(request.input) }),
            signal: options?.signal,
          });
          if (!res.ok || !res.body) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            final = failed(String(res.status), body.error ?? `Request failed (${res.status})`);
          } else {
            const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
            let buffer = "";
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += value;
              let nl: number;
              while ((nl = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if (!line) continue;
                const msg = JSON.parse(line) as StudioTurnLine;
                if (msg.type === "event") {
                  events.push(msg.event);
                  queue.push(msg.event);
                } else {
                  final = msg.response;
                  if (msg.raw) rawCache.set(msg.raw.id, msg.raw.content);
                }
              }
            }
          }
        } catch {
          final = options?.signal?.aborted ? failed("cancelled", "Stopped.", "cancelled") : failed("network", "Could not reach the server. Is the app still running?");
        }
        final ??= failed("incomplete", "The connection closed before Claude finished.");
        recorder?.turn(request, events, final);
        queue.close();
        settle(final);
      })();

      return { stream: queue, complete };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Replay

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

function textTurn(text: string): RecordedTurn {
  const id = `replay-note-${Date.now()}`;
  const messageId = `${id}#0`;
  return {
    events: [
      { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId, delta: text },
      { type: "TEXT_MESSAGE_END", messageId },
    ],
    response: {
      id,
      createdAt: Date.now(),
      status: "completed",
      output: [{ id: messageId, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] }],
    },
  };
}

export const REPLAY_ONLY_NOTE =
  "This public demo has no API key: the suggested prompts replay recordings of real Claude runs, and Studio carries out the recorded steps on your dashboard. Pick one of them, or run the app with an Anthropic key to ask anything.";

export function replayAdapter(runs: RecordedRun[]): AgLlmAdapter {
  let active: { run: RecordedRun; next: number } | null = null;
  return {
    executeTurn(request, options) {
      const prompt = pendingPrompt(request.input);
      const started = prompt ? runs.find((r) => normalize(r.prompt) === normalize(prompt)) : undefined;
      if (started) active = { run: started, next: 0 };
      else if (prompt && !active) active = null;
      const recorded = active?.run.turns[active.next];
      const turn = recorded ?? textTurn(REPLAY_ONLY_NOTE);
      if (recorded && active) active.next++;
      else active = null;

      const queue = new EventQueue();
      const complete = (async () => {
        // A short pause per turn, so the steps can be followed as they come in.
        await sleep(320, options?.signal);
        for (const event of turn.events) {
          if (options?.signal?.aborted) break;
          queue.push(event);
          // Text streams at reading pace; tool calls arrive almost at once.
          await sleep(event.type === "TEXT_MESSAGE_CONTENT" ? 18 : 4, options?.signal);
        }
        queue.close();
        return options?.signal?.aborted ? failed("cancelled", "Stopped.", "cancelled") : { ...turn.response, createdAt: Date.now() };
      })();
      return { stream: queue, complete };
    },
  };
}
