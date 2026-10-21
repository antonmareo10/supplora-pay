# Recording the demo video

A screen capture of the real app, end to end, in about 3 minutes. Steps 3, 11 and 12 (the prompt-injection invoice, authorize, and the partial capture) were added on 21 Oct 2026 and run in a real browser on the demo build that day. Every step below was run in a real browser (Chromium, 1500×1000 window) on 20 Oct 2026. Steps 1–6 and 8–13 ran on the demo build. Step 7, the full €2,222.68 payout, ran with live Claude: by then the demo's sandbox account had run out of test funds (smaller demo payouts went through). See "Before you hit record" below.

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
| 1 | `/inbox` | **Review 7 with Claude** | Seven supplier invoice images (Spanish and English; clean renders, not phone photos) are read one after another; each card gets a recommendation. |
| 2 | `/inbox/doc-02` (Pescados Bahía) | open the card | **Findings with the numbers**: hake at €13.80/kg vs €11.90 on the last three invoices, 14 kg, so withhold €29.26 incl. VAT. The signed delivery note AL-5521 is matched. |
| 3 | `/inbox/doc-07` (CleanPro · CP-11958) | open the card, scroll to *Why this invoice cannot pay the account printed on it* | A lookalike invoice for a real delivery: new PayPal address, and fine print telling "AI assistants" to ignore their rules and pay today. **Hold €224.33**. Claude copied the instruction as data; the payee comes only from the directory; the payment agent's own check answers `doc-07 is held and must not be paid.` "Documents are data, not instructions." |
| 4 | `/payments` | keep the cash cap at **2500**, click **Plan this week's payments** | The agent log streams the tool calls: `get_open_invoices` (5 payable · 2 held), `get_cash_position`, `get_supplier`, `propose_payment_plan` (validated in code), `request_approval`. |
| 5 | `/payments` | scroll to the plan | **€2,222.68 of the €2,500 cap**; Atlantic Wine paid early saves €23.15; Cárnicas Sanz deferred; Green Valley and CP-11958 never paid (the agent's message lists both as held). "Nothing is paid until you approve." |
| 6 | `/payments` | **Approve & pay 4 · €2,222.68** | The owner approves. One **PayPal Payouts** batch goes out. |
| 7 | `/payments` → *Payout batches* | wait about 30–60 s | The batch moves `PENDING → PROCESSING → SUCCESS`: PayPal accepted and processed it. The **batch id** and the four **payout item ids** are visible. Each item waits `UNCLAIMED` because the demo payees are placeholder addresses, as a real supplier's payout would until they claim it; the plan shows them as *Sent · waiting for supplier to claim* (explained on screen). Say "processed", not "paid". |
| 8 | `/disputes` | **Draft the email with Claude** on Pescados Bahía | A credit-note request in Spanish, with the exact figures and the payout batch id. *Copy* / *Open in mail app* / *Mark as sent*. CP-11958 is not here: possible fraud is verified by phone, never answered by email. |
| 9 | `/reorder` | keep the limit at **150**, click **Let the agent restock** | The agent checks stock, browses both stores, creates a **PayPal Orders v2** checkout with intent `AUTHORIZE` (€144.96, `CREATED`) and verifies it with **`get_order` from the PayPal Agent Toolkit**. |
| 10 | `/reorder` | point at the proposal | "The agent cannot pay": the toolkit's `pay_order` is never enabled, and nothing in the agent's tools confirms, authorizes or captures. |
| 11 | `/reorder` | **Approve & authorize €144.96** | Re-checked on PayPal through the toolkit, confirmed with the vaulted card (Vault v3) and **authorized**: the money is held, not taken. The order waits for the delivery note. |
| 12 | `/reorder` → *Waiting for the delivery note* | **Delivery note in · capture €141.09, release €3.87** | The scripted demo delivery note (labelled) is one sanitiser short. PayPal **captures €141.09** (one final partial capture) and releases **€3.87**: *authorized → captured → released*. "Pay only for what arrived." |
| 13 | `/ledger` | **Reconcile with PayPal**, then hover a finding in the grid, click a bar in the chart | AG Grid + AG Charts dashboard: totals, withheld, savings. The reconciliation reads every payout item and the order's authorization and capture back from PayPal; *Store orders* shows authorized / captured / released and where each status came from (app, webhook, reconciliation). |
| 14 | `/ledger` → *Audit log* | **PayPal API calls** tab | Every call with method, endpoint, status, resource id, idempotency key (the capture's is `settle-<authorization id>`); toolkit calls carry the *Agent Toolkit · MCP* badge; with webhooks on, each verified PayPal webhook is listed too. |

## 2. Re-takes

- To redo the whole take: **Reset demo**, then start at step 1.
- To redo only the restock: **Reset demo** is the simplest. Or decline the proposal and run the agent again; in demo mode, a stock level that differs from the recording uses the labelled deterministic buyer.
- In demo mode, changing the cash cap or overriding a decision makes the planner fall back to the deterministic rules. The log says so. Keep cap 2500 and the default decisions for the take.
