// PayPal Agent Toolkit (official, @paypal/agent-toolkit) wired in as an in-process MCP server.
//
// The toolkit's MCP server (PayPalAgentToolkit from "@paypal/agent-toolkit/mcp") is connected
// to an MCP client over an in-memory transport, so tool discovery and every tool call go through
// the Model Context Protocol exactly as they would with PayPal's hosted MCP server, without a
// separate process. Claude receives the allowlisted tools through the Anthropic SDK's MCP helper
// (mcpTool), wrapped so each call is audited like our REST calls.
//
// What goes through the toolkit, and what does not:
//   - get_order (the purchasing agent verifies each checkout it created; the owner's approval
//     route re-reads the order before paying it; the ledger reconciliation checks every order)
//   - list_transactions (ledger reconciliation against the PayPal account's transaction list)
//   - Payouts stay on our REST client: the toolkit has no Payouts tool.
//   - EUR checkouts are created over REST: the toolkit's create_order (1.11.0) only accepts USD.
//   - Confirm/capture stay on REST, in the owner's approval route only: pay_order is never enabled.
// See paypal-toolkit-policy.ts for the allowlist and how it is enforced.

import { mcpTool, type MCPCallToolResultLike, type MCPClientLike } from "@anthropic-ai/sdk/helpers/beta/mcp";
import type { BetaRunnableTool, BetaToolRunContext } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/mcp";
import { fromDecimalString } from "./money";
import { sandboxAccessToken } from "./paypal";
import { selectToolkitTools, TOOLKIT_ACTIONS, type ToolkitToolName } from "./paypal-toolkit-policy";
import { audit } from "./state";
import type { AuditEntry } from "./types";

export interface ToolkitResult {
  ok: boolean;
  /** Parsed JSON the toolkit returned (the PayPal API response, or its error object). */
  data: Record<string, unknown>;
  /** Raw text the toolkit returned (what Claude sees). */
  text: string;
  error?: string;
  status?: number;
  durationMs: number;
}

export interface ToolkitConnection {
  /** Claude-ready tools (Anthropic SDK runnable tools) for the given allowlisted toolkit tools. */
  agentTools(names: readonly ToolkitToolName[], hooks?: AgentToolHooks): BetaRunnableTool<Record<string, unknown>>[];
  /** Call an allowlisted toolkit tool from server code. Audited. */
  call(name: ToolkitToolName, args: Record<string, unknown>, ctx?: CallContext): Promise<ToolkitResult>;
  close(): Promise<void>;
}

export interface AgentToolHooks {
  /** Called before each agent call; may rewrite the input (demo replays remap recorded order ids). */
  before?: (name: string, input: Record<string, unknown>, toolUseId: string) => Record<string, unknown>;
  /** Called after each agent call with the parsed result; the returned string is what Claude sees. */
  after?: (name: string, input: Record<string, unknown>, result: ToolkitResult, toolUseId: string) => string | void;
}

interface CallContext {
  ref?: AuditEntry["ref"];
  /** Who asked: the purchasing agent (Claude) or the app's own server code. */
  caller?: "agent" | "server";
}

const ENDPOINT: Record<ToolkitToolName, (args: Record<string, unknown>) => { method: string; endpoint: string }> = {
  get_order: (a) => ({ method: "GET", endpoint: `/v2/checkout/orders/${String(a.id ?? "")}` }),
  list_transactions: () => ({ method: "GET", endpoint: "/v1/reporting/transactions" }),
};

function parse(text: string): { data: Record<string, unknown>; error?: string; status?: number } {
  let data: Record<string, unknown>;
  try {
    const v = JSON.parse(text);
    data = v && typeof v === "object" && !Array.isArray(v) ? v : { value: v };
  } catch {
    return { data: { text }, error: text.slice(0, 300) || "Empty toolkit response" };
  }
  // The toolkit reports API failures as JSON: {ok:false,status,code,message} or {error:{message}}.
  if (data.ok === false || data.error) {
    const err = data.error as { message?: string } | string | undefined;
    const message = typeof data.message === "string" ? data.message : typeof err === "string" ? err : err?.message;
    return { data, error: message ?? "PayPal Agent Toolkit call failed", status: typeof data.status === "number" ? data.status : undefined };
  }
  return { data, status: 200 };
}

function summarize(name: ToolkitToolName, r: ToolkitResult): string {
  if (!r.ok) return `${name} failed: ${r.error}`;
  if (name === "get_order") {
    const o = orderFacts(r.data);
    return `${o.id} · ${o.status}${o.amountCents != null ? ` · ${o.currency} ${(o.amountCents / 100).toFixed(2)}` : ""}${o.captureId ? ` · capture ${o.captureId}` : ""}`;
  }
  const n = Array.isArray(r.data.transaction_details) ? r.data.transaction_details.length : 0;
  return `${n} transaction${n === 1 ? "" : "s"}`;
}

/** Status, amount and first capture of an order as returned by get_order. */
export function orderFacts(data: Record<string, unknown>) {
  const pu = (data.purchase_units as { amount?: { value?: string; currency_code?: string }; payments?: { captures?: { id: string; status: string }[] } }[] | undefined)?.[0];
  return {
    id: String(data.id ?? ""),
    status: String(data.status ?? ""),
    amountCents: pu?.amount?.value ? fromDecimalString(pu.amount.value) : null,
    currency: pu?.amount?.currency_code ?? "",
    captureId: pu?.payments?.captures?.[0]?.id,
    captureStatus: pu?.payments?.captures?.[0]?.status,
  };
}

/**
 * Opens a toolkit connection: an in-process PayPal MCP server restricted to TOOLKIT_ACTIONS,
 * always pointed at the sandbox, authenticated with the app's cached OAuth token.
 */
export async function openToolkit(): Promise<ToolkitConnection> {
  const accessToken = await sandboxAccessToken();
  const server = new PayPalAgentToolkit({
    accessToken,
    configuration: { actions: TOOLKIT_ACTIONS as unknown as Record<string, Record<string, boolean>>, context: { sandbox: true } },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "supplora-pay", version: "0.2.0" });
  await client.connect(clientTransport);
  const { tools: listed } = await client.listTools();
  // Fail closed if the toolkit exposes anything beyond the allowlist.
  selectToolkitTools(listed, []);

  const call = async (name: ToolkitToolName, args: Record<string, unknown>, ctx: CallContext = {}): Promise<ToolkitResult> => {
    selectToolkitTools(listed, [name]);
    const started = Date.now();
    let text: string;
    try {
      const res = await client.callTool({ name, arguments: args });
      const content = (res.content as { type: string; text?: string }[] | undefined) ?? [];
      text = content.map((c) => (c.type === "text" ? c.text ?? "" : "")).join("");
      if (res.isError && !text) text = JSON.stringify({ ok: false, message: "Toolkit tool error" });
      if (res.isError && !text.trim().startsWith("{")) text = JSON.stringify({ ok: false, message: text });
    } catch (err) {
      text = JSON.stringify({ ok: false, message: err instanceof Error ? err.message : "Toolkit call failed" });
    }
    const p = parse(text);
    const result: ToolkitResult = { ok: !p.error, data: p.data, text, error: p.error, status: p.status, durationMs: Date.now() - started };
    const ep = ENDPOINT[name](args);
    await audit({
      actor: "paypal",
      message: `${ctx.caller === "agent" ? "Purchasing agent" : "Supplora"} → PayPal Agent Toolkit · ${name}${result.ok ? "" : " — rejected"}`,
      api: {
        method: ep.method,
        endpoint: ep.endpoint,
        status: result.status ?? (result.ok ? 200 : 0),
        ok: result.ok,
        durationMs: result.durationMs,
        resourceId: result.ok ? summarize(name, result) : undefined,
        error: result.error,
        via: "toolkit",
      },
      ref: ctx.ref,
    });
    return result;
  };

  return {
    call,
    agentTools(names, hooks) {
      // The Anthropic SDK's MCP helper turns each listed MCP tool into a Claude tool definition;
      // its `run` is replaced so calls go through `call` (allowlist re-check + audit log).
      const clientLike: MCPClientLike = { callTool: async (p) => (await client.callTool(p)) as MCPCallToolResultLike };
      return selectToolkitTools(listed, names).map((tool) => {
        const base = mcpTool(tool, clientLike) as BetaRunnableTool<Record<string, unknown>> & BetaTool;
        // Anthropic tool schemas do not need the JSON-Schema dialect marker the MCP SDK adds.
        const { $schema: _ignored, ...inputSchema } = base.input_schema as Record<string, unknown>;
        void _ignored;
        const runnable: BetaRunnableTool<Record<string, unknown>> = {
          ...base,
          input_schema: inputSchema as BetaTool["input_schema"],
          run: async (input: Record<string, unknown>, context?: BetaToolRunContext) => {
            const id = context?.toolUse?.id ?? crypto.randomUUID();
            const args = hooks?.before ? hooks.before(tool.name, input, id) : input;
            const r = await call(tool.name as ToolkitToolName, args, { caller: "agent" });
            const shown = hooks?.after?.(tool.name, args, r, id);
            return typeof shown === "string" ? shown : r.text;
          },
        };
        return runnable;
      });
    },
    async close() {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    },
  };
}

/** Run `fn` with a toolkit connection that is always closed afterwards. */
export async function withToolkit<T>(fn: (tk: ToolkitConnection) => Promise<T>): Promise<T> {
  const tk = await openToolkit();
  try {
    return await fn(tk);
  } finally {
    await tk.close();
  }
}
