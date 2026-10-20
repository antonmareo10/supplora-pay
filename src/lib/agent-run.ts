// Runs a Claude tool-runner agent live, records it (RECORD_DEMO=1), or replays a recording
// (DEMO_MODE). In a replay Claude is not called: its recorded notes are shown and its recorded
// tool calls are executed against the live tools, so every rule check, validation and PayPal
// sandbox call still happens for real.

import type Anthropic from "@anthropic-ai/sdk";
import type { BetaRunnableTool, BetaToolRunContext } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { BetaToolRunnerParams } from "@anthropic-ai/sdk/lib/tools/BetaToolRunner";
import { fmtDay } from "./dates";
import { saveAgentRecording, type AgentRecording, type RecordedCall, type RecordedTurn } from "./recordings";
import type { AgentEvent } from "./types";

type Emit = (e: AgentEvent) => void;
type RunnerParams = BetaToolRunnerParams & { stream?: false };

export interface Recorder {
  kind: AgentRecording["kind"];
  fingerprint: string;
  meta: Record<string, unknown>;
}

const toolName = (t: BetaRunnableTool) => (t as { name: string }).name;

/** Live run with the Anthropic tool runner. Returns whether the model refused, or the error that stopped it. */
export async function runLive(
  client: Anthropic,
  params: RunnerParams,
  out: Emit,
  signal: AbortSignal | undefined,
  recorder?: Recorder | null,
): Promise<{ refused: boolean; error?: unknown }> {
  const turns: RecordedTurn[] = [];
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, requests: 0 };
  let model = String(params.model);
  const runner = client.beta.messages.toolRunner(params, { signal });
  let result: { refused: boolean; error?: unknown } = { refused: false };
  try {
    for await (const message of runner) {
      const turn: RecordedTurn = { notes: [], calls: [] };
      for (const block of message.content) {
        if (block.type === "text" && block.text.trim()) turn.notes.push(block.text.trim());
        if (block.type === "thinking" && block.thinking.trim()) turn.notes.push(block.thinking.trim());
        if (block.type === "tool_use") turn.calls.push({ id: block.id, tool: block.name, input: block.input as Record<string, unknown> });
      }
      for (const text of turn.notes) out({ type: "note", text });
      turns.push(turn);
      model = message.model;
      usage.requests++;
      usage.input_tokens += message.usage.input_tokens ?? 0;
      usage.output_tokens += message.usage.output_tokens ?? 0;
      usage.cache_read_input_tokens += message.usage.cache_read_input_tokens ?? 0;
      usage.cache_creation_input_tokens += message.usage.cache_creation_input_tokens ?? 0;
      if (message.stop_reason === "refusal") {
        result = { refused: true };
        break;
      }
    }
  } catch (err) {
    result = { refused: false, error: err };
  }
  if (recorder && !result.refused && !result.error) {
    await saveAgentRecording({ kind: recorder.kind, recordedAt: new Date().toISOString(), model, fingerprint: recorder.fingerprint, usage, turns, meta: recorder.meta });
  }
  return result;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Stopped"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new Error("Stopped"))), { once: true });
  });

/** Invoke one of the agent's tools the way the tool runner does. */
export async function callTool(tools: BetaRunnableTool[], call: RecordedCall): Promise<string> {
  const tool = tools.find((t) => toolName(t) === call.tool);
  if (!tool) throw new Error(`The recording calls a tool this agent does not have: ${call.tool}`);
  const input = typeof tool.parse === "function" ? tool.parse(call.input) : call.input;
  const context = { toolUse: { id: call.id, type: "tool_use", name: call.tool, input: call.input } } as unknown as BetaToolRunContext;
  const out = await tool.run(input, context);
  return typeof out === "string" ? out : JSON.stringify(out);
}

/**
 * Replays a recorded run: Claude's notes appear at a readable pace, and each turn's tool calls
 * run live, in parallel as the tool runner would. `rewrite` maps ids that only existed at
 * recording time (e.g. PayPal order ids) to this session's.
 */
export async function replayRun(
  rec: AgentRecording,
  tools: BetaRunnableTool[],
  out: Emit,
  signal?: AbortSignal,
  rewrite?: (call: RecordedCall) => RecordedCall,
): Promise<void> {
  out({
    type: "info",
    tone: "replay",
    text: `Demo replay of a real Claude run (${rec.model}, recorded ${fmtDay(rec.recordedAt.slice(0, 10))}). No model is called here; every tool call below runs live: the money rules in code and the PayPal sandbox API.`,
  });
  for (const turn of rec.turns) {
    for (const text of turn.notes) {
      await sleep(Math.min(1600, 350 + text.length * 4), signal);
      out({ type: "note", text });
    }
    if (!turn.calls.length) continue;
    await sleep(300, signal);
    await Promise.all(turn.calls.map((c) => callTool(tools, rewrite ? rewrite(c) : c)));
  }
}
