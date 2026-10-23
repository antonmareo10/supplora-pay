// Translation between AG Studio's agent turns and the Claude Messages API, for /api/studio/llm.
//
// Studio's Direct LLM Runner hands its adapter one turn at a time: the conversation so far (user
// messages, assistant messages, tool calls and their results), the agent's instructions and the
// tools it may call. This module turns that into a Messages API request, and turns Claude's stream
// back into the AG-UI events and the final response Studio expects. The adapter never runs tools:
// Studio executes every tool call itself, in the browser, against the dashboard.
//
// Thinking blocks: Claude's adaptive thinking returns signed thinking blocks that must go back
// unchanged with the turn that produced them. Studio's history has no place for them, so each final
// response also carries the turn's raw content blocks; the browser keeps them by response id and
// sends them back, and the matching assistant turn is rebuilt from them exactly.
//
// Pure (types only from the SDKs), so it is unit-tested with Node's test runner.

import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AgAiConversationItem, AgAiEvent, AgAiOutputItem, AgAiToolCall, AgLlmRequest, AgLlmResponse } from "ag-studio";

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type Tool = Anthropic.Beta.Messages.BetaTool;
type ToolChoice = Anthropic.Beta.Messages.BetaToolChoice;
type StreamEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent;
type Message = Anthropic.Beta.Messages.BetaMessage;
export type StudioCreateParams = BetaMessageStreamParams;

/** What the browser posts: Studio's request plus the raw content of earlier turns, by response id. */
export interface StudioTurnRequest extends AgLlmRequest {
  raw?: Record<string, unknown[]>;
}

/** One NDJSON line of /api/studio/llm. */
export type StudioTurnLine = { type: "event"; event: AgAiEvent } | { type: "final"; response: AgLlmResponse; raw?: { id: string; content: unknown[] } };

export interface StudioModelOptions {
  model: string;
  maxTokens: number;
  effort: "low" | "medium" | "high";
}

/** Output item ids are `<response id>#<block index>`, so a turn's items can be found again in the history. */
export function itemId(responseId: string, index: number): string {
  return `${responseId}#${index}`;
}

export function responseIdOf(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const at = id.lastIndexOf("#");
  return at > 0 ? id.slice(0, at) : undefined;
}

// Models that accept server-side fallback (fallbacks: "default"); Haiku has none.
const FALLBACK_MODELS = /^claude-(opus-5|opus-5-5|fable-5|fable-5-1|sonnet-5-5)$/;

export function supportsFallback(model: string): boolean {
  return FALLBACK_MODELS.test(model);
}

function inputText(item: Extract<AgAiConversationItem, { type: "message"; kind: "input" }>): string {
  return item.content
    .map((c) => (c.type === "text" ? c.text : c.type === "image" ? "[image omitted]" : `[file omitted${c.filename ? `: ${c.filename}` : ""}]`))
    .join("\n")
    .trim();
}

function parseArgs(args: string): Record<string, unknown> {
  try {
    const v = JSON.parse(args || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return {};
  }
}

function isOutputItem(item: AgAiConversationItem): item is AgAiOutputItem {
  return (item.type === "message" && item.kind === "output") || item.type === "function_call" || item.type === "reasoning";
}

/** Rebuild an assistant turn from Studio's items (used when the raw blocks are not available). */
function blocksFromItems(items: AgAiOutputItem[], wrapped: ReadonlySet<string>): ContentBlockParam[] {
  const blocks: ContentBlockParam[] = [];
  for (const item of items) {
    if (item.type === "message") {
      const text = item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("");
      if (text.trim()) blocks.push({ type: "text", text });
    } else if (item.type === "function_call") {
      const args = parseArgs(item.arguments);
      blocks.push({ type: "tool_use", id: item.callId, name: item.name, input: wrapped.has(item.name) ? { args } : args });
    }
    // Reasoning items are not sent back: without their signature they would be rejected.
  }
  return blocks;
}

/** The raw blocks are used only if they hold exactly the tool calls Studio kept for that turn. */
function rawMatches(raw: unknown[], items: AgAiOutputItem[]): boolean {
  const rawCalls = raw
    .filter((b): b is { type: "tool_use"; id: string } => !!b && typeof b === "object" && (b as { type?: unknown }).type === "tool_use")
    .map((b) => b.id);
  const calls = items.filter((i): i is AgAiToolCall => i.type === "function_call").map((i) => i.callId);
  return rawCalls.length === calls.length && rawCalls.every((id, i) => id === calls[i]);
}

/**
 * Studio's conversation as Messages API turns. Consecutive items of one role become one message;
 * every tool call gets a result in the next user turn (Studio reports a cancelled call as nothing,
 * which the API would reject), and the conversation always starts with a user turn.
 */
export function toMessages(req: StudioTurnRequest, wrapped: ReadonlySet<string> = new Set()): { system: string[]; messages: MessageParam[] } {
  const system: string[] = [];
  const messages: MessageParam[] = [];
  const push = (role: "user" | "assistant", blocks: ContentBlockParam[]) => {
    if (blocks.length === 0) return;
    const last = messages.at(-1);
    if (last && last.role === role && Array.isArray(last.content)) last.content.push(...blocks);
    else messages.push({ role, content: [...blocks] });
  };

  const items = req.input ?? [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (item.type === "message" && item.kind === "input") {
      const text = inputText(item);
      if (item.role === "system") {
        if (text) system.push(text);
      } else if (text) push("user", [{ type: "text", text }]);
      i++;
    } else if (item.type === "function_call_output") {
      const results: ContentBlockParam[] = [];
      while (i < items.length && items[i].type === "function_call_output") {
        const out = items[i] as Extract<AgAiConversationItem, { type: "function_call_output" }>;
        results.push({ type: "tool_result", tool_use_id: out.callId, content: out.output || "(no output)" });
        i++;
      }
      push("user", results);
    } else if (isOutputItem(item)) {
      const turn = responseIdOf(item.id);
      const group: AgAiOutputItem[] = [];
      while (i < items.length && isOutputItem(items[i]) && responseIdOf((items[i] as AgAiOutputItem).id) === turn) {
        group.push(items[i] as AgAiOutputItem);
        i++;
      }
      const raw = turn ? req.raw?.[turn] : undefined;
      push("assistant", raw && rawMatches(raw, group) ? (raw as ContentBlockParam[]) : blocksFromItems(group, wrapped));
    } else {
      i++;
    }
  }

  // Every tool_use must be answered in the next user turn.
  for (let m = 0; m < messages.length; m++) {
    const msg = messages[m];
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    const ids = msg.content.filter((b) => b.type === "tool_use").map((b) => (b as { id: string }).id);
    if (ids.length === 0) continue;
    const next = messages[m + 1];
    const answered = new Set(
      next && next.role === "user" && Array.isArray(next.content)
        ? next.content.filter((b) => b.type === "tool_result").map((b) => (b as { tool_use_id: string }).tool_use_id)
        : [],
    );
    const missing = ids.filter((id) => !answered.has(id));
    if (missing.length === 0) continue;
    const filler: ContentBlockParam[] = missing.map((id) => ({ type: "tool_result", tool_use_id: id, content: "This tool call was not run.", is_error: true }));
    if (next && next.role === "user" && Array.isArray(next.content)) next.content.unshift(...filler);
    else messages.splice(m + 1, 0, { role: "user", content: filler });
  }

  if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: [{ type: "text", text: "(The conversation continues.)" }] });
  // Studio sometimes asks for another turn right after an answer; the API takes no assistant prefill.
  if (messages.at(-1)?.role === "assistant") messages.push({ role: "user", content: [{ type: "text", text: "Continue." }] });
  return { system, messages };
}

/**
 * Tool input schemas must have an object at the root. Studio's own tools do; anything else (a
 * union, for instance) is nested under an "args" property, with its $defs hoisted so references
 * still resolve, and unwrapped again before Studio sees the call.
 */
export function toolSchema(schema: unknown): { schema: Tool["input_schema"]; wrapped: boolean } {
  if (schema && typeof schema === "object" && (schema as { type?: unknown }).type === "object") return { schema: schema as Tool["input_schema"], wrapped: false };
  if (!schema || typeof schema !== "object" || Object.keys(schema).length === 0) return { schema: { type: "object", properties: {} }, wrapped: false };
  const { $defs, definitions, $schema, ...inner } = schema as Record<string, unknown>;
  void $schema;
  return {
    schema: { type: "object", properties: { args: inner }, required: ["args"], ...($defs ? { $defs } : {}), ...(definitions ? { definitions } : {}) } as Tool["input_schema"],
    wrapped: true,
  };
}

/** The Messages API request for one Studio turn, and which tools had their schema wrapped. */
export function toAnthropicParams(req: StudioTurnRequest, opts: StudioModelOptions): { params: StudioCreateParams; wrapped: Set<string> } {
  const wrapped = new Set<string>();
  const tools: Tool[] = (req.tools ?? [])
    .filter((t) => t.kind !== "provided")
    .map((t) => {
      const { schema, wrapped: isWrapped } = toolSchema(t.parameters);
      if (isWrapped) wrapped.add(t.name);
      return { name: t.name, description: t.description, input_schema: schema, eager_input_streaming: true };
    });

  const { system, messages } = toMessages(req, wrapped);
  const parts = [req.instructions?.trim(), ...system].filter((s): s is string => !!s);

  // Forced tool use is rejected by Claude Opus 5.5, so "required" and a named tool become an
  // instruction with tool_choice auto; Studio's loop asks again if no call comes back.
  let toolChoice: ToolChoice | undefined;
  const choice = req.toolChoice;
  if (tools.length > 0) {
    if (choice === "none") toolChoice = { type: "none" };
    else {
      toolChoice = { type: "auto" };
      if (choice === "required") parts.push("In this turn, call one of your tools.");
      else if (choice && typeof choice === "object") parts.push(`In this turn, call the ${choice.name} tool.`);
    }
  }

  if (req.responseFormat?.type === "json") {
    parts.push(
      `Reply with a single JSON object and nothing else (no prose, no code fences). It must match this JSON Schema (${req.responseFormat.name}):\n` +
        JSON.stringify(req.responseFormat.schema),
    );
  }

  const fallback = supportsFallback(opts.model);
  const params: StudioCreateParams = {
    model: opts.model,
    max_tokens: opts.maxTokens,

    ...(parts.length > 0 && { system: parts.join("\n\n") }),
    messages,
    ...(tools.length > 0 && { tools, tool_choice: toolChoice }),
    output_config: { effort: opts.effort },
    // Automatic prompt caching: the tools, instructions and history are re-sent every turn.
    cache_control: { type: "ephemeral" },
    ...(fallback && { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
  };
  return { params, wrapped };
}

function unwrapArgs(input: unknown): unknown {
  return input && typeof input === "object" && "args" in input ? (input as { args: unknown }).args : {};
}

/** Claude's stream events → AG-UI content events (the adapter emits no run or step boundaries). */
export class TurnTranslator {
  private responseId = "";
  private blocks = new Map<number, { kind: "text" | "tool"; id: string; wrapped?: boolean; json?: string }>();

  private readonly wrapped: ReadonlySet<string>;

  constructor(wrapped: ReadonlySet<string> = new Set()) {
    this.wrapped = wrapped;
  }

  translate(event: StreamEvent): AgAiEvent[] {
    switch (event.type) {
      case "message_start":
        this.responseId = event.message.id;
        return [];
      case "content_block_start": {
        const block = event.content_block;
        if (block.type === "text") {
          const id = itemId(this.responseId, event.index);
          this.blocks.set(event.index, { kind: "text", id });
          const out: AgAiEvent[] = [{ type: "TEXT_MESSAGE_START", messageId: id, role: "assistant" }];
          if (block.text) out.push({ type: "TEXT_MESSAGE_CONTENT", messageId: id, delta: block.text });
          return out;
        }
        if (block.type === "tool_use") {
          this.blocks.set(event.index, { kind: "tool", id: block.id, wrapped: this.wrapped.has(block.name), json: "" });
          return [{ type: "TOOL_CALL_START", toolCallId: block.id, toolCallName: block.name }];
        }
        return []; // thinking, fallback markers and the like stay in the raw content only
      }
      case "content_block_delta": {
        const b = this.blocks.get(event.index);
        if (!b) return [];
        if (b.kind === "text" && event.delta.type === "text_delta") return [{ type: "TEXT_MESSAGE_CONTENT", messageId: b.id, delta: event.delta.text }];
        if (b.kind === "tool" && event.delta.type === "input_json_delta" && event.delta.partial_json) {
          // A wrapped call's arguments are only sent once complete, unwrapped.
          if (b.wrapped) {
            b.json += event.delta.partial_json;
            return [];
          }
          return [{ type: "TOOL_CALL_ARGS", toolCallId: b.id, delta: event.delta.partial_json }];
        }
        return [];
      }
      case "content_block_stop": {
        const b = this.blocks.get(event.index);
        if (!b) return [];
        if (b.kind === "text") return [{ type: "TEXT_MESSAGE_END", messageId: b.id }];
        if (b.wrapped) {
          let args: unknown = {};
          try {
            args = unwrapArgs(JSON.parse(b.json || "{}"));
          } catch {
            args = {};
          }
          return [
            { type: "TOOL_CALL_ARGS", toolCallId: b.id, delta: JSON.stringify(args) },
            { type: "TOOL_CALL_END", toolCallId: b.id },
          ];
        }
        return [{ type: "TOOL_CALL_END", toolCallId: b.id }];
      }
      default:
        return [];
    }
  }
}

/** Studio's final response for a finished turn, from the complete message. */
export function toFinalResponse(message: Message, jsonReply: boolean, wrapped: ReadonlySet<string> = new Set()): AgLlmResponse {
  const output: AgAiOutputItem[] = [];
  message.content.forEach((block, index) => {
    if (block.type === "text") {
      let text = block.text;
      // A JSON reply sometimes arrives fenced; Studio parses the bare object.
      if (jsonReply) text = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      if (text) output.push({ id: itemId(message.id, index), kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] });
    } else if (block.type === "tool_use") {
      output.push({
        id: itemId(message.id, index),
        kind: "output",
        type: "function_call",
        callId: block.id,
        name: block.name,
        arguments: JSON.stringify((wrapped.has(block.name) ? unwrapArgs(block.input) : block.input) ?? {}),
        status: "completed",
      });
    }
  });

  const u = message.usage;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const input = (u.input_tokens ?? 0) + cacheRead + cacheWrite;
  const base: AgLlmResponse = {
    id: message.id,
    createdAt: Date.now(),
    output,
    status: "completed",
    model: message.model,
    usage: { inputTokens: input, outputTokens: u.output_tokens ?? 0, totalTokens: input + (u.output_tokens ?? 0), cachedInputTokens: cacheRead, cacheWriteTokens: cacheWrite },
  };
  if (message.stop_reason === "max_tokens") return { ...base, status: "incomplete", incompleteDetails: { reason: "max_output_tokens" } };
  if (message.stop_reason === "refusal") {
    return { ...base, output: [], status: "failed", error: { code: "refusal", message: "Claude declined this request. Try rephrasing it." } };
  }
  return base;
}

/** A failed turn, in the shape Studio reads (the error is reported on the response, not the stream). */
export function failedResponse(code: string, message: string): AgLlmResponse {
  return { id: `failed-${Date.now()}`, createdAt: Date.now(), output: [], status: "failed", error: { code, message } };
}
