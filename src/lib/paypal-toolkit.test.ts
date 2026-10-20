// Run with: npm test   (Node's built-in test runner with type stripping)
//
// The agent must never be able to move money through the PayPal Agent Toolkit. These tests pin
// the allowlist and check it against the real @paypal/agent-toolkit package (its MCP server,
// connected in-process; no network: listing tools and rejected calls never reach PayPal).

import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/mcp";
import {
  FORBIDDEN_TOOLKIT_TOOLS,
  RECONCILE_TOOLKIT_TOOLS,
  RESTOCK_AGENT_TOOLKIT_TOOLS,
  selectToolkitTools,
  TOOLKIT_ACTIONS,
  TOOLKIT_ALLOWLIST,
  ToolkitPolicyError,
} from "./paypal-toolkit-policy.ts";

async function connect(actions: Record<string, Record<string, boolean>>) {
  const server = new PayPalAgentToolkit({ accessToken: "test-token-not-used", configuration: { actions, context: { sandbox: true } } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "supplora-pay-test", version: "0.0.0" });
  await client.connect(clientTransport);
  return { client, close: async () => (await client.close(), await server.close()) };
}

test("allowlist: no money-moving toolkit tool is ever allowed", () => {
  for (const name of FORBIDDEN_TOOLKIT_TOOLS) assert.ok(!(TOOLKIT_ALLOWLIST as readonly string[]).includes(name), `${name} must not be allowlisted`);
  assert.ok(!(TOOLKIT_ALLOWLIST as readonly string[]).includes("pay_order"));
  assert.deepEqual([...RESTOCK_AGENT_TOOLKIT_TOOLS], ["get_order"], "the purchasing agent only reads orders");
  for (const name of [...RESTOCK_AGENT_TOOLKIT_TOOLS, ...RECONCILE_TOOLKIT_TOOLS]) assert.ok((TOOLKIT_ALLOWLIST as readonly string[]).includes(name));
});

test("toolkit configuration only enables reading orders and listing transactions", () => {
  assert.deepEqual(TOOLKIT_ACTIONS, { orders: { get: true }, transactions: { list: true } });
});

test("selectToolkitTools fails closed on unexpected tools and unknown requests", () => {
  const listed = [{ name: "get_order" }, { name: "list_transactions" }];
  assert.deepEqual(selectToolkitTools(listed, ["get_order"]), [{ name: "get_order" }]);
  assert.throws(() => selectToolkitTools([...listed, { name: "pay_order" }], ["get_order"]), ToolkitPolicyError);
  assert.throws(() => selectToolkitTools(listed, ["pay_order"]), ToolkitPolicyError);
  assert.throws(() => selectToolkitTools([{ name: "list_transactions" }], ["get_order"]), ToolkitPolicyError);
});

test("the real PayPal toolkit, configured by TOOLKIT_ACTIONS, exposes exactly the allowlist", async () => {
  const { client, close } = await connect(TOOLKIT_ACTIONS);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOLKIT_ALLOWLIST].sort());
    assert.doesNotThrow(() => selectToolkitTools(tools, RESTOCK_AGENT_TOOLKIT_TOOLS));
    // pay_order is not registered at all, so a call cannot reach PayPal.
    const res = await client.callTool({ name: "pay_order", arguments: { id: "5O190127TN364715T" } });
    assert.equal(res.isError, true);
    assert.match(JSON.stringify(res.content), /not found/i);
  } finally {
    await close();
  }
});

test("if the toolkit were configured with capture enabled, the policy would refuse it", async () => {
  const { client, close } = await connect({ ...TOOLKIT_ACTIONS, orders: { get: true, capture: true } });
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === "pay_order"), "sanity: the toolkit gates pay_order behind orders.capture");
    assert.throws(() => selectToolkitTools(tools, RESTOCK_AGENT_TOOLKIT_TOOLS), ToolkitPolicyError);
  } finally {
    await close();
  }
});
