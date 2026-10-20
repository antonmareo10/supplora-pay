# Devpost gallery: captions

All images are 1500×1000 (3:2), captured in Chromium with no cursor, from real runs on 20 Oct 2026. Images marked **demo** come from the keyless public demo (`DEMO_MODE=1`), which replays recorded Claude runs while the tools and PayPal sandbox calls run live; the "Public demo" banner is visible where the page header is in frame. Images marked **live** come from the same flow run with live Claude (`claude-opus-5-5`) and the PayPal sandbox.

| # | File | Caption | Source |
|---|---|---|---|
| 1 | `01-catches.png` | Before anything is paid, Supplora shows what it caught: a 16% hake price rise, 2 kg of meat never delivered, an invoice already paid, and a 2% early-payment discount. | demo |
| 2 | `02-findings.png` | Three-way match: Claude reads the invoice photo; rules in integer cents compare it with the price history and signed delivery note, then withhold exactly €29.26. | demo |
| 3 | `03-plan-vs-cap.png` | The payment agent's plan: €2,222.68 of a €2,500 cash cap, the discount captured, one invoice deferred, the duplicate never paid. | demo |
| 4 | `04-approval.png` | Nothing is paid until the owner approves, per invoice or all at once, as one PayPal Payouts batch. | demo |
| 5 | `05-payouts-success.png` | Approved: a real PayPal Payouts batch (sandbox) reaches SUCCESS, with the batch, item and transaction ids. | live |
| 6 | `06-restock-checkout.png` | Agentic commerce: the purchasing agent built a PayPal checkout within a €150 limit, but it cannot pay; only the owner's approval captures it. | demo |
| 7 | `07-ledger-grid.png` | The ledger in AG Grid + AG Charts (Community): click a supplier's bar to filter the grid; the totals row follows every filter. | live |
| 8 | `08-audit-log.png` | Every PayPal call is audited: Payouts, Orders v2, Vault v3, and PayPal Agent Toolkit calls over MCP. | live |

## More (optional)

| File | Caption | Source |
|---|---|---|
| `more/agent-timeline.png` | The payment agent's tool calls (replay of a real Claude run): read invoices, check the cap, look up a supplier, validate the plan, ask for approval. | demo |
| `more/restock-agent-toolkit.png` | The purchasing agent verifies its own checkout with `get_order` from the official PayPal Agent Toolkit, allowlisted read-only. | demo |
| `more/restock-captured.png` | After approval: the order is confirmed with the card on file (PayPal Vault token) and captured. | demo |
| `more/ledger-findings-tooltip.png` | Hover a finding to see the evidence behind it, straight in the grid. | live |
| `more/reconcile.png` | Reconcile with PayPal: every payout item and order checked against PayPal, read-only. | live |
| `more/credit-note.png` | Claude drafts the credit-note request in the supplier's language, with the same numbers as the check. | demo |
