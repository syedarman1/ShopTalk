# ShopTalk

**Live demo:** **[shop-talk-pied.vercel.app](https://shop-talk-pied.vercel.app)** — a self-contained walkthrough with **sample data**
(no real store, no backend). The real dashboard runs locally against your store.

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

Today it's **read-only** — safe to text without ever changing your store — and
focused on the questions merchants actually ask. It's built to grow: write
actions (fulfilling orders, adjusting inventory) and richer analytics are the
natural next steps.

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
**ShopTalk is one such custom MCP server** — it exposes six read-only tools
backed by the Shopify Admin API, and Poke is the client that calls them when you
text a question about your store.

So the flow is:

```
You (iMessage)  ──>  Poke (AI assistant)  ──MCP──>  ShopTalk  ──>  Shopify Admin API
```

You text Poke → Poke decides which ShopTalk tool answers your question → ShopTalk
queries Shopify and returns the data → Poke replies in plain English.

---

## What you can ask (the six tools)

| Tool | The question it answers |
|------|--------------------------|
| `list_stores` | "Which stores are connected?" |
| `get_sales` | "How much did I sell today / this week / this month?" (revenue, orders, average order value — per store or all stores combined) |
| `get_orders` | "Show my recent orders" / "anything unfulfilled?" |
| `get_order` | "What's in order #1042?" |
| `search_products` | "Find my hoodie" / "what do I sell?" |
| `search_customers` | "Who are my repeat customers?" |

Every tool today is **read-only** — ShopTalk cannot change, create, or delete
anything in the store, enforced by the API scopes it requests, so a misread text
can never modify your data. Writes are a deliberate next step, added the same
way: one new tool at a time, behind the same MCP interface.

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
- **Security-conscious** — read-only scopes only; `/mcp` and the SSE stream
  require a shared secret and **fail closed to loopback-only** when none is set;
  `/internal/broadcast` is localhost-only; CORS is restricted; credentials live
  only in environment variables, never in the repo.
- **Tested & reviewed** — unit tests (Node's built-in runner) for the data layer,
  plus the project was put through multi-agent code review (a local pass and a
  cloud "ultrareview") whose findings — auth hardening, timezone correctness,
  rollup accuracy, a retry bug — were all fixed and re-reviewed.

**Stack:** Node 22 · Express · `@modelcontextprotocol/sdk` · Zod · Shopify Admin
GraphQL · Next.js 14 / React 18 · Tailwind · deployed on Railway.

**Architecture at a glance**

```
backend/
  server.js      Express: REST + SSE + MCP-over-HTTP at /mcp (auth-gated)
  mcp-tools.js   the 6 read-only MCP tools (createMcpServer factory)
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

## Run it yourself

**Requirements:** a [Poke](https://poke.com) account (the free tier works), a
Shopify store, and Node 22+.

### 1. Create a Shopify app (client-credentials)
1. In the Shopify **[Dev Dashboard](https://dev.shopify.com)**, create an app under your org.
2. Give it read scopes — `read_orders`, `read_products`, `read_customers` — and **release** the version.
3. Install it on your store and copy the **Client ID** and **Client Secret** (`shpss_…`).
4. Note your store's `*.myshopify.com` domain (Settings → Domains).

### 2. Configure & run the backend
Create `backend/.env` (gitignored — never commit it):
```
PORT=4000
# Single-quote the value so Node's --env-file parser keeps it intact.
SHOPIFY_STORES='[{"key":"main","label":"Main Store","shopDomain":"your-store.myshopify.com","clientId":"your_api_key","clientSecret":"shpss_xxx","apiVersion":"2026-01"}]'
# Shared secret for /mcp and the SSE stream. Without it, both accept loopback
# (local) requests only — set it to allow remote clients like Poke.
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
discovers the six tools automatically. Then just text Poke a question.

### Deploy (always-on)
Deploy `backend/` to Railway/Render/Fly (Dockerfile included). Set `SHOPIFY_STORES`
and `MCP_TOKEN` as host env vars (and `CORS_ORIGIN` to your dashboard URL if you
deploy the frontend). Point Poke at `https://<host>/mcp` with `-k <MCP_TOKEN>` —
no tunnel, runs 24/7. Not serverless: the SSE stream needs a long-lived connection.

---

## Roadmap

ShopTalk starts read-only and safe by design — and it's built to grow. What's next:

- **Write actions** — fulfilling orders, adjusting inventory, tagging customers. Read-only today; the tool layer adds each cleanly behind the same MCP interface.
- **Deeper analytics** — sales trend charts and best-seller ranking by units sold (today `get_sales` returns the period total + order count).
- **Flexible time ranges** — custom date ranges beyond the current `today` / `7d` / `30d`.
- **Larger result windows** — paginate past the current single 250-order page (a `capped` flag already surfaces overflow).

## Tests
```bash
cd backend && node --test
```

## License

MIT — see [LICENSE](LICENSE).
