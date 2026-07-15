# ShopTalk

![CI](https://github.com/syedarman1/ShopTalk/actions/workflows/ci.yml/badge.svg)

**Live demo:** **[shop-talk-pied.vercel.app](https://shop-talk-pied.vercel.app)** — a self-contained walkthrough with **sample data**
(no real store, no backend). Your real store is reached only through Poke, over iMessage.

**Text your Shopify store a question in plain English and get a real answer back — over iMessage.**

> *"How much did I sell today?"* → *"$1,240 across 18 orders today."*
> *"Show my last 5 orders."* → a tidy list of order numbers, customers, and totals.

ShopTalk is a small backend that connects an AI texting assistant to a Shopify
store, so a busy shop owner can check on their business by sending a text — no
dashboard, no login, no SQL. It's purpose-built for **Shopify entrepreneurs**:
the people who live in their store's numbers but don't want to open the admin
panel ten times a day.

---

## Who this is for

Solo founders and small teams running a Shopify store who want to *ask* their
store things the way they'd text a co-founder — "what's selling?", "any orders I
haven't shipped?", "who are my repeat customers?" — and get an answer in seconds,
from their phone, without opening anything.

Reads are the default — asking questions can never change your store. Two
write actions exist (cancel+refund an order, adjust inventory), and each one
requires **texting back a one-time confirmation code** before anything
executes: a misread text still can't change anything; only a deliberate
confirmation can.

---

## First, two terms (in case they're new)

**What's "Poke"?** [Poke](https://poke.com) (by The Interaction Company of
California) is a personal AI assistant you text like a friend — over **Apple
Messages (iMessage), SMS, WhatsApp, Telegram, and RCS**, with no separate app to
open. On its own it handles things like email, calendar, and reminders. Connect
it to *external tools* and it can do far more — and the way you connect those
tools is **MCP**.

**What's "MCP"?** The [Model Context Protocol](https://modelcontextprotocol.io)
is an open standard (think "USB-C for AI assistants") that lets an AI connect to
an outside tool or data source in a consistent way. A program that speaks MCP
exposes a set of **tools** the AI can call. Poke acts as an **MCP host**: you add
an integration (a built-in "recipe" or any custom MCP server URL), Poke
discovers the tools that server exposes, and it calls them when a text needs one.
**ShopTalk is one such custom MCP server** — it exposes seventeen tools
backed by the Shopify Admin API, and Poke is the client that calls them when you
text a question about your store.

So the flow is:

```
You (iMessage)  ──>  Poke (AI assistant)  ──MCP──>  ShopTalk  ──>  Shopify Admin API
```

You text Poke → Poke decides which ShopTalk tool answers your question → ShopTalk
queries Shopify and returns the data → Poke replies in plain English.

---

## What you can ask (the seventeen tools)

| Tool | The question it answers |
|------|--------------------------|
| `list_stores` | "Which stores are connected?" |
| `get_sales` | "How much did I sell today / yesterday / in the last 7 or 30 days?" (revenue, orders, average order value — per store or all stores combined) |
| `get_daily_briefing` | "How's my store doing?" — yesterday's sales, unfulfilled orders, and low-stock items in one call (built for a scheduled morning text) |
| `get_best_sellers` | "What's actually selling?" — top products by units sold over a period |
| `get_disputes` | "Any open chargebacks?" — sweeps recent orders' dispute records (needs only `read_orders`; add `read_all_orders` to see past the 60-day window) |
| `get_payouts` | "When does my money land?" — Shopify Payments balance + recent payouts |
| `get_refunds` | "Any refunds lately?" — recently refunded orders |
| `run_query` | Anything else — a read-only Admin GraphQL escape hatch, validated locally against the store's schema before executing (mutations rejected) |
| `get_schema` | "What fields does Order have?" — schema lookup so `run_query` never guesses |
| `get_shop_info` | Store basics — name, domain, currency, timezone, plan |
| `propose_cancel_refund` | "Cancel #2176 and refund it" — **stages only**: returns a summary + one-time code; nothing executes |
| `propose_inventory_adjust` | "Set the hoodie stock down 3" — **stages only**, same code ritual |
| `confirm_action` | Executes a staged action — **only** when you text back its code (single-use, 15-min expiry) |
| `get_orders` | "Show my recent orders" / "anything unfulfilled?" |
| `get_order` | "What's in order #1042?" |
| `search_products` | "Find my hoodie" / "what do I sell?" |
| `search_customers` | "Who are my repeat customers?" |

Fourteen tools are pure reads. The two write actions never execute on first
ask: the `propose_*` tool stages the change and returns a one-time code, and
only your reply containing that code (via `confirm_action`) executes it —
codes are single-use and expire in 15 minutes. The `run_query` escape hatch
rejects mutations outright; writes have exactly one, deliberate door.

---

## Under the hood

ShopTalk is a production-shaped full-stack project. Highlights:

- **MCP server over streamable HTTP** — implements the Model Context Protocol so
  any MCP client (Poke, Claude, etc.) can use it. Stateless transport: a fresh
  server instance per request, no session state to leak or grow.
- **Modern Shopify auth** — Shopify removed static API tokens in 2026, so
  ShopTalk uses the **OAuth client-credentials grant**: it exchanges an app's
  Client ID/Secret for a short-lived (24 h) access token, **caches it in
  memory per store, and auto-refreshes** before expiry and on a 401.
- **Interactive demo dashboard** — a self-contained Next.js app that renders each
  tool's results (revenue chart, orders, products, customers) from **sample data**,
  so anyone can see how a Poke conversation looks without a Shopify store. No
  backend, no real data — your real numbers only ever go to Poke.
- **Multi-store from day one** — a config-driven registry; queries run per store
  or roll up across all stores, grouping revenue by currency (never summing
  across mismatched currencies).
- **Correctness details that matter** — sales windows are computed in the
  *store's own timezone* (so "today" means the merchant's today, not UTC); large
  result sets surface a "capped" flag instead of silently undercounting.
- **Security-conscious** — reads by default, writes only via texted one-time
  confirmation codes; `/mcp` requires a shared
  secret and **fails closed to loopback-only** when none is set; credentials
  live only in environment variables, never in the repo; the backend surface is
  deliberately tiny (the MCP endpoint plus a health check).
- **Tested & reviewed** — unit tests (Node's built-in runner) for the data layer,
  plus the project was put through multi-agent code review (a local pass and a
  cloud "ultrareview") whose findings — auth hardening, timezone correctness,
  rollup accuracy, a retry bug — were all fixed and re-reviewed.

**Stack:** Node 22 · Express · `@modelcontextprotocol/sdk` · Zod · Shopify Admin
GraphQL · Next.js 14 / React 18 · Tailwind. Backend deployable to Railway/Render/Fly; the demo is hosted on Vercel.

**Architecture at a glance**

```
backend/
  server.js      Express: MCP-over-HTTP at /mcp (auth-gated) + /api/health
  auth.js        /mcp shared-secret check (fails closed to loopback)
  mcp-tools.js   the 17 MCP tools — reads + confirm-gated writes (createMcpServer factory)
  actions.js     staged write actions: one-time codes, TTL, executors
  shopify.js     Admin GraphQL client + OAuth token exchange/cache + read fns
  stores.js      multi-store registry (parses SHOPIFY_STORES)
  test/          unit tests (node --test)
frontend/                self-contained demo (sample data, no backend)
  app/page.js            demo dashboard
  components/            ResultPanel, RevenueChart, PanelUI, ChatPanel, ActivityLog
  lib/demoData.mjs       sample store + scripted Q&A
  lib/useDemo.js         on-demand demo engine
```

This started as **MockBase** (the same real-time MCP + dashboard backbone wired
to a throwaway SQLite database) and was re-pointed at the real Shopify API — the
commit history shows that evolution step by step.

---

## ShopTalk Cloud (multi-tenant — in progress)

There are two ways to run ShopTalk:

- **Self-host (`backend/`)** — one store, your own keys via env vars. Simple,
  private, recommended for a single merchant. This is what the rest of this
  README covers, and it's unchanged.
- **ShopTalk Cloud (`cloud/`)** — one hosted service serving *many* merchants,
  so ShopTalk can be published as a Poke Kitchen template. A merchant installs
  via Shopify OAuth; the App stores only their `.myshopify.com` domain and an
  **AES-256-GCM-encrypted** access token, and binds each request to exactly one
  shop (tenant isolation is verified end-to-end in `cloud/test/mcp.test.js`).
  The tool layer is reused from `backend/` verbatim — one source of truth.

Cloud is under active construction and gated on a public Shopify app + Shopify's
protected-customer-data review. See
[`docs/superpowers/specs/2026-07-08-cloud-multitenant-design.md`](docs/superpowers/specs/2026-07-08-cloud-multitenant-design.md)
and [PRIVACY.md](PRIVACY.md).

The public Shopify app is configured to point at these `cloud/` routes (swap in
your deployed host):

- **App URL:** `https://<cloud-host>/install`
- **Redirect URL:** `https://<cloud-host>/auth/callback`
- **Webhooks** (mandatory + GDPR): `/webhooks/app/uninstalled`,
  `/webhooks/customers/data_request`, `/webhooks/customers/redact`,
  `/webhooks/shop/redact`

Config lives in env (`cloud/.env.example`): the app's Client ID/Secret, the
service's public URL, the install scopes, and `CLOUD_ENC_KEY` (the at-rest token
encryption key — `openssl rand -hex 32`). The SQLite DB belongs on a persistent
volume.

## Run it yourself

**Requirements:** a [Poke](https://poke.com) account (the free tier works), a
Shopify store, and Node 22+.

### 1. Create a Shopify app (client-credentials)
1. In the Shopify **[Dev Dashboard](https://dev.shopify.com)**, create an app under your org.
2. Give it read scopes — `read_orders`, `read_products`, `read_customers`, plus `read_all_orders` for chargeback sweeps and history beyond the 60-day order window; add `write_orders`, `write_inventory`, `read_inventory`, `read_locations` only if you want the confirm-gated write tools (the payments scopes `read_shopify_payments_payouts`/`_accounts` enable `get_payouts`, but some Dev Dashboard app types won't grant `_accounts`) — and **release** the version.
3. Install it on your store and copy the **Client ID** and **Client Secret** (`shpss_…`).
4. Note your store's `*.myshopify.com` domain (Settings → Domains).

### 2. Configure & run the backend
Create `backend/.env` (gitignored — never commit it):
```
PORT=4000
# Single-quote the value so Node's --env-file parser keeps it intact.
SHOPIFY_STORES='[{"key":"main","label":"Main Store","shopDomain":"your-store.myshopify.com","clientId":"your_api_key","clientSecret":"shpss_xxx","apiVersion":"2026-01"}]'
# Shared secret for /mcp. Without it, the endpoint accepts loopback (local)
# requests only — set it to allow remote clients like Poke.
MCP_TOKEN=some-long-random-string
```
```bash
cd backend && npm install && node --env-file=.env server.js   # http://localhost:4000
cd frontend && npm install && npm run dev                      # http://localhost:3000 (demo, sample data)
```
Sanity-check against your real store (read-only): `cd backend && node --env-file=.env smoke.js`

### 3. Connect Poke
Add ShopTalk as an integration — via the CLI:
```bash
npx poke@latest login
npx poke@latest mcp add http://localhost:4000/mcp -n ShopTalk -k <MCP_TOKEN>   # local (tunnel for a public URL)
```
…or from Poke's web app (**Integrations → New**): paste the MCP Server URL and the
key. Either way Poke sends the key as an `Authorization: Bearer <token>` header on
every request, which ShopTalk validates against `MCP_TOKEN`; on connect it
discovers the tools automatically. Then just text Poke a question.

### 4. Optional: a morning briefing text
Poke can run scheduled automations. Once ShopTalk is connected, text Poke:

> "Every morning at 9, send me my ShopTalk daily briefing."

Poke will call `get_daily_briefing` on schedule and text you yesterday's sales,
anything unfulfilled, and what's running low on stock. **Opt-in by design:**
ShopTalk never sends anything on its own — no automation, no messages. You can
also just ask *"how's my store doing?"* any time.

### Deploy (always-on)
Deploy `backend/` to Railway/Render/Fly (Dockerfile included). Set `SHOPIFY_STORES`
and `MCP_TOKEN` as host env vars. Point Poke at `https://<host>/mcp` with
`-k <MCP_TOKEN>` — no tunnel, runs 24/7. Prefer an always-on host: MCP responses
stream over long-lived HTTP connections.

---

## Roadmap

ShopTalk is reads-by-default and confirm-gated for writes — and still growing. What's next:

- **More write actions** — cancel+refund and inventory adjustments shipped behind the propose→confirm ritual; order fulfillment and customer tagging are next, under the same one-time-code gate.
- **Deeper analytics** — sales trend charts (today `get_sales` returns the period total + order count; best-seller ranking shipped as `get_best_sellers`).
- **Flexible time ranges** — custom date ranges beyond the current `today` / `yesterday` / `7d` / `30d`.
- **Larger result windows** — paginate past the current single 250-order page (a `capped` flag already surfaces overflow).

## Tests
```bash
cd backend && node --test
cd frontend && node --test 'test/**/*.mjs'
```
CI runs both suites plus the frontend build on every push.

## License

MIT — see [LICENSE](LICENSE).
