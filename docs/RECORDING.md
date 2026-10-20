# Recording the demo video

A screen capture of the real app, end to end, in about 3 minutes. Every step below was run in a real browser (Chromium, 1500×1000 window) on 20 Oct 2026. Steps 1–6 and 8–13 ran on the demo build. Step 7, the full €2,222.68 payout, ran with live Claude: by then the demo's sandbox account had run out of test funds (smaller demo payouts went through). See "Before you hit record" below.

## 0. Set up a clean state

Either the hosted demo (any fresh browser profile or incognito window gets its own clean session) or locally:

```bash
npm run build
DEMO_MODE=1 npx next start -p 3300        # keyless replay of Claude, live PayPal sandbox
# or, with your keys in .env.local, live Claude:
npx next start -p 3300
```

PowerShell: `$env:DEMO_MODE="1"; npx next start -p 3300`.

**Reset:** sidebar → **Reset demo** → confirm. This clears your session's invoices, plans and orders. In demo mode it also returns your session's unclaimed sandbox payouts to the demo account. Locally without demo mode you can also stop the server and delete `.data/state.json`.

Before you hit record:

- **Check that the sandbox account has test funds.** A full run pays €2,222.68. If *Approve & pay* says `INSUFFICIENT_FUNDS`, see docs/DEPLOY.md → "give the sandbox account enough test money".
- Use a 1500×1000 (3:2) browser window at 100% zoom, light mode. Hide bookmarks and extensions.
- Pick the wording on screen that matches the mode. In demo mode the agent logs say **Demo replay of a real Claude run**; in live mode Claude really runs, and a step takes 20–30 s instead of about 7 s.

## 1. Click path (≈ 3 min)

| # | Where | Click | What to show / say |
|---|---|---|---|
| 1 | `/inbox` | **Review 6 with Claude** | Six supplier invoices (photos, Spanish and English) are read one after another; each card gets a recommendation. |
| 2 | `/inbox/doc-02` (Pescados Bahía) | open the card | **Findings with the numbers**: hake at €13.80/kg vs €11.90 on the last three invoices, 14 kg, so withhold €29.26 incl. VAT. The signed delivery note AL-5521 is matched. |
| 3 | `/inbox/doc-04` (Green Valley Dairy) | open the card | "Payment reminder · copy" of an invoice already paid on 9 Oct → **Hold** (duplicate). |
| 4 | `/payments` | keep the cash cap at **2500**, click **Plan this week's payments** | The agent log streams the tool calls: `get_open_invoices`, `get_cash_position`, `get_supplier`, `propose_payment_plan` (validated in code), `request_approval`. |
| 5 | `/payments` | scroll to the plan | **€2,222.68 of the €2,500 cap**; Atlantic Wine paid early saves €23.15; Cárnicas Sanz deferred; Green Valley never paid. "Nothing is paid until you approve." |
| 6 | `/payments` | **Approve & pay 4 · €2,222.68** | The owner approves. One **PayPal Payouts** batch goes out. |
| 7 | `/payments` → *Payout batches* | wait about 30–60 s | The batch moves `PENDING → PROCESSING → SUCCESS`; the **batch id** and the four **payout item ids** are visible. Items show `UNCLAIMED` because the demo payees are placeholder addresses (explained on screen). |
| 8 | `/disputes` | **Draft the email with Claude** on Pescados Bahía | A credit-note request in Spanish, with the exact figures and the payout batch id. *Copy* / *Open in mail app* / *Mark as sent*. |
| 9 | `/reorder` | keep the limit at **150**, click **Let the agent restock** | The agent checks stock, browses both stores, creates a **PayPal Orders v2** checkout (€144.96, `CREATED`) and verifies it with **`get_order` from the PayPal Agent Toolkit**. |
| 10 | `/reorder` | point at the proposal | "The agent cannot pay": the toolkit's `pay_order` is never enabled, and capture only exists in the owner's approval route. |
| 11 | `/reorder` | **Approve & pay €144.96** | Re-checked on PayPal through the toolkit, confirmed with the vaulted card (Vault v3), captured: `COMPLETED` with a capture id. |
| 12 | `/ledger` | **Reconcile with PayPal**, then hover a finding in the grid, click a bar in the chart | AG Grid + AG Charts dashboard: totals, withheld, savings. The reconciliation checks every payout item and order against PayPal. |
| 13 | `/ledger` → *Audit log* | **PayPal API calls** tab | Every call with method, endpoint, status, resource id, idempotency key; toolkit calls carry the *Agent Toolkit · MCP* badge. |

## 2. Re-takes

- To redo the whole take: **Reset demo**, then start at step 1.
- To redo only the restock: **Reset demo** is the simplest. Or decline the proposal and run the agent again; in demo mode, a stock level that differs from the recording uses the labelled deterministic buyer.
- In demo mode, changing the cash cap or overriding a decision makes the planner fall back to the deterministic rules. The log says so. Keep cap 2500 and the default decisions for the take.
