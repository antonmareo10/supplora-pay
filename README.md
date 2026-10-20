# Supplora Pay: the accounts-payable agent for independent restaurants

> **The only invoice an agent should pay is one that matches what actually arrived at the kitchen door, at the price you agreed.**
>
> Supplora Pay does a **three-way match** on every supplier invoice: the invoice (read by Claude) ↔ the **signed delivery note** (*albarán*) ↔ the restaurant's **price history**. Every euro is checked in integer cents by deterministic rules. It then plans the week's payments within a cash cap and pays suppliers through **PayPal Payouts** once the owner approves. A purchasing agent restocks low stock through **PayPal Orders v2** checkouts and verifies them with the official **PayPal Agent Toolkit**. It can never capture a payment.

It grows out of [Supplora](https://www.supplora.app), an AI tool that reads restaurant delivery notes at the kitchen door and pushes them into the restaurant's ERP, in daily use at a restaurant in Spain. That is where the delivery notes and price history Supplora Pay matches against come from. In this repo they are seeded (`src/data/seed.ts`) and the restaurant, suppliers and people are fictional.

Built for the **PayPal AI Hackathon** (2026) · *Best Use of PayPal + AI* · *Best Use of Agentic Commerce* · AG Grid sponsor prize. MIT licensed.

![Overview](docs/screenshots/devpost/01-catches.png)

---

## Judge in 60 seconds

**Hosted demo:** `<add the Render URL here after deploying; see docs/DEPLOY.md>`. No Anthropic key and no PayPal account needed. Each browser gets a private session.

1. **Inbox → Review 6 with Claude.** Six real-looking supplier invoices (photos; Spanish and English) are read and checked. Open **Pescados Bahía**: the hake price went from €11.90 to €13.80/kg, so withhold **€29.26**.
2. **Payment run → Plan this week's payments.** The agent's tool calls stream in, and the plan pays **€2,222.68 of the €2,500 cap**: it captures a €23.15 early-payment discount, defers one invoice and never pays the duplicate.
3. **Approve & pay.** A real **PayPal Payouts** batch goes out (sandbox); watch it go `PENDING → SUCCESS` with its batch and item ids.
4. **Reorder → Let the agent restock → Approve & pay.** The agent creates a PayPal checkout and verifies it with the toolkit's `get_order`; only your approval captures it.
5. **Ledger.** AG Grid + AG Charts dashboard, **Reconcile with PayPal**, and an audit log of every PayPal call.

In the public demo, Claude's readings and agent runs are **replays of recorded real runs**: the tool calls Claude made, re-executed live against the real rules and the real PayPal sandbox. Every screen says so. To see Claude live, run it locally with your key (below). See [docs/RECORDING.md](docs/RECORDING.md) for the full click path.

## What only this entry does

| | |
|---|---|
| **Three-way match before any payment** | Invoice line ↔ signed delivery note (quantity) ↔ price history (unit price, 2% tolerance), plus arithmetic, duplicates (in history and in the inbox), unknown supplier, changed payment details, discount windows and due dates. Each finding carries its evidence and the exact euros to withhold (`src/lib/checks.ts`, unit tests on the six samples and edge cases). |
| **Pay the part that's right, hold the part that isn't** | Partial payments withhold only the flagged lines incl. VAT, and Claude drafts the credit-note request in the supplier's language with the same numbers. |
| **The payee never comes from the document** | The PayPal receiver comes from the supplier directory. An invoice asking to be paid somewhere new is held as *payment details changed*, the classic invoice fraud. |
| **Agents propose, the owner approves, PayPal pays** | No agent tool can pay: the planner can only propose; the purchasing agent's PayPal toolkit is allowlisted to read-only `get_order`. Amounts are recomputed in code at approval time, against the current state and the cash cap. |
| **A keyless, multi-user public demo** | Replays real Claude runs with live tools and live PayPal sandbox calls, with per-visitor sessions. It falls back to clearly labelled deterministic rules when a judge goes off-script. |

## The six sample invoices (and what Supplora Pay catches)

| Supplier | Issue built into the document | Outcome |
|---|---|---|
| Huerta del Guadalhorce (produce, ES) | `6 kg × €4.20` printed as `€28.20` | Pay partial: withhold **€3.12** (€3.00 + 4% VAT) |
| Pescados Bahía (fish, ES) | Hake at €13.80/kg vs €11.90 on the last 3 invoices | Pay partial: withhold **€29.26** (14 kg × €1.90 + 10% VAT) |
| Cárnicas Hermanos Sanz (meat, ES) | 12 kg of presa invoiced, 10 kg on the signed delivery note AL-3307 | Pay partial: withhold **€40.70** |
| Green Valley Dairy (EN) | "Payment reminder · copy" of an invoice already paid on 9 Oct | **Hold** €274.71 (duplicate) |
| Atlantic Wine & Spirits (EN) | 2/10 net 30 terms | Pay **€1,134.34 by 24 Oct** instead of €1,157.49: saves **€23.15** |
| CleanPro (EN) | none | Pay in full |

With the default €2,500 cash cap, the payment agent pays the three invoices due before the next run, plus Atlantic Wine early to capture the discount, and defers Cárnicas Sanz (due 30 Oct): **€2,222.68**.

![Findings](docs/screenshots/devpost/02-findings.png)

---

## How PayPal is used

All PayPal calls are server-side and sandbox-only: the app refuses any non-sandbox base URL. Credentials never reach the browser. Every write carries a `PayPal-Request-Id` idempotency key, and every call is written to the audit log (method, endpoint, status, resource id, debug id, never credentials).

| Need | PayPal product | Calls | How |
|---|---|---|---|
| Pay suppliers in one batch after approval | **Payouts** | `POST /v1/payments/payouts`, `GET /v1/payments/payouts/{id}` (polled until final) | REST (`src/lib/paypal.ts`): the toolkit has no Payouts tool |
| Agent checkout at a supplier's store | **Orders v2** | `POST /v2/checkout/orders` (intent `CAPTURE`, items, VAT breakdown, EUR) | REST: the toolkit's `create_order` (1.11.0) only accepts USD |
| The agent verifies its checkout; the approval re-checks it; the ledger reconciles it | **Orders v2 via the PayPal Agent Toolkit** | `get_order` | **`@paypal/agent-toolkit` MCP server** |
| Owner approval: pay with the card on file | **Vault v3 + Orders v2** | `POST /v3/vault/setup-tokens` → `POST /v3/vault/payment-tokens` (once); `confirm-payment-source` → `capture` | REST, only in the owner's approval route |
| Reconcile the ledger with the account | **Transaction Search via the toolkit** | `list_transactions` | toolkit; needs the app's *Transaction search* permission (otherwise PayPal answers 403 and the app says so) |
| Public demo housekeeping | **Payouts** | `POST /v1/payments/payouts-item/{id}/cancel` | REST, demo mode only (see docs/DEPLOY.md) |
| Authenticate | OAuth 2.0 | `POST /v1/oauth2/token` (cached) | REST |

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

PayPal Payouts sends money to a PayPal account, identified here by email. A supplier without a PayPal account at that address gets an `UNCLAIMED` payout: PayPal holds the money and returns it to the sender after 30 days unless the supplier signs up. That is what the sandbox shows here, because the demo payees are placeholder `.example` addresses (set `PAYPAL_PAYOUT_RECEIVER_OVERRIDE` to a sandbox personal account to see `SUCCESS`).

For production, onboarding would take:

- collect each supplier's PayPal receiving email (or PayPal ID) **once**, through a supplier-side confirmation step, never from an invoice;
- verify it, for example with a €0.01 test payout the supplier confirms;
- store it in the supplier directory; Supplora Pay already holds any change of payment details as suspected fraud;
- get the restaurant's live business account approved for Payouts by PayPal, and fund its balance;
- keep a bank-transfer path for suppliers who will not use PayPal. That path is outside this demo.

## How Claude is used

Model `claude-opus-5-5` via the official `@anthropic-ai/sdk`, `output_config.effort: "medium"`, adaptive thinking with `display: "updates"` for progress notes, and the server-side refusal fallback (`fallbacks: "default"`).

| Job | Technique | Code |
|---|---|---|
| Read any supplier document (photo or PDF, Spanish or English) | Vision + structured output: `messages.parse` with a Zod schema. Claude transcribes **exactly what is printed** (it must not fix errors), maps the supplier and every line to the directory, and reports things only visible on the document (a "copy/reminder" stamp, new payment details). | `src/lib/review.ts` |
| Verify | **Not Claude:** deterministic rules in integer cents; every finding carries its evidence. | `src/lib/checks.ts` |
| Plan the payment run | Tool-runner agent: `get_open_invoices`, `get_cash_position`, `get_supplier`, `propose_payment_plan` (validates the cap, holds, discount windows and completeness, computes every amount in code, returns errors for the agent to fix), `request_approval`. | `src/lib/planner.ts` |
| Restock | Tool-runner agent: `check_inventory`, `browse_store`, `create_checkout` (prices from the catalog, never from the model; enforces the spending limit), **`get_order` (PayPal Agent Toolkit)**, `submit_for_approval`. | `src/lib/restock.ts` |
| Ask for credit notes | `messages.parse` → `{subject, body}` in the supplier's language, only from the facts provided. | `src/lib/disputes.ts` |

"Disputes" in this app means **credit-note request emails to suppliers**. It does not use PayPal's Disputes API (that API is for buyer disputes on PayPal transactions, a different problem).

**Recorded runs for the keyless demo.** Run with `RECORD_DEMO=1` and real keys, and the app records Claude's real outputs to `src/data/recorded/`: invoice readings (checked against each sample's SHA-256), each agent turn's notes and tool calls (with a fingerprint of the inputs), and the credit-note emails. With `DEMO_MODE=1` the app replays them: Claude is never called, but every recorded tool call executes live against the real rules and the PayPal sandbox. If a judge changes the inputs (another cash cap, an override), the demo says so and uses a deterministic planner or buyer with the same rules and tools instead (`src/lib/agent-run.ts`).

### Guardrails (human in the loop by design)

- **Agents never move money.** No agent tool confirms, captures or pays. Payouts and captures happen only in the owner's approval routes, and the toolkit's `pay_order` is never enabled.
- **Amounts are computed in code**, not by the model. They are re-validated at approval against the current state, the cash cap and the open discount window.
- **Payment destinations come from the supplier directory, never from the document.** Unknown suppliers, duplicates and changed payment details are held.
- **Spending limits** (cash cap, restock limit) are enforced by the tools *and* again at approval.
- Sandbox only; secrets only on the server; same-origin check on every write; uploads type-checked by magic bytes and size-limited; per-session and hourly caps on PayPal writes in the public demo.

![Agentic reorder](docs/screenshots/devpost/06-restock-checkout.png)

## Ledger: AG Grid + AG Charts (Community)

`/ledger` is the owner's dashboard. It uses only the free, MIT-licensed Community editions, so there is no Enterprise feature, licence key or watermark.

- **Theming:** Quartz re-skinned to the app's "ledger on warm paper" palette (`src/components/client/ag-theme.ts`), including the cell-change flash colour.
- **Custom widgets:** status pills, severity dots, a **findings tooltip** that shows the evidence behind every flag, an in-cell "saved" bar, due dates with relative labels, PayPal id cells, and a reconciliation grid with match chips.
- **Layout:** column groups (Invoice / Amounts / PayPal), supplier pinned left for narrow screens, a filter-aware pinned **totals row**, a live subtotal strip, and CSV export.
- **Cross-filtering:** an AG Charts stacked bar ("where the money stands, by supplier") is recomputed from the rows that pass the grid's filters. Clicking a supplier's bar filters the grid, just as the status chips do (AG Grid external filters).

AG Studio (and its Studio Agent Framework) was evaluated and not used: it is a commercial product (trial key or watermark), its AI module needs an AG Studio AI licence, and it needs a live LLM, which conflicts with a keyless public demo.

![Ledger](docs/screenshots/devpost/07-ledger-grid.png)

## Judging criteria map

| Criterion | Where to look |
|---|---|
| **Technical implementation** | Integer-cent rules engine with tests (`checks.ts`), Claude tool-runner agents with validation tools, PayPal Payouts / Orders v2 / Vault v3 over REST with idempotency + audit, the PayPal Agent Toolkit as an in-process MCP server behind a tested allowlist, reconciliation, per-session demo state, record/replay of real agent runs. |
| **Design** | One coherent UI from inbox to ledger, an agent timeline that shows every tool call, a plan-vs-cash-cap view, and the AG Grid + AG Charts ledger. |
| **Impact** | Overcharges, short deliveries and duplicates are caught *before* paying; discounts are captured. It is built on a product already used daily in a real restaurant. |
| **Innovation** | Three-way match + agentic payments with a hard human-approval boundary. Payees never come from documents. A keyless public demo that replays real Claude runs against live tools. |
| **Presentation** | The hosted demo, [docs/RECORDING.md](docs/RECORDING.md), Devpost screenshots in `docs/screenshots/devpost/` with [captions](docs/screenshots/devpost/CAPTIONS.md). |
| **Best Use of PayPal + AI** | Claude reads, checks and plans; PayPal Payouts pays only what the rules and the owner approve. |
| **Best Use of Agentic Commerce** | The purchasing agent shops supplier stores with PayPal Orders v2 checkouts and verifies them with the PayPal Agent Toolkit, within a limit, and cannot capture. |

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
  ├─ restock      → Claude tool runner → create_checkout (REST Orders v2, EUR)
  │                                    → get_order (PayPal Agent Toolkit, MCP, allowlisted)
  ├─ restock/[id] approve (owner) → toolkit get_order re-check → Vault token → confirm → capture
  ├─ reconcile    → toolkit get_order + list_transactions, REST Payouts GET (read-only)
  └─ disputes     → Claude messages.parse | demo: recorded draft → credit-note email
  ▼
State: .data/state.json (local) · per-session memory (Render) or Redis (Vercel) · audit log
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

### Sandbox notes

- **Currency:** EUR everywhere (verified in the sandbox for Payouts and Orders).
- **Payout receivers** use the reserved `.example` domain (`src/data/seed.ts`), so items end `UNCLAIMED` (see "Payouts needs suppliers with PayPal accounts" above).
- **Card on file:** the first approved order vaults PayPal's public sandbox test card `4012 0000 7777 7777` with Vault v3; after that only the vault token is used. Storefront orders settle to the sandbox app's own merchant account. In production each supplier would be its own PayPal merchant (for example via PayPal Commerce Platform, with `payee` set per store).
- **Business date:** the samples are dated around Friday 16 Oct 2026, so the demo uses that as "today" (override with `DEMO_TODAY`).

### Evidence from real sandbox runs

| What | Ids |
|---|---|
| 20 Oct 2026, recorded run (live Claude): payout batch, 4 approved payments (€2,222.68) | batch `P3BHMU5TBZKJY` → `SUCCESS`; items `TAQJ49F3CVHLS`, `KQ4M6EQZFC7BJ`, `MY5ZJQRW7UXGC`, `DCFRTAWVE9FA4` ended `UNCLAIMED`, then were cancelled (funds returned) |
| 20 Oct 2026: agent checkout at CleanPro (€144.96) | order `7K0802515N435435N` `CREATED` → verified with toolkit `get_order` → re-checked at approval → vault-token confirm → capture `67D93304JG2552323` `COMPLETED` |
| 20 Oct 2026: reconciliation | 5/5 match (4 payout items over REST, 1 order via toolkit `get_order`); `list_transactions` → 403 until Transaction Search is enabled on the app |
| 16 Oct 2026: earlier runs | batches `RKYHUPDKCFCKC`, `2E9W84LASKJY6` → `SUCCESS`; order `9YE76279V08301647` → capture `7H155397J75490001` `COMPLETED` |

## Quality checks

```bash
npm test          # 20 tests: rules engine on the six samples, edge cases and money helpers (10), partial-pay guard (5), PayPal Agent Toolkit allowlist against the real package (5)
npm run typecheck # next typegen + tsc
npm run lint
npm run build
```

## Project structure

```
src/app/(app)/           overview, inbox, review, payments, disputes, reorder, ledger
src/app/store/           simulated supplier storefronts (merchant side)
src/app/api/             route handlers (review, payment-run, approve, payouts, restock, store, disputes, reconcile, reset, health)
src/proxy.ts             demo mode: per-visitor session cookie
src/lib/checks.ts        deterministic review rules (+ checks.test.ts)
src/lib/review.ts        Claude vision extraction (live / recorded)
src/lib/planner.ts       payment-run agent
src/lib/restock.ts       purchasing agent + Orders v2 checkout + toolkit verification
src/lib/paypal.ts        PayPal REST client (OAuth cache, idempotency, audit, demo write limits)
src/lib/paypal-toolkit*.ts  PayPal Agent Toolkit MCP wiring + allowlist policy (+ tests)
src/lib/reconcile.ts     ledger ↔ PayPal reconciliation
src/lib/agent-run.ts     live / record / replay driver for the agents
src/lib/state.ts, session.ts   state store (file, per-session memory, Redis) and demo sessions
src/data/seed.ts         supplier directory, price history, delivery notes, stores, inventory
src/data/recorded/       real Claude outputs replayed by the public demo
docs/                    DEPLOY.md, RECORDING.md, screenshots
```

## Limitations

- Single restaurant, no authentication: a real deployment needs a database, users and roles. The public demo isolates visitors by session cookie only.
- Delivery notes, price history and inventory are seeded; in production they come from Supplora's ERP integration.
- Supplier payees are placeholders; onboarding suppliers' PayPal accounts is described above, not built.
- Transaction Search needs the PayPal app's *Transaction search* permission; without it, reconciliation checks each order and payout one by one.

## Who built it

Antonio González Fernández, Business Administration + Data Science student (CUNEF, Madrid), founder of Supplora.

## License

MIT, see [LICENSE](LICENSE).
