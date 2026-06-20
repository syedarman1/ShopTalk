# Poke ↔ Shopify MCP — Design

**Date:** 2026-06-20
**Status:** Approved (design); pending implementation plan
**Name:** ShopTalk

## Summary

Build a custom MCP server that lets the user text [Poke](https://poke.com) over
iMessage to ask questions about their Shopify store(s). Poke connects to the
server's `/mcp` endpoint and calls read-only tools that query the Shopify Admin
GraphQL API. A live web dashboard streams each tool call and visualizes results.

The project is a **fork of the existing MockBase codebase**. MockBase already
solves the hard parts of the Poke↔MCP integration (streamable-HTTP transport,
tunnel UUID-path stripping, the `Accept`-header fix, SSE dashboard, heartbeat
watchdog, deploy story). We keep that backbone and replace the SQLite data layer
with a Shopify client.

## Goals

- Text Poke → get real answers about Shopify stores, in iMessage.
- Own and control the MCP server (learning + portfolio value).
- Read-only in v1, with the tool layer structured so write tools are a clean
  later addition (not a rewrite).
- Support N stores from the start via a config registry.
- Keep MockBase's live dashboard, repurposed for commerce data.

## Non-goals (v1)

- No write/mutation tools (price changes, fulfillment, product edits). Deferred.
- No inventory/low-stock tools yet. Pure additions later.
- No multi-user/multi-tenant auth. Single operator (the store owner).

## Architecture

One Express process serves three things in-process, exactly as MockBase does today:

1. REST API + SSE stream for the dashboard.
2. MCP over streamable HTTP at `/mcp` (stateless: fresh transport + `McpServer`
   per request).
3. Static/Next.js dashboard frontend.

Poke connects to `/mcp` unchanged from the MockBase setup:
- Local: `npx poke@latest tunnel http://localhost:4000/mcp -n ShopTalk`
- Hosted: `npx poke@latest mcp add https://<host>/mcp -n ShopTalk`

The UUID-path middleware and `forceAccept()` header fix in `server.js` carry over
untouched.

### The one structural change

MockBase's `db.js` (SQLite data layer that every tool calls) is **removed**.
In its place:

- **`shopify.js`** — thin Admin GraphQL client. Given a store key, resolves
  credentials from the registry, runs a GraphQL query, handles errors and
  Shopify's cost-based rate limiting (retry with backoff), returns clean JS
  objects. Tools never touch HTTP directly. This is the unit tested in isolation
  against the real store.
- **`stores.js`** — multi-store registry. Builds a list of
  `{ key, label, shopDomain, adminAccessToken, apiVersion }` from environment
  config. Resolves a store key → credentials. Lists configured stores.

`mcp-tools.js` keeps its exact MockBase shape — tool registration, Zod input
schemas, and a `broadcast()` call after each invocation so the dashboard updates.
This preserves the dashboard wiring and the read→write extensibility: adding a
write tool later is one new registration, mirroring how MockBase added
`insert_rows`.

## Multi-store config & auth

**Registry source:** environment variables, never committed.
- Either a single `SHOPIFY_STORES` JSON blob, or per-store vars
  (`SHOPIFY_<KEY>_DOMAIN`, `SHOPIFY_<KEY>_TOKEN`).
- Each store: `{ key, label, shopDomain, adminAccessToken, apiVersion }`.

**Store selection:** every tool takes an **optional `store` param**.
- Omitted → a configured default store, or "all stores" for rollup-capable tools.
- Rollup tools iterate the registry and aggregate across stores.

**Auth:** each store has a Shopify **custom app** with an Admin API access token,
read scopes only for v1: `read_orders`, `read_products`, `read_customers`,
`read_analytics`/reports. One-time manual setup per store in the Shopify admin;
documented in the README, not code.

**Prerequisite:** at least one real store with a custom-app token exists (user
has one) — required for end-to-end testing.

## MCP tools (v1, read-only)

Each maps to Shopify Admin GraphQL, takes an optional `store`, returns
human-readable text (Poke reads it over iMessage) plus structured data in the
broadcast for the dashboard.

| Tool | Purpose |
|------|---------|
| `list_stores` | Names/keys of configured stores. |
| `get_sales` | Revenue, order count, AOV for a period (`today`/`7d`/`30d`/custom). Per store or rolled up. ShopifyQL/analytics, with order-aggregation fallback. |
| `get_orders` | Recent orders; filter by status (e.g. unfulfilled); lookup by order number. |
| `get_order` | Full detail for a single order. |
| `search_products` | Product lookup/search + top sellers by sales. |
| `search_customers` | Customer lookup + repeat/top customers. |

**`get_sales` caveat:** ShopifyQL analytics access can vary by plan. If
unavailable on the user's store, `get_sales` falls back to aggregating order data
over the requested period. Build defensively.

## Dashboard

Reuse MockBase's SSE + event-card shell, the `useMockbase`-style hook, and the
heartbeat watchdog. Repaint for commerce:

- One event card per tool call (which store, what was asked).
- Result views by type: sales number + sparkline for `get_sales`; order list for
  `get_orders`/`get_order`; product and customer cards for searches.
- Rename/reshape SSE event types from DB operations to commerce operations.

## Error handling

- Unknown store key → clear "unknown store, did you mean X" text back to Poke.
- Missing/invalid token → explicit auth error, never a silent empty result.
- Shopify rate-limit/throttle → retry with backoff inside `shopify.js`.
- All tool results are human-readable text; structured payload rides the broadcast.

## Testing

1. **`shopify.js`** tested against the real store (read-only = safe).
2. **Each tool** exercised via the local `/mcp` endpoint on an isolated port,
   the way MockBase verified its tools.
3. **End-to-end:** connect Poke via tunnel and text it real questions.

## Deploy

Same as MockBase: backend → Railway/Render/Fly (Dockerfile in `backend/`);
frontend → Vercel (`NEXT_PUBLIC_API_BASE` = backend URL). Not serverless (SSE
needs a long-lived connection). Shopify store credentials set as env vars on the
backend host. No persistent SQLite volume needed unless caching is added later.

## Future (post-v1)

- Write tools (discounts, tags → later prices/inventory/fulfillment) with a
  confirmation step over text.
- Inventory & low-stock tools and alerts.
- Scheduled daily/weekly digests pushed to iMessage.
- Optional caching layer for analytics.
