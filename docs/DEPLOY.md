# Deploying the keyless public demo

The hosted demo runs with `DEMO_MODE=1`:

- **No Anthropic key is needed or used.** Claude's invoice readings, agent runs and credit-note emails are replayed from recordings of real runs (`src/data/recorded/`, written by the app itself with `RECORD_DEMO=1`). Even if `ANTHROPIC_API_KEY` is set, demo mode never calls the API.
- **PayPal is live (sandbox).** Every payout, checkout, vault token, capture and toolkit call hits the PayPal sandbox with the app's own sandbox REST credentials, which stay on the server.
- **Every visitor gets a private session** (an httpOnly cookie set by `src/proxy.ts`), so judges clicking through at the same time never see each other's invoices or payments. *Reset demo* clears only your own session.
- Uploads are off; the six bundled sample invoices are the demo.
- PayPal writes are capped per hour per session, per client IP and in total (`src/lib/write-limits.ts`). The per-IP cap reads the client IP from the host's forwarding headers, which some hosts let clients set; the per-session and total caps do not depend on headers.

## Before deploying: give the sandbox account enough test money

Every full demo run sends **€2,222.68** in payouts. Demo payees are placeholder addresses, so PayPal processes the batch (batch `SUCCESS`) but each item waits `UNCLAIMED`, and PayPal would keep the money for 30 days. Demo mode gives it back (`src/lib/demo-sweep.ts`):

- every payout batch is **registered when PayPal accepts it**, in a registry shared by all sessions (process memory, or Redis when `KV_REST_API_*` / `UPSTASH_REDIS_REST_*` are set), so it is tracked even if the visitor closes the tab before the batch is polled;
- a **server-side sweep** reads each registered batch older than 20 minutes from PayPal and cancels its `UNCLAIMED` items (`POST /v1/payments/payouts-item/{id}/cancel`, with a `PayPal-Request-Id`), which returns the money at once. A batch leaves the registry once none of its items can change; PayPal errors other than "already cancelled / not found" are retried on the next sweep;
- sweeps never block a request: they run after the response (`after()` from `next/server`) when the health check is hit, when a page is rendered and after an approval (at most once a minute per server process), and after *Reset demo* for that session's payouts, whatever their age;
- if PayPal still answers `INSUFFICIENT_FUNDS`, other sessions' unclaimed payouts are cancelled first and the payout is retried once.

The sandbox's cancel endpoint is not always reliable: on 20 Oct 2026 it answered `500 INTERNAL_SERVICE_ERROR` for a while (those items are retried on later sweeps).

So use a **dedicated sandbox business account with a large EUR balance** for the hosted demo:

1. developer.paypal.com → **Testing Tools → Sandbox Accounts → Create account** → *Business*, country **Spain**. Set the PayPal balance as high as the form allows.
2. **Apps & Credentials → Sandbox → Create App**, linked to that business account. Copy its client id and secret.
3. In the app's settings, under **Features**, enable **Transaction search**. The ledger's *Reconcile with PayPal* calls `list_transactions` through the PayPal Agent Toolkit, and without this permission PayPal answers 403 (the app says so and still checks every order and payout item one by one).
4. Optional: create a sandbox *personal* account and put its email in `PAYPAL_PAYOUT_RECEIVER_OVERRIDE`. Payouts then end `SUCCESS` instead of `UNCLAIMED`. They still leave the business balance, and payouts that succeeded cannot be cancelled back, so a large balance matters even more.

## Environment variables

| Variable | Render / Vercel value | Notes |
|---|---|---|
| `DEMO_MODE` | `1` | Required for the public demo. |
| `PAYPAL_CLIENT_ID` | sandbox app client id | Secret, server-only. |
| `PAYPAL_CLIENT_SECRET` | sandbox app secret | Secret, server-only. |
| `PAYPAL_BASE_URL` | `https://api-m.sandbox.paypal.com` | The app refuses any non-sandbox URL. |
| `PAYPAL_PAYOUT_RECEIVER_OVERRIDE` | optional sandbox personal email | See step 4 above. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Vercel: required (Upstash Redis). Render: optional | Session store for serverless, and the demo's payout registry. On Render, without them, sessions and the registry live in process memory and are lost on a restart or deploy (payouts sent before a restart then wait the full 30 days); with them, both survive restarts. `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work. |
| `ANTHROPIC_API_KEY` | **leave unset** | Not used in demo mode. |
| `NODE_VERSION` | `24` (Render) | Node 22.18+ works. |

Never commit these. `.env*` files are git-ignored except `.env.example`.

## Option A: Render (recommended for the judged demo)

A Render web service is one long-running Node process, so the demo's in-memory sessions just work.

1. Push the branch you want to deploy to GitHub (for example `master` after merging).
2. Render Dashboard → **New → Blueprint** → pick `antonmareo10/supplora-pay`. Render reads `render.yaml`.
3. When Render asks for the `sync: false` variables, paste `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and, optionally, `PAYPAL_PAYOUT_RECEIVER_OVERRIDE`.
4. **Apply**. The build runs `npm ci && npm run build` and the start command is `npx next start -H 0.0.0.0 -p $PORT`. The health check is `/api/health`, which returns `{"ok":true,"demo":true,"claude":"replay","paypal":true}`.
5. Open the URL and click through `docs/RECORDING.md` once to check it end to end.
6. **Plan:** `render.yaml` uses `plan: free`. Free services sleep after 15 idle minutes (the first visit then takes about a minute), and sleeping drops every in-memory demo session. Before judging (1–15 Dec 2026), switch the service to **Starter** in Settings → Instance Type.

### Render Workflows: could they be used legitimately?

Yes, but they are not wired in, and the trade-off is honest to state. Render Workflows went GA on 1 Sep 2026, with a TypeScript SDK (`@renderinc/sdk`). Tasks are plain async functions; a web service can start them with `new Render().workflows.startTask(...)`. They have no free tier (they are billed per active CPU-hour) and no built-in scheduling (a Render Cron Job, minimum $1/month, would trigger them).

Two uses would make sense for this app:

- a **payout-status task**: started on approval, it polls `GET /v1/payments/payouts/{id}` until the batch is final, instead of the browser polling;
- a **weekly payment-run task**: a cron starts it, it builds the plan with Claude and leaves it waiting for the owner's approval.

Either needs the state store moved out of the web process (Postgres or Key Value), because today's demo sessions live in the web service's memory. A project can win only one sponsor prize, so decide between the AG Grid and the Render prize before investing here.

## Option B: Vercel

Serverless functions do not share memory, so a demo session needs a shared store:

1. Vercel → **Add New → Project** → import `antonmareo10/supplora-pay`. The framework is detected as Next.js.
2. **Storage → Marketplace → Upstash for Redis** (free tier) → connect it to the project. This adds `KV_REST_API_URL` / `KV_REST_API_TOKEN`, or the `UPSTASH_REDIS_REST_*` pair; the app accepts either.
3. **Settings → Environment Variables**: `DEMO_MODE=1`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_BASE_URL`, optionally `PAYPAL_PAYOUT_RECEIVER_OVERRIDE`.
4. **Deploy**. `vercel.json` pins the functions to Frankfurt (`fra1`). Agent routes declare `maxDuration = 300`, which Hobby allows with Fluid compute.
5. Click through `docs/RECORDING.md` once.

Limitations on Vercel: the payout registry is in Redis, so every instance sees every batch, but Vercel sends no health-check pings, so sweeps run only when visitors load pages or approve payouts; and the write caps are counted per instance. Rely on a well-funded sandbox account (see above). Concurrent requests for the *same* session on two instances can race; that's fine for one judge clicking through, not for production.

## Local demo mode (what the hosted demo does)

```bash
npm run build
DEMO_MODE=1 npx next start -p 3300      # PowerShell: $env:DEMO_MODE="1"; npx next start -p 3300
```

## Re-recording the Claude runs

Only needed if a prompt, a sample invoice or the seed data changes (each recording carries a fingerprint and replays only when the inputs match; the inputs differing falls back to a labelled deterministic planner or buyer). With real keys in `.env.local`:

```bash
npm run build
RECORD_DEMO=1 npx next start -p 3300
```

Then click through the demo once: *Review 6 with Claude*, draft the four credit-note emails, *Plan this week's payments*, *Approve & pay*, draft the two paid-invoice emails again, *Let the agent restock*. The app rewrites `src/data/recorded/*.json`. A full recording costs about $0.30–0.40 of Claude usage (invoice readings are reused from `.data/claude-cache` when present).
