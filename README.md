# ShopTalk — Text Poke to ask your Shopify store anything

ShopTalk is an [MCP](https://modelcontextprotocol.io) server that lets you text
[Poke](https://poke.com) over iMessage to ask read-only questions about your
Shopify store(s) — "how much did I sell today?", "show my last 5 orders",
"who are my repeat customers?" — and get real answers back. A live web dashboard
streams every query as it happens.

It's a fork of the MockBase architecture: the same one-process Express + SSE +
MCP backbone and Next.js dashboard, with the data layer swapped from SQLite to
the **Shopify Admin GraphQL API**.

## How it works

```
iMessage ──> Poke ──(MCP over streamable HTTP)──> ShopTalk /mcp
                                                     │
                                       reads (read-only) via
                                       Shopify Admin GraphQL API
                                                     │
                              every tool call broadcasts over SSE
                                                     ▼
                                        Next.js live dashboard
```

One Express process serves three things in-process:

1. **`/mcp`** — the MCP server (stateless streamable HTTP) that Poke connects to.
2. **`/api/events`** — an SSE stream the dashboard subscribes to; every tool call
   is broadcast here in real time.
3. REST helpers (`/api/health`, `/api/stores`) for the dashboard.

### MCP tools (all read-only)

| Tool | What it answers |
|------|-----------------|
| `list_stores` | Which stores are configured. |
| `get_sales` | Revenue, order count, AOV for `today`/`7d`/`30d`. Per store or rolled up across all stores. |
| `get_orders` | Recent orders, optionally only unfulfilled. |
| `get_order` | Full detail for one order by number (e.g. `#1001`). |
| `search_products` | Product search / listing. |
| `search_customers` | Customer search (e.g. `orders_count:>1` for repeat customers). |

Every tool takes an optional `store` key; omit it to use the default store (or,
for `get_sales`, to roll up across all stores). There is **no** way to change
store data — the token only ever holds read scopes.

## Setup

### 1. Create a Shopify app and get credentials

Shopify removed static admin API tokens in 2026, so ShopTalk uses the
**client credentials grant** (the supported method for an app you own running on
a store you own).

1. Create an app in the Shopify **[Dev Dashboard](https://dev.shopify.com)** under
   your organization.
2. Set Admin API scopes on the app version: `read_orders`, `read_products`,
   `read_customers`. **Release** that version (client credentials reads scopes
   from the active released version — saving alone isn't enough).
3. Install the app on your store, then copy its **Client ID** (API key) and
   **Client Secret** (`shpss_…`). There is no static token — ShopTalk exchanges
   these for a short-lived (24h) access token automatically and refreshes it.
4. Find your store's permanent **`*.myshopify.com`** domain (Settings → Domains,
   or your admin URL). This is *not* your custom storefront domain.

### 2. Configure the backend

Create `backend/.env` (gitignored — never commit it):

```
PORT=4000
# Single-quote the whole value so Node's --env-file parser keeps it intact
# (an unquoted '#' is treated as a comment and would truncate the JSON).
SHOPIFY_STORES='[{"key":"main","label":"Main Store","shopDomain":"your-store.myshopify.com","clientId":"your_api_key","clientSecret":"shpss_xxx","apiVersion":"2026-01"}]'
```

`SHOPIFY_STORES` is a JSON array — add more `{…}` objects for more stores. Each
store needs `key`, `label`, `shopDomain`, `clientId`, `clientSecret`; `apiVersion`
is optional (defaults to a recent stable version).

### 3. Run it locally

```bash
# backend
cd backend && npm install && node --env-file=.env server.js   # http://localhost:4000

# frontend (separate terminal)
cd frontend && npm install && npm run dev                      # http://localhost:3000
```

Open the dashboard at http://localhost:3000 — the header should show **live** and
your store count. Run the read-only smoke test against your real store any time:

```bash
cd backend && node --env-file=.env smoke.js
```

### 4. Connect Poke

```bash
npx poke@latest login
npx poke@latest tunnel http://localhost:4000/mcp -n ShopTalk     # local
# or, when deployed:
npx poke@latest mcp add https://<your-host>/mcp -n ShopTalk
```

Then text Poke: *"how much did I sell today?"*, *"show my last 5 orders"*,
*"what products do I sell?"* — answers come back in iMessage, and each query
lights up the dashboard.

## Deploy (always-on)

Not serverless — the SSE stream needs a long-lived connection.

- **Backend** → Railway / Render / Fly (Dockerfile in `backend/`). Set
  `SHOPIFY_STORES` as an environment variable in the host dashboard (never in the
  repo). Also set `CORS_ORIGIN` to your deployed frontend's URL (e.g.
  `https://your-dashboard.vercel.app`) so the CORS policy allows the browser to
  reach the backend API and SSE stream.
- **Frontend** → Vercel. Set `NEXT_PUBLIC_API_BASE` to the backend's URL.
- Point Poke at `https://<backend-host>/mcp`.

## Tests

```bash
cd backend && node --test    # unit tests for the registry + Shopify helpers
```

## v1 limitations (intentional, not bugs)

- **Read-only.** No writes/mutations. The tool layer is structured so write tools
  are a clean later addition; v1 requests only `read_orders`/`read_products`/`read_customers`.
- **`get_sales`** reads a single 250-order page per store (a `capped` flag surfaces
  overflow) and supports only `today`/`7d`/`30d` — custom date ranges are deferred.
- **No sales sparkline** yet — `get_sales` returns the period total and order
  count, not a per-day trend.
- **`search_products`** is text search / listing only; true best-sellers ranking
  by units sold (needs order/analytics aggregation) is deferred.

## Project layout

```
backend/
  server.js      Express: REST + SSE + /mcp (streamable HTTP)
  mcp-tools.js   the 6 read-only MCP tools (createMcpServer factory)
  shopify.js     Admin GraphQL client + client-credentials token exchange + read fns
  stores.js      multi-store registry (parses SHOPIFY_STORES)
  smoke.js       read-only smoke test against the real store
  test/          unit tests (node --test)
frontend/
  app/page.js            dashboard
  components/            ResultPanel, ActivityLog, Header
  lib/useShopTalk.js     SSE hook (activity, status, latest, stores)
```
