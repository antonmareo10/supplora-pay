// Run with: npm test   (Node's built-in test runner with type stripping)
// AG Studio ⇄ Claude Messages API translation for /api/studio/llm.
import assert from "node:assert/strict";
import { test } from "node:test";
import { toAnthropicParams, toFinalResponse, toMessages, toolSchema, TurnTranslator, type StudioTurnRequest } from "./studio-llm.ts";

const user = (text: string) => ({ id: `u-${text}`, kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text }] });
const say = (id: string, text: string) => ({ id, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] });
const call = (id: string, callId: string, name: string, args: unknown) => ({ id, kind: "output", type: "function_call", callId, name, arguments: JSON.stringify(args), status: "completed" });
const result = (callId: string, output: string) => ({ kind: "input", type: "function_call_output", callId, output, status: "completed" });

const req = (input: unknown[], extra: Partial<StudioTurnRequest> = {}) => ({ input, responseFormat: { type: "text" }, ...extra }) as unknown as StudioTurnRequest;

test("toMessages: one assistant turn per response, tool results answer the calls", () => {
  const { messages } = toMessages(
    req([
      user("Who owes us a credit note?"),
      say("msg_1#0", "Let me check."),
      call("msg_1#1", "toolu_1", "execute_query", { q: 1 }),
      result("toolu_1", '{"rows":[]}'),
      say("msg_2#0", "Nobody yet."),
    ]),
  );
  // The history ends with an answer, so a "Continue." user turn closes it (see below).
  assert.deepEqual(
    messages.map((m) => m.role),
    ["user", "assistant", "user", "assistant", "user"],
  );
  assert.deepEqual(messages[1].content, [
    { type: "text", text: "Let me check." },
    { type: "tool_use", id: "toolu_1", name: "execute_query", input: { q: 1 } },
  ]);
  assert.deepEqual(messages[2].content, [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"rows":[]}' }]);
});

test("toMessages: the raw blocks of a turn (signed thinking included) are sent back unchanged", () => {
  const raw = [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "tool_use", id: "toolu_1", name: "execute_query", input: { q: 1 } },
  ];
  const { messages } = toMessages(req([user("Hi"), call("msg_1#1", "toolu_1", "execute_query", { q: 1 }), result("toolu_1", "ok")], { raw: { msg_1: raw } }));
  assert.deepEqual(messages[1].content, raw);
});

test("toMessages: raw blocks that no longer match Studio's tool calls are not used", () => {
  const raw = [{ type: "tool_use", id: "toolu_other", name: "x", input: {} }];
  const { messages } = toMessages(req([user("Hi"), call("msg_1#0", "toolu_1", "execute_query", {}), result("toolu_1", "ok")], { raw: { msg_1: raw } }));
  assert.deepEqual(messages[1].content, [{ type: "tool_use", id: "toolu_1", name: "execute_query", input: {} }]);
});

test("toMessages: a tool call without a result gets an error result, so the API accepts the history", () => {
  const { messages } = toMessages(req([user("Hi"), call("msg_1#0", "toolu_1", "add_widget", {}), user("Never mind")]));
  assert.deepEqual(messages[2].content, [
    { type: "tool_result", tool_use_id: "toolu_1", content: "This tool call was not run.", is_error: true },
    { type: "text", text: "Never mind" },
  ]);
});

test("toMessages: system-role input goes to the system prompt and the history starts with the user", () => {
  const { system, messages } = toMessages(
    req([{ id: "s", kind: "input", type: "message", role: "system", status: "completed", content: [{ type: "text", text: "Be brief." }] }, say("msg_1#0", "Hello")]),
  );
  assert.deepEqual(system, ["Be brief."]);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
});

test("toMessages: a history that ends with an answer gets a user turn (no assistant prefill)", () => {
  const { messages } = toMessages(req([user("Hi"), say("msg_1#0", "Hello")]));
  assert.equal(messages.at(-1)?.role, "user");
  assert.deepEqual(messages.at(-1)?.content, [{ type: "text", text: "Continue." }]);
});

test("toAnthropicParams: forced tool use becomes an instruction (Claude Opus 5.5 rejects any/tool)", () => {
  const tools = [{ name: "view_schema", description: "Schema", parameters: { type: "object", properties: {} } }];
  const { params } = toAnthropicParams(req([user("Hi")], { instructions: "You build dashboards.", tools, toolChoice: "required" }), {
    model: "claude-opus-5-5",
    maxTokens: 16000,
    effort: "medium",
  });
  assert.deepEqual(params.tool_choice, { type: "auto" });
  assert.match(String(params.system), /call one of your tools/);
  assert.deepEqual(params.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(params.fallbacks, "default");
  assert.deepEqual(params.cache_control, { type: "ephemeral" });
  assert.deepEqual(params.output_config, { effort: "medium" });
  assert.equal((params.tools?.[0] as { eager_input_streaming?: boolean }).eager_input_streaming, true);
});

test("toAnthropicParams: no fallback parameter for a model without server-side fallback", () => {
  const { params } = toAnthropicParams(req([user("Hi")]), { model: "claude-haiku-5-5", maxTokens: 1000, effort: "low" });
  assert.equal(params.fallbacks, undefined);
  assert.equal(params.betas, undefined);
});

test("toolSchema: an object root is kept; a union root is wrapped with its $defs hoisted", () => {
  assert.deepEqual(toolSchema({ type: "object", properties: { a: { type: "string" } } }), { schema: { type: "object", properties: { a: { type: "string" } } }, wrapped: false });
  const wrapped = toolSchema({ anyOf: [{ $ref: "#/$defs/A" }, { type: "null" }], $defs: { A: { type: "string" } } });
  assert.equal(wrapped.wrapped, true);
  assert.deepEqual(wrapped.schema, { type: "object", properties: { args: { anyOf: [{ $ref: "#/$defs/A" }, { type: "null" }] } }, required: ["args"], $defs: { A: { type: "string" } } });
});

test("TurnTranslator: text and tool calls stream as AG-UI events; wrapped arguments arrive unwrapped", () => {
  const t = new TurnTranslator(new Set(["union_tool"]));
  const events = [
    { type: "message_start", message: { id: "msg_9" } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Done." } },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_2", name: "union_tool", input: {} } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"args": {"x"' } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: ": 1}}" } },
    { type: "content_block_stop", index: 2 },
  ].flatMap((e) => t.translate(e as never));
  assert.deepEqual(events, [
    { type: "TEXT_MESSAGE_START", messageId: "msg_9#1", role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "msg_9#1", delta: "Done." },
    { type: "TEXT_MESSAGE_END", messageId: "msg_9#1" },
    { type: "TOOL_CALL_START", toolCallId: "toolu_2", toolCallName: "union_tool" },
    { type: "TOOL_CALL_ARGS", toolCallId: "toolu_2", delta: '{"x":1}' },
    { type: "TOOL_CALL_END", toolCallId: "toolu_2" },
  ]);
});

test("toFinalResponse: output items keep the response id; max_tokens is incomplete; a refusal fails", () => {
  const message = {
    id: "msg_9",
    model: "claude-opus-5-5",
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
    content: [
      { type: "thinking", thinking: "", signature: "s" },
      { type: "text", text: "Checking." },
      { type: "tool_use", id: "toolu_2", name: "execute_query", input: { q: 2 } },
    ],
  };
  const r = toFinalResponse(message as never, false);
  assert.equal(r.status, "completed");
  assert.deepEqual(
    r.output.map((o) => [o.id, o.type]),
    [
      ["msg_9#1", "message"],
      ["msg_9#2", "function_call"],
    ],
  );
  assert.equal((r.output[1] as { arguments: string }).arguments, '{"q":2}');
  assert.deepEqual(r.usage, { inputTokens: 110, outputTokens: 5, totalTokens: 115, cachedInputTokens: 100, cacheWriteTokens: 0 });
  assert.equal(toFinalResponse({ ...message, stop_reason: "max_tokens" } as never, false).status, "incomplete");
  const refused = toFinalResponse({ ...message, stop_reason: "refusal" } as never, false);
  assert.equal(refused.status, "failed");
  assert.equal(refused.output.length, 0);
});

test("toFinalResponse: a fenced JSON reply is unfenced for Studio", () => {
  const r = toFinalResponse({ id: "m", model: "x", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: '```json\n{"a":1}\n```' }] } as never, true);
  assert.equal((r.output[0] as { content: { text: string }[] }).content[0].text, '{"a":1}');
});
