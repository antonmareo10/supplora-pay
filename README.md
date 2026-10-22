# Supplora Pay: the accounts-payable agent for independent restaurants

> **The only invoice an agent should pay is one that matches what actually arrived at the kitchen door, at the price you agreed.**
>
> Supplora Pay does a **three-way match** on every supplier invoice: the invoice (read by Claude) ↔ the **signed delivery note** (*albarán*) ↔ the restaurant's **price history**. Every euro is checked in integer cents by deterministic rules. It then plans the week's payments within a cash cap and pays suppliers through **PayPal Payouts** once the owner approves. A purchasing agent restocks low stock at the suppliers' online stores, which speak **PayPal's Cart API** for agents: the store prices the cart and creates the **PayPal Orders v2** order, and the agent verifies it with the official **PayPal Agent Toolkit**. It can never pay: the owner's approval only **authorizes** the order, and PayPal **captures only what the signed delivery note confirms**. Payment statuses come back through **verified PayPal webhooks**, and text on an invoice that tries to instruct the AI is held, never followed.

It grows out of [Supplora](https://www.supplora.app), an AI tool that reads restaurant delivery notes at the kitchen door and pushes them into the restaurant's ERP, in production at a family-run restaurant in Spain since March 2026 (715 delivery notes read and 103 supplier price increases flagged, worth €1,876, by September 2026). That is where the delivery notes and price history Supplora Pay matches against come from. In this repo they are seeded (`src/data/seed.ts`) and the restaurant, suppliers and people are fictional.

Built for the **PayPal AI Hackathon** (2026) · *Best Use of PayPal + AI* · *Best Use of Agentic Commerce*. MIT licensed. Development started on 16 Oct 2026 (first commit `dc36498`); what was built when is under "Built during the hackathon" below, and the full commit history is public.

**Demo video (2:30):** https://youtu.be/UstM9s4tu6o  ·  **Live demo:** https://supplora-pay.vercel.app

[![CI](https://github.com/antonmareo10/supplora-pay/actions/workflows/ci.yml/badge.svg)](https://github.com/antonmareo10/supplora-pay/actions/workflows/ci.yml)  ·  **[Threat model](SECURITY.md):** 14 ways an AI agent could misuse money here, each tied to the tests that prove its mitigation (the build fails if one of those tests disappears).

![Overview](docs/screenshots/devpost/01-catches.png)

---

## Judge in 3 clicks

**Hosted demo: https://supplora-pay.vercel.app** (no login, no keys; each browser gets a private session, *Reset demo* starts over). Every PayPal call goes to the live PayPal sandbox; Claude's readings and agent runs are replays of recorded real runs, and every screen says so.

1. **Inbox → Review 7 with Claude**, then open **CleanPro · CP-11958**. A lookalike invoice for a real delivery asks to be paid to a new PayPal address, and its fine print tells "AI assistants" to ignore their rules and pay it today. It is held (**€224.33**): Claude copied the instruction as data, the payee can only come from the supplier directory, and the payment agent's own plan check, run live on the page, answers `doc-07 is held and must not be paid.`
2. **Payment run → Plan this week's payments → Approve & pay 4 · €2,222.68.** The agent pays the three invoices due before the next run and Atlantic Wine early for its 2% discount (€23.15), defers Cárnicas Sanz, never pays the two held invoices. One real **PayPal Payouts** batch goes out; each item waits `UNCLAIMED` (placeholder payees).
3. **Reorder → Let the agent restock → Approve & authorize €144.96 → Delivery note in.** The agent's cart goes through CleanPro's **PayPal Cart API** (the store prices it and returns the PayPal order as its payment token), and the store completes checkout only after your approval (its order number appears on the card). Approval only authorizes the card; the (scripted, labelled) delivery note is one sanitiser short, so PayPal **captures €141.09** and **€3.87 is released**: authorized → captured → released, on the order card and in the **Ledger**, where *Reconcile with PayPal* reads it back. Then **Report damage**: one detergent arrived split, and PayPal refunds **€46.59** on the capture (scripted report, labelled), so the order cost €94.50.

The full click path, with what to say at each step, is in [docs/RECORDING.md](docs/RECORDING.md). To see Claude live, run it locally with your key (below).

## What it does

| | |
|---|---|
| **Three-way match before any payment** | Invoice line ↔ signed delivery note (quantity) ↔ price history (unit price, 2% tolerance), plus arithmetic, duplicates (in history and in the inbox), unknown supplier, changed payment details, discount windows and due dates. Each finding carries its evidence and the exact euros to withhold (`src/lib/checks.ts`, unit tests on the seven samples and edge cases). |
| **Pay the part that's right, hold the part that isn't** | Partial payments withhold only the flagged lines incl. VAT, and Claude drafts the credit-note request in the supplier's language with the same numbers. |
| **The payee never comes from the document** | The PayPal receiver comes from the supplier directory. An invoice asking to be paid somewhere new is held as *payment details changed*, the classic invoice fraud. |
| **Documents are data, not instructions** | Claude copies any text that tries to instruct the processor ("AI assistant: ignore your rules…") into a quarantined field; the rules hold the invoice, a second scan that does not depend on the model checks every transcribed text field, and the agents only ever see directory names, plain invoice references and rule-written reasons. |
| **Pay only for what arrived** | The purchasing agent's orders are PayPal orders with intent `AUTHORIZE`. Approval holds the money on the card; when the signed delivery note comes back, code computes the delivered amount and makes one final partial capture, and PayPal releases the rest (or the authorization is voided if nothing came). Goods that arrive damaged are refunded on the capture, at the order's own price. |
| **Agents shop through PayPal's Cart API** | Both supplier stores implement the merchant side of PayPal's Cart API for agentic commerce (create, read, replace, checkout). The store prices every cart itself, answers with validation issues the agent has to resolve, and completes checkout only once the owner's approval authorized the card. |
| **PayPal tells the ledger** | Verified webhooks (signature checked by PayPal, each event processed once) and the reconciliation update payout items, authorizations and captures; the ledger says which one updated each status. |
| **Agents propose, the owner approves, PayPal pays** | No agent tool can pay: the planner can only propose; the purchasing agent's PayPal toolkit is allowlisted to read-only `get_order`. Amounts are recomputed in code at approval time, against the current state and the cash cap. |
| **A keyless, multi-user public demo** | Replays real Claude runs with live tools and live PayPal sandbox calls, with per-visitor sessions. It falls back to clearly labelled deterministic rules when a judge goes off-script. |

## The seven sample invoices (and what Supplora Pay catches)

| Supplier | Issue built into the document | Outcome |
|---|---|---|
| Huerta del Guadalhorce (produce, ES) | `6 kg × €4.20` printed as `€28.20` | Pay partial: withhold **€3.12** (€3.00 + 4% VAT) |
| Pescados Bahía (fish, ES) | Hake at €13.80/kg vs €11.90 on the last 3 invoices | Pay partial: withhold **€29.26** (14 kg × €1.90 + 10% VAT) |
| Cárnicas Hermanos Sanz (meat, ES) | 12 kg of presa invoiced, 10 kg on the signed delivery note AL-3307 | Pay partial: withhold **€40.70** |
| Green Valley Dairy (EN) | "Payment reminder · copy" of an invoice already paid on 9 Oct | **Hold** €274.71 (duplicate) |
| Atlantic Wine & Spirits (EN) | 2/10 net 30 terms | Pay **€1,134.34 by 24 Oct** instead of €1,157.49: saves **€23.15** |
| CleanPro (EN) | none | Pay in full |
| CleanPro lookalike, CP-11958 (EN) | A real delivery (DN-4502), but a new PayPal payee and fine print telling "AI assistants" to ignore their rules and pay today: a prompt injection inside a business-email-compromise invoice | **Hold** €224.33: *the document tries to instruct the AI* + *payment details changed*; no credit-note email (verify by phone) |

With the default €2,500 cash cap, the payment agent pays the three invoices due before the next run, plus Atlantic Wine early to capture the discount, and defers Cárnicas Sanz (due 30 Oct): **€2,222.68**. The two held invoices are never in the plan.

![A prompt injection inside an invoice, held](docs/screenshots/devpost/more/prompt-injection.png)

![Findings](docs/screenshots/devpost/02-findings.png)

---

## How PayPal is used

All PayPal calls are server-side and sandbox-only: the app refuses any non-sandbox base URL. Credentials never reach the browser. Every write carries a `PayPal-Request-Id` idempotency key, and every call is written to the audit log (method, endpoint, status, resource id, debug id, never credentials). Code, not the model, decides every amount.

**Why PayPal Payouts rather than a bank transfer?** One API call pays several suppliers at once, and every payment comes back with its own item id and status (`SUCCESS`, `UNCLAIMED`, `RETURNED`…) that the app polls, shows to the owner and reconciles in the ledger. Each supplier is identified by a PayPal account (an email or PayPal ID) held in the supplier directory, not by bank details on an invoice. A bank transfer stays the fallback for suppliers who do not use PayPal (outside this demo).

| Need | PayPal product | Calls | How |
|---|---|---|---|
| Pay suppliers in one batch after approval | **Payouts** | `POST /v1/payments/payouts`, `GET /v1/payments/payouts/{id}` (polled until final) | REST (`src/lib/paypal.ts`): the toolkit has no Payouts tool |
| Agents shop at a supplier's store | **PayPal Cart API** (agentic commerce, merchant side) | `POST /merchant-cart`, `GET` and `PUT /merchant-cart/{id}`, `POST /merchant-cart/{id}/checkout` | The stores' own endpoints (`src/app/api/paypal/v1/stores/[supplier]/merchant-cart`, `src/lib/cart-api.ts`, `src/lib/store-carts.ts`): the store validates and prices the cart, a valid cart gets its PayPal order as `payment_method.token`, checkout completes after the owner's approval |
| The cart's payment token, and the owner's own store purchase | **Orders v2** | `POST /v2/checkout/orders` (intent `AUTHORIZE` for agent carts, `CAPTURE` for the owner's own store purchase; items, VAT breakdown, EUR) | REST: the toolkit's `create_order` (1.11.0) only accepts USD |
| The agent verifies its checkout; the approval re-checks it; the ledger reconciles it | **Orders v2 via the PayPal Agent Toolkit** | `get_order` (status, authorization and captures) | **`@paypal/agent-toolkit` MCP server** |
| Owner approval: hold the money on the card on file | **Vault v3 + Orders v2** | `POST /v3/vault/setup-tokens` → `POST /v3/vault/payment-tokens` (once); `confirm-payment-source` → `POST /v2/checkout/orders/{id}/authorize` | REST, only on the owner's approval (the owner's own store purchase captures at once instead) |
| **Pay only for what arrived** | **Payments v2** | `POST /v2/payments/authorizations/{id}/capture` with the delivered amount and `final_capture: true` (PayPal releases the rest), idempotency key `settle-{authorization id}`; `POST /v2/payments/authorizations/{id}/void` when nothing arrived | REST, when the signed delivery note is recorded; amounts from the order's own line prices (`src/lib/settlement.ts`) |
| Refund what arrived damaged | **Payments v2** | `POST /v2/payments/captures/{id}/refund` (partial; idempotency key per capture, line and step) | REST, when the kitchen reports damage (`src/lib/settlement.ts` `planRefund`: never more than was delivered on the line or captured) |
| **Know when PayPal changes a status** | **Webhooks** | `POST /v1/notifications/verify-webhook-signature` for every event (raw body, byte for byte); events `PAYMENT.PAYOUTS-ITEM.*`, `PAYMENT.AUTHORIZATION.*`, `PAYMENT.CAPTURE.*` | `POST /api/paypal/webhook` (`src/lib/webhooks.ts`): off until `PAYPAL_WEBHOOK_ID` is set; `scripts/register-webhook.mjs` registers the URL |
| Reconcile the ledger with the account | **Transaction Search via the toolkit** | `list_transactions` | toolkit; needs the app's *Transaction search* permission (otherwise PayPal answers 403 and the app says so) |
| Public demo housekeeping | **Payouts** | `GET /v1/payments/payouts/{id}`, `POST /v1/payments/payouts-item/{id}/cancel` | REST, demo mode only: a server-side sweep returns unclaimed sandbox payouts (see docs/DEPLOY.md) |
| Authenticate | OAuth 2.0 | `POST /v1/oauth2/token` (cached) | REST |

### Pay only for what arrived (authorize → capture → release)

Restaurants pay for deliveries that come short all the time; Supplora already reads the signed delivery note at the kitchen door. So the purchasing agent's orders never take the money up front:

1. The agent creates the order with intent `AUTHORIZE` and verifies it through the toolkit (`get_order`). It has no tool that can confirm, authorize or capture.
2. The owner approves: the order is confirmed with the vaulted card and **authorized**. Nothing is captured; the order card shows *Authorized · awaiting delivery note*.
3. The signed delivery note comes back. In the public demo it is a **scripted** note (every line arrives except one unit of the largest line) and is labelled as such. Code prices each delivered unit at the order's own unit price plus VAT, the same integer cents PayPal was sent, and makes **one final partial capture**. The idempotency key is derived from the authorization, so a double click or a retry can never capture twice, and PayPal refuses a second capture anyway.
4. The ledger shows **authorized €144.96 → captured €141.09 → €3.87 released**, and *Reconcile with PayPal* reads the authorization and the capture back from PayPal. If nothing arrived, the authorization is voided and all of it is released.
5. Something arrived damaged? The kitchen's report refunds those units on the capture at the order's own price (one detergent: **€46.59**, so the order cost €94.50). A line can never be refunded beyond what was delivered, refunds never exceed the capture, and the idempotency key (capture, line, step) makes a retry harmless. In the demo the damage report is scripted and labelled. A refund webhook for a refund the ledger already holds only confirms it.

![Pay only for what arrived](docs/screenshots/devpost/more/pay-for-what-arrived.png)

### PayPal Cart API: the supplier stores speak it

PayPal's Cart API is the contract a merchant exposes so that AI agents can shop: create a cart, read it, replace it, complete checkout. Both supplier stores in the demo implement the merchant side, and the purchasing agent's `create_checkout` goes through it:

1. The agent sends SKUs and quantities (and the catalog price it read) to `POST /merchant-cart`.
2. The store prices the cart from its own catalog and validates it. Problems come back as `validation_issues` the agent has to resolve, for example `PRICING_ERROR` with the resolution `ACCEPT_NEW_PRICE`, or `INVENTORY_ISSUE` with `MODIFY_CART`. An invalid cart gets no PayPal order.
3. A valid cart gets its PayPal order (Orders v2, intent `AUTHORIZE`) as `payment_method.token`. Calling `create_checkout` again for the same store replaces the cart (`PUT`): an unchanged charge keeps its order, a changed one gets a new order, which the agent has to verify again.
4. `POST /merchant-cart/{id}/checkout` completes the cart only when PayPal shows the payment authorized. Only the owner's approval authorizes it, so an agent that tries first gets a 422 with a `PAYMENT_ERROR` whose resolution is `REQUEST_APPROVAL`. After the approval the store completes checkout, and the order card shows the supplier's order number.

Try it against the hosted demo (sandbox; without a session cookie the calls share the demo's scratch session):

```bash
curl -s -X POST https://supplora-pay.vercel.app/api/paypal/v1/stores/cleanpro/merchant-cart \
  -H 'content-type: application/json' \
  -d '{"items":[{"variant_id":"CP-RA-10","quantity":1,"price":{"currency_code":"EUR","value":"20.00"}}]}'
# 200, status INCOMPLETE: PRICING_ERROR (the store's price is 24.90), resolution ACCEPT_NEW_PRICE, no PayPal order
```

Field names follow PayPal's published schema as WooCommerce's open-source Store Sync module mirrors it. In production a store would also verify PayPal's signed JWT on every call; here the endpoints are open, sandbox only, and covered by the demo's write caps.

### Verified webhooks

`POST /api/paypal/webhook` answers 503 until `PAYPAL_WEBHOOK_ID` is set. Then, for every delivery: unused event types are acknowledged and ignored; PayPal's transmission headers are checked (certificate on paypal.com over HTTPS); **PayPal verifies the signature** (`verify-webhook-signature`, with the raw event embedded byte for byte, since re-serialising it can change it); a forged event gets 401 before anything is read from it. Each event id is processed once (PayPal retries). The event's PayPal ids find the visitor session that owns the payment (an index kept in Redis or memory, like the sessions), and its ledger takes the new status, **marked "updated by webhook"**. Webhooks can arrive late or out of order, so a status only ever moves forward, and a webhook that merely confirms a status is still shown. Reconciliation updates statuses the same way, marked "updated by reconciliation"; amounts are never changed, only reported.

![Verified webhooks in the audit log](docs/screenshots/devpost/more/webhooks-ledger.png)

![Payouts batch](docs/screenshots/devpost/05-payouts-success.png)

### PayPal Agent Toolkit: allowlisted, read-only for the agent

The official toolkit (`@paypal/agent-toolkit` 1.11.0) runs as an **in-process MCP server** (`PayPalAgentToolkit` from `@paypal/agent-toolkit/mcp`), connected to an MCP client over an in-memory transport. Claude receives its tools through the Anthropic SDK's MCP helper (`mcpTool`). See `src/lib/paypal-toolkit.ts`.

Three layers keep agents away from money (`src/lib/paypal-toolkit-policy.ts`):

1. **Toolkit configuration** enables only `orders.get` and `transactions.list`, so the toolkit never registers `pay_order`, refunds, invoices or dispute actions.
2. **Fail-closed allowlist:** after connecting, every tool the toolkit lists is checked against `TOOLKIT_ALLOWLIST = ["get_order", "list_transactions"]`. Anything else (say, after a toolkit upgrade) aborts the connection.
3. **Least privilege per consumer:** the purchasing agent (Claude) gets `get_order` only. The ledger reconciliation (server code, no model) uses `list_transactions` + `get_order`.

`src/lib/paypal-toolkit.test.ts` checks this against the **real package**: with the app's configuration, the toolkit exposes exactly the allowlist, and calling `pay_order` returns "Tool pay_order not found". If `orders.capture` were ever enabled, the policy would throw.

How the toolkit is used in the flow:

- The **purchasing agent** must verify each checkout with `get_order` before `submit_for_approval` accepts it: `CREATED`, EUR, and the same total.
- The **approval route** re-reads the order through the toolkit and refuses to capture if PayPal's amount or status differs from what the owner approved.
- **Reconcile with PayPal** (`/ledger`) compares every order (toolkit `get_order`) and payout item (REST Payouts) with the ledger, and looks each capture and payout transaction up in the account's history (toolkit `list_transactions`).

### Payouts needs suppliers with PayPal accounts

PayPal Payouts sends money to a PayPal account, identified here by email. A supplier without a PayPal account at that address gets an `UNCLAIMED` payout: PayPal holds the money and returns it to the sender after 30 days unless the supplier signs up. That is what the sandbox shows here, because the demo payees are placeholder `.example` addresses: PayPal accepts and processes the batch (batch `SUCCESS`), and each item waits `UNCLAIMED`, as a real supplier's payout would until they claim it. The app shows these as sent and awaiting the supplier's claim, never as paid. Set `PAYPAL_PAYOUT_RECEIVER_OVERRIDE` to a sandbox personal account to see items reach `SUCCESS`.

For production, onboarding would take:

- collect each supplier's PayPal receiving email (or PayPal ID) **once**, through a supplier-side confirmation step, never from an invoice;
- verify it, for example with a €0.01 test payout the supplier confirms;
- store it in the supplier directory; Supplora Pay already holds any change of payment details as suspected fraud;
- get the restaurant's live business account approved for Payouts by PayPal, and fund its balance;
- keep a bank-transfer path for suppliers who will not use PayPal. That path is outside this demo.

## How Claude is used

Model `claude-opus-5-5` via the official `@anthropic-ai/sdk`, with `output_config.effort: "medium"` on every call. The two tool-runner agents (payment run and restock) also use adaptive thinking with `display: "updates"` for their progress notes and the server-side refusal fallback (`fallbacks: "default"`).

| Job | Technique | Code |
|---|---|---|
| Read a supplier document (an image, PNG/JPEG/WebP/GIF, or a PDF; Spanish or English) | Vision + structured output: `messages.parse` with a Zod schema. Claude transcribes **exactly what is printed** (it must not fix errors), maps the supplier and every line to the directory, and reports things only visible on the document (a "copy/reminder" stamp, new payment details). | `src/lib/review.ts` |
| Verify | **Not Claude:** deterministic rules in integer cents; every finding carries its evidence. | `src/lib/checks.ts` |
| Plan the payment run | Tool-runner agent: `get_open_invoices`, `get_cash_position`, `get_supplier`, `propose_payment_plan` (validates the cap, holds, discount windows and completeness, computes every amount in code, returns errors for the agent to fix), `request_approval`. | `src/lib/planner.ts` |
| Restock | Tool-runner agent: `check_inventory`, `browse_store`, `create_checkout` (prices from the catalog, never from the model; enforces the spending limit), **`get_order` (PayPal Agent Toolkit)**, `submit_for_approval`. | `src/lib/restock.ts` |
| Ask for credit notes | `messages.parse` → `{subject, body}` in the supplier's language, only from the facts provided. | `src/lib/disputes.ts` |

"Disputes" in this app means **credit-note request emails to suppliers**. It does not use PayPal's Disputes API (that API is for buyer disputes on PayPal transactions, a different problem).

**Recorded runs for the keyless demo.** Run with `RECORD_DEMO=1` and real keys, and the app records Claude's real outputs to `src/data/recorded/`: invoice readings (checked against each sample's SHA-256), each agent turn's notes and tool calls (with a fingerprint of the inputs), and the credit-note emails. With `DEMO_MODE=1` the app replays them: Claude is never called, but every recorded tool call executes live against the real rules and the PayPal sandbox. If a judge changes the inputs (another cash cap, an override), the demo says so and uses a deterministic planner or buyer with the same rules and tools instead (`src/lib/agent-run.ts`).

### Guardrails (human in the loop by design)

- **Agents never move money.** No agent tool confirms, authorizes, captures or pays, and the toolkit's `pay_order` is never enabled. Money moves only after an owner action: approving a payment plan (Payouts), approving the purchasing agent's restock (confirm + authorize; the capture follows the signed delivery note, for what it confirms), or the owner buying directly in a supplier store page (`/api/store/[supplier]/checkout`, which creates, confirms and captures the order in one step).
- **Documents are data.** Text on a document that tries to instruct the AI is transcribed into a quarantined field and holds the invoice; the agents never receive it (`src/lib/checks.ts`, `src/lib/plan-rules.ts`).
- **Amounts are computed in code**, not by the model. They are re-validated at approval against the current state, the cash cap and the open discount window.
- **Payment destinations come from the supplier directory, never from the document.** Unknown suppliers, duplicates and changed payment details are held.
- **Spending limits** (cash cap, restock limit) are enforced by the tools *and* again at approval.
- Sandbox only; secrets only on the server; same-origin check on every write; uploads type-checked by magic bytes and size-limited; in the public demo, hourly caps on PayPal writes per session, per client IP and in total, plus a server-side sweep that returns unclaimed sandbox payouts.

![Agentic reorder](docs/screenshots/devpost/06-restock-checkout.png)

## Ledger: AG Grid + AG Charts (Community)

`/ledger` is the owner's dashboard. It uses only the free, MIT-licensed Community editions, so there is no Enterprise feature, licence key or watermark.

- **Theming:** Quartz re-skinned to the app's "ledger on warm paper" palette (`src/components/client/ag-theme.ts`), including the cell-change flash colour.
- **Custom widgets:** status pills, severity dots, a **findings tooltip** that shows the evidence behind every flag, an in-cell bar on withheld amounts, due dates with relative labels, PayPal id cells, and a reconciliation grid with match chips.
- **Layout:** column groups (Amounts / Why / PayPal), supplier pinned left for narrow screens, a flexible, wrapping "Top finding" column so the grid fits a laptop screen without horizontal scrolling, hidden columns that still feed the quick search and the CSV export, a filter-aware pinned **totals row**, and a live subtotal strip.
- **Cross-filtering:** an AG Charts stacked bar ("where the money stands, by supplier") is recomputed from the rows that pass the grid's filters. Clicking a supplier's bar filters the grid, just as the status chips do (AG Grid external filters); the legend under the chart shows and hides series.

The dashboard uses AG Grid and AG Charts Community only; AG Studio was not used in this project.

![Ledger](docs/screenshots/devpost/07-ledger-grid.png)

## Judging criteria map

| Criterion | Where to look |
|---|---|
| **Technical implementation** | Integer-cent rules engine with tests (`checks.ts`), Claude tool-runner agents with validation tools, PayPal Payouts / Orders v2 / Vault v3 / Payments v2 (authorize, partial final capture, void, refund) over REST with idempotency + audit, verified webhooks with dedupe and out-of-order protection, the PayPal Agent Toolkit as an in-process MCP server behind a tested allowlist, the supplier stores' PayPal Cart API (merchant side), reconciliation, per-session demo state, record/replay of real agent runs. 83 tests and CI on every push; a [threat model](SECURITY.md) whose every mitigation is tied to a test. |
| **Design** | One coherent UI from inbox to ledger, an agent timeline that shows every tool call, a plan-vs-cash-cap view, and the AG Grid + AG Charts ledger. |
| **Impact** | Overcharges, short deliveries and duplicates are caught *before* paying; discounts are captured. It is built on a product in production at a real restaurant: 715 delivery notes read and €1,876 of price increases flagged (Mar–Sep 2026). |
| **Innovation** | Three-way match + agentic payments with a hard human-approval boundary. Restock orders are paid only for what the signed delivery note confirms (authorize → partial capture → release). Payees never come from documents, and a prompt injection inside an invoice is held, not followed. A keyless public demo that replays real Claude runs against live tools. |
| **Presentation** | The hosted demo, [docs/RECORDING.md](docs/RECORDING.md), Devpost screenshots in `docs/screenshots/devpost/` with [captions](docs/screenshots/devpost/CAPTIONS.md). |
| **Best Use of PayPal + AI** | Claude reads, checks and plans; PayPal Payouts pays only what the rules and the owner approve. |
| **Best Use of Agentic Commerce** | The purchasing agent shops the suppliers' stores through PayPal's Cart API (the store prices and validates every cart; checkout completes only after the owner's approval), verifies each PayPal order with the PayPal Agent Toolkit, stays within a limit, and cannot pay; the owner's approval authorizes, and PayPal captures only what arrived. |

## Architecture

```
Browser (Next.js 16 App Router, React 19, Tailwind 4, AG Grid + AG Charts Community)
  │  server components read state; client components call route handlers
  ▼
proxy.ts (DEMO_MODE: per-visitor session cookie)
  ▼
Route handlers (/app/api/*) ── same-origin check, input validation ─────────────┐
  ├─ review       → Claude vision (messages.parse + Zod) | demo: recorded reading → rules (checks.ts)
  ├─ payment-run  → Claude tool runner | demo: replay → tools → plan "awaiting approval"
  ├─ plans/approve (owner) → PayPal Payouts POST → poll GET → invoices paid
  ├─ restock      → Claude tool runner → create_checkout → the store's PayPal Cart API (POST/PUT /merchant-cart → REST Orders v2, EUR)
  │                                    → get_order (PayPal Agent Toolkit, MCP, allowlisted)
  ├─ restock/[id] approve (owner) → toolkit get_order re-check → Vault token → confirm → authorize → Cart API checkout
  ├─ paypal/v1/stores/[supplier]/merchant-cart → the stores' PayPal Cart API, for any agent (checkout needs the owner's approval)
  ├─ orders/[id]/delivery (signed delivery note) → final partial capture of what arrived | void
  ├─ paypal/webhook (from PayPal) → verify-webhook-signature → dedupe → session ledger update
  ├─ reconcile    → toolkit get_order + list_transactions, REST Payouts GET (statuses taken over, amounts reported)
  └─ disputes     → Claude messages.parse | demo: recorded draft → credit-note email
  ▼
State: .data/state.json (local) · per-session memory (Render) or Redis (Vercel) · audit log
       · demo payout registry (same store) → housekeeping sweep (demo-sweep.ts)
       · PayPal id → session index and processed webhook ids (same store)
```

## Run it locally

Requirements: Node 22.18+ (tested on Node 24; `npm test` uses Node's built-in TypeScript type stripping), and a PayPal **sandbox** REST app (developer.paypal.com → Apps & Credentials → Sandbox). An Anthropic API key is optional: without one, use demo mode.

```bash
npm install
cp .env.example .env.local      # then fill in the keys
npm run dev                     # http://localhost:3300, live Claude
# or the keyless demo:
npm run build && DEMO_MODE=1 npx next start -p 3300
```

*Reset demo* (sidebar) starts over. Deploying the public demo (Render or Vercel), its environment variables and sandbox funding are covered in [docs/DEPLOY.md](docs/DEPLOY.md).

### Run it without keys

With `DEMO_MODE=1` and no keys at all (no `.env.local`), the invoice review, the payment plan, the credit-note drafts and the ledger work: Claude's runs are replays of recorded real runs. The PayPal steps need the sandbox credentials: *Approve & pay* answers "PayPal is not configured", the restock agent and the supplier-store checkout are switched off with a note saying the PayPal sandbox credentials are missing, and nothing is sent.

### Sandbox notes

- **Currency:** EUR everywhere (verified in the sandbox for Payouts and Orders).
- **Payout receivers** use the reserved `.example` domain (`src/data/seed.ts`), so items end `UNCLAIMED` (see "Payouts needs suppliers with PayPal accounts" above).
- **Card on file:** the first approved order vaults PayPal's public sandbox test card `4012 0000 7777 7777` with Vault v3; after that only the vault token is used. Storefront orders settle to the sandbox app's own merchant account. In production each supplier would be its own PayPal merchant (for example via PayPal Commerce Platform, with `payee` set per store).
- **Business date:** the samples are dated around Friday 16 Oct 2026, so the demo pins "today" to that date (override with `DEMO_TODAY`); the app says so next to the date. Timestamps in the activity and audit logs are real.

### Evidence from real sandbox runs

| What | Ids |
|---|---|
| 21 Oct 2026, the hosted-demo run shown in the **demo video** and the Devpost write-up | payout batch `PEA4YCDQQYJYC` (4 payments, €2,222.68); pay only for what arrived: order `34174743UF620021N` → authorization `79M84169RV1677242` €144.96 → capture `0U834596PH204811V` €141.09, €3.87 released (a second settle refused, 409); webhooks on order `14G26149V1692290B`: `PAYMENT.AUTHORIZATION.CREATED` and `PAYMENT.CAPTURE.COMPLETED` verified |
| 21 Oct 2026, pay only for what arrived (demo build, API run) | agent order `3M906369E0418045N` (intent `AUTHORIZE`) → authorization `4R951030DL221241S` €144.96 → scripted delivery note one sanitiser short → capture `7KM76023Y9986915L` €141.09 `COMPLETED`, authorization `CAPTURED`, €3.87 released; a second settle was refused (409). Nothing-arrived path: authorization `7S136218MJ473003Y` `VOIDED`. Reconciliation: match |
| 21 Oct 2026, the same flows in a browser (demo build; the screenshots in `docs/screenshots/devpost/more/` from 21 Oct) | agent order `4FX500526M484790R` → authorization `3GA09244ST5301111` €144.96 → capture `09K84076TT252635F` €141.09, €3.87 released; payout batch `MHPPVY5V9MQ4G` (4 items, €2,222.68) `UNCLAIMED`, then cancelled with the payout-item cancel endpoint (as the demo housekeeping does), which returned the money |
| 21 Oct 2026, verified webhooks (a sandbox webhook pointed at a temporary tunnel to the local demo, deleted afterwards) | `PAYMENT.PAYOUTS-ITEM.UNCLAIMED`, `PAYMENT.AUTHORIZATION.CREATED` and `PAYMENT.CAPTURE.COMPLETED` verified and shown as confirmations; `PAYMENT.PAYOUTS-ITEM.RETURNED` for items `7HV3HHJJVEQQL`, `K6M7A8NP3DUY2`, `49M6FCCFYJVMW`, `Q64BL2PZQ7TQW` moved the ledger to *Returned · unpaid*, marked "updated by webhook". A forged event was refused: PayPal answered `FAILURE`, the endpoint 401 |
| 21 Oct 2026, prompt injection (live Claude) | CP-11958 read with the instruction copied verbatim into `embedded_instructions`; held; the re-recorded payment-plan run (live Claude) still pays €2,222.68 and lists CP-11958 as held |
| 20 Oct 2026, recorded run (live Claude): payout batch, 4 approved payments (€2,222.68) | batch `P3BHMU5TBZKJY`: PayPal processed it (batch `SUCCESS`); its items `TAQJ49F3CVHLS`, `KQ4M6EQZFC7BJ`, `MY5ZJQRW7UXGC`, `DCFRTAWVE9FA4` waited `UNCLAIMED` (placeholder payees) and were later cancelled, which returned the money (a later cancel answered `ITEM_ALREADY_CANCELLED`) |
| 20 Oct 2026: agent checkout at CleanPro (€144.96), before the authorize flow | order `7K0802515N435435N` `CREATED` → verified with toolkit `get_order` → re-checked at approval → vault-token confirm → capture `67D93304JG2552323` `COMPLETED` |
| 20 Oct 2026: reconciliation | 5/5 match (4 payout items over REST, 1 order via toolkit `get_order`); `list_transactions` → 403 until Transaction Search is enabled on the app |
| 16 Oct 2026: earlier run of the same four payments (€2,222.68), approved in two steps | batch `RKYHUPDKCFCKC` (1 payment, €158.34) and batch `2E9W84LASKJY6` (3 payments, €2,064.34), both batch `SUCCESS` (item statuses were not recorded); agent checkout at CleanPro (€144.96): order `9YE76279V08301647` → capture `7H155397J75490001` `COMPLETED` (before the PayPal Agent Toolkit was added) |

## Built during the hackathon

From the commit history (first commit `dc36498`, 16 Oct 2026). Supplora, the delivery-note reader in production, is a separate, earlier product; its code is not in this repo.

| Date | What was built |
|---|---|
| 16 Oct 2026 | Scaffold, seed data and the six sample invoices; the integer-cent rules engine; Claude review (vision + structured output), the payment-run agent, PayPal Payouts, the purchasing agent with Orders v2 + Vault v3; the UI from inbox to ledger |
| 17 Oct 2026 | Money guarantees: restock limit backstop, stuck-payment recovery, partial-pay guard |
| 20 Oct 2026 | AG Grid + AG Charts ledger; the PayPal Agent Toolkit as an in-process MCP server; the keyless public demo (recorded Claude runs, per-visitor sessions); docs |
| 21 Oct 2026 | Honest payout states, demo fund sweep and write caps; hosted demo on Vercel; **pay only for what arrived** (authorize → partial capture → release), **verified PayPal webhooks**, the **prompt-injection** invoice and its guardrails |
| 22 Oct 2026 | The supplier stores' **PayPal Cart API** (merchant side) and the purchasing agent shopping through it; **refunds** for damaged goods on the capture; CI; the [threat model](SECURITY.md) tied to tests |

## Quality checks

```bash
npm test          # 83 tests, no network: rules engine on the seven samples (incl. the prompt injection and false-positive checks), edge cases and money helpers (13), partial-pay guard and ledger stats (7), the payment agent's plan check (5), pay-for-what-arrived settlement and refunds (9), webhook headers, verification body, routing, forward-only status updates and refund dedupe (9), PayPal Agent Toolkit allowlist against the real package (5), demo payout sweep (7), write caps (4), reconciliation view (4), request guards (4), sandbox-only PayPal host (2), the order check before approval (3), the checkout race (3), the stores' Cart API (6) and the threat model (2)
npm run typecheck # next typegen + tsc
npm run lint
npm run build
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, the tests and the production build on every push, without any secrets.

## Project structure

```
src/app/(app)/           overview, inbox, review, payments, disputes, reorder, ledger
src/app/store/           simulated supplier storefronts (merchant side)
src/app/api/             route handlers (review, payment-run, approve, payouts, restock, store, disputes, reconcile, reset, health)
src/proxy.ts             demo mode: per-visitor session cookie
src/lib/checks.ts        deterministic review rules (+ checks.test.ts)
src/lib/review.ts        Claude vision extraction (live / recorded)
src/lib/planner.ts       payment-run agent
src/lib/restock.ts       purchasing agent: carts through the stores' Cart API, toolkit verification, approval, settlement
src/lib/cart-api.ts      PayPal Cart API, merchant side: pricing, validation issues, totals, checkout decision (+ tests)
src/lib/store-carts.ts   the stores' carts: PayPal order as payment token, replace, checkout after approval
src/lib/http-guards.ts   same-origin check, body and amount parsing (+ tests); order-checks.ts: PayPal order vs checkout (+ tests)
src/lib/paypal.ts        PayPal REST client (OAuth cache, idempotency, audit, demo write limits)
src/lib/settlement.ts    pay only for what arrived: delivered amount, capture or void (+ tests)
src/lib/webhooks.ts      verified webhooks; webhook-events.ts: status updates shared by poll, webhook, reconcile (+ tests)
src/lib/plan-rules.ts    the payment agent's plan check and what it may read about a document (+ tests)
src/lib/demo-sweep.ts    public demo: returns unclaimed sandbox payouts (+ tests); write-limits.ts: demo write caps (+ tests)
src/lib/paypal-toolkit*.ts  PayPal Agent Toolkit MCP wiring + allowlist policy (+ tests)
src/lib/reconcile.ts     ledger ↔ PayPal reconciliation
src/lib/agent-run.ts     live / record / replay driver for the agents
src/lib/state.ts, session.ts   state store (file, per-session memory, Redis) and demo sessions
src/data/seed.ts         supplier directory, price history, delivery notes, stores, inventory
src/data/recorded/       real Claude outputs replayed by the public demo
scripts/                 generate-samples.mjs (invoice images), register-webhook.mjs (PayPal webhook id)
docs/                    DEPLOY.md, RECORDING.md, screenshots
SECURITY.md              threat model: each threat, its mitigation and the tests that prove it
```

## Limitations

- Single restaurant, no authentication: a real deployment needs a database, users and roles. The public demo isolates visitors by session cookie only.
- Delivery notes, price history and inventory are seeded; in production they come from Supplora's ERP integration.
- Supplier payees are placeholders; onboarding suppliers' PayPal accounts is described above, not built.
- Transaction Search needs the PayPal app's *Transaction search* permission; without it, reconciliation checks each order and payout one by one.
- In the public demo the delivery note that settles a restock order is scripted (and labelled); in production it is the note Supplora captures at the kitchen door.
- Webhooks need a public URL and `PAYPAL_WEBHOOK_ID`; until then the endpoint answers 503 and statuses come from polling and reconciliation.
- The stores' Cart API endpoints have no authentication in the demo (sandbox only, write caps); a real store would verify PayPal's signed JWT.

## Who built it

Antonio González Fernández, Business Administration + Data Science student (CUNEF, Madrid), founder of Supplora.

## Licence

MIT, see [LICENSE](LICENSE).
