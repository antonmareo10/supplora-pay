// One AG Studio agent turn on Claude: the browser posts Studio's request (conversation, instructions,
// tools), this route calls the Messages API with streaming and sends back AG-UI events as NDJSON,
// then the final response. The API key never reaches the browser; tools run in Studio, not here.

import Anthropic from "@anthropic-ai/sdk";
import { claudeErrorMessage } from "@/lib/claude";
import { encodeLine, HttpError, readJson, errorResponse, assertSameOrigin } from "@/lib/http";
import { currentClientIp, currentStateKey } from "@/lib/session";
import { studioAiLive, studioAiModel } from "@/lib/studio-ai";
import { failedResponse, toAnthropicParams, toFinalResponse, TurnTranslator, type StudioTurnLine, type StudioTurnRequest } from "@/lib/studio-llm";
import { WriteLimiter } from "@/lib/write-limits";

export const maxDuration = 120;

// Live turns are capped per visitor and in total (a run of the built-in agents takes 5 to 20 turns).
const g = globalThis as typeof globalThis & { __studioLimiter?: WriteLimiter; __studioClient?: Anthropic; __studioDownUntil?: number };
const limiter = (g.__studioLimiter ??= new WriteLimiter({ perSession: 120, perIp: 200, total: 600, windowMs: 3_600_000 }));
const client = () => (g.__studioClient ??= new Anthropic({ maxRetries: 2, timeout: 110_000 }));

const MAX_TOKENS = 16_000;

function validate(body: StudioTurnRequest): void {
  if (!body || !Array.isArray(body.input)) throw new HttpError("input must be the conversation items.", 400);
  if (body.input.length > 600) throw new HttpError("The conversation is too long for one turn.", 413);
  if (body.tools !== undefined && !Array.isArray(body.tools)) throw new HttpError("tools must be a list.", 400);
  if (body.instructions !== undefined && typeof body.instructions !== "string") throw new HttpError("instructions must be text.", 400);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!studioAiLive()) throw new HttpError("Live Claude is off on this deployment: the suggested prompts replay recorded runs.", 403);
    if ((g.__studioDownUntil ?? 0) > Date.now()) throw new HttpError("Claude is not available right now (API key or credit). Try again later.", 503);
    const decision = limiter.take(await currentStateKey(), await currentClientIp());
    if (!decision.ok) throw new HttpError("That's a lot of questions for one hour. Try again later.", 429);

    const body = await readJson<StudioTurnRequest>(request, 3_000_000);
    validate(body);
    const model = studioAiModel();
    const { params, wrapped } = toAnthropicParams(body, { model, maxTokens: MAX_TOKENS, effort: "medium" });
    const jsonReply = body.responseFormat?.type === "json";

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (line: StudioTurnLine) => controller.enqueue(encodeLine(line));
        const translator = new TurnTranslator(wrapped);
        try {
          const turn = client().beta.messages.stream(params, { signal: request.signal });
          for await (const event of turn) for (const e of translator.translate(event)) send({ type: "event", event: e });
          const message = await turn.finalMessage();
          const u = message.usage;
          console.log(
            `[studio] ${message.model} ${message.stop_reason} in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens}`,
          );
          send({ type: "final", response: toFinalResponse(message, jsonReply, wrapped), raw: { id: message.id, content: message.content } });
        } catch (err) {
          if (request.signal.aborted) {
            send({ type: "final", response: { ...failedResponse("cancelled", "Stopped."), status: "cancelled" } });
          } else {
            if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) g.__studioDownUntil = Date.now() + 10 * 60_000;
            console.error("[studio] turn failed:", err instanceof Error ? err.message : err);
            send({ type: "final", response: failedResponse(err instanceof Anthropic.APIError ? String(err.status ?? "api_error") : "error", claudeErrorMessage(err)) });
          }
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  } catch (err) {
    return errorResponse(err);
  }
}
