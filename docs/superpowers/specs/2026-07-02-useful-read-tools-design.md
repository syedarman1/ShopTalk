# Useful Read Tools + run_query Escape Hatch — Design Spec

**Date:** 2026-07-02
**Status:** Approved (user picked all four dedicated tools + the core).

## Goal

Close the "ShopTalk can't answer simple questions" gap. Two moves:

1. **`run_query`** — a read-only Admin GraphQL escape hatch (the Claude-connector
   pattern) so Poke can answer questions no dedicated tool covers, instead of
   failing or confabulating.
2. **Four dedicated read-only tools** for the questions a merchant texts daily:
   chargebacks, best sellers, payouts, refunds. Dedicated tools beat
   model-written GraphQL for reliability on everyday questions.

Plus **honesty instructions**: the server tells the AI to say "I can't" rather
than guess when nothing fits.

Everything stays **read-only**. No write tools. `run_query` rejects mutations in
code, and the app's read-only scopes make writes impossible regardless.

## New scopes (user action required)

`get_disputes` and `get_payouts` need two new scopes on the Shopify app:
`read_shopify_payments_disputes` and `read_shopify_payments_payouts`
(Dev Dashboard → edit scopes → release → reinstall on the store). Until then,
those two tools return the underlying Shopify access error; their descriptions
name the required scope so the AI can relay "grant X and reinstall".
Everything else works with existing scopes.

## Tools (7 → 12)

### 1. `run_query` (backend/shopify.js: `runReadQuery`)
- Input: `store?`, `query` (GraphQL document string), `variables?` (object).
- Guard: reject any document matching `/\bmutation\b/i` with a clear error
  ("read-only: mutations are not allowed") — over-blocking a string literal
  containing the word is acceptable. Reads go through `shopifyGraphQL` as-is.
- Tool description carries usage guidance + two worked example queries
  (shop info, abandoned checkouts) so weaker models have recipes, and states
  the API version and that only read scopes are held.

### 2. `get_disputes` (shopify.js: `getDisputes(storeKey, { status = "open", limit = 10 })`)
- Query: `shopifyPaymentsAccount { disputes(first: $n) { edges { node {
  id amount { amount currencyCode } evidenceDueBy initiatedAt
  reasonDetails { reason networkReasonCode } status type order { name } } } } }`
- `status: "open"` keeps `NEEDS_RESPONSE` + `UNDER_REVIEW` (client-side filter);
  `"all"` returns everything.
- Shape: `{ store, status, disputes: [{ id, order, amount, currency, reason,
  networkReasonCode, status, type, evidenceDueBy, initiatedAt }] }`.

### 3. `get_best_sellers` (shopify.js: `getBestSellers(storeKey, { period = "30d", limit = 5 })`)
- Orders in the period (reuse `periodToRange`, quoted bounds, same
  test/cancelled exclusions as revenue) with nested line items:
  `orders(first: 50, query: $q, sortKey: CREATED_AT, reverse: true) { edges {
  node { test cancelledAt lineItems(first: 20) { edges { node { title quantity } } } } }
  pageInfo { hasNextPage } }` — 50×20 keeps GraphQL cost bounded.
- Aggregate `quantity` by product title (pure helper `rankLineItems(orders)`
  → unit-tested); return top `limit` as `[{ title, unitsSold, orders }]` plus
  `capped` when `hasNextPage` (same honesty pattern as get_sales).

### 4. `get_payouts` (shopify.js: `getPayouts(storeKey, { limit = 5 })`)
- Query: `shopifyPaymentsAccount { balance { amount currencyCode }
  payouts(first: $n) { edges { node { id issuedAt net { amount currencyCode }
  status } } } }`
- Shape: `{ store, balance: [{ amount, currency }], payouts: [{ id, issuedAt,
  net, currency, status }] }` (statuses: SCHEDULED / IN_TRANSIT / PAID / …).

### 5. `get_refunds` (shopify.js: `getRefunds(storeKey, { limit = 10 })`)
- Order search `(financial_status:refunded OR financial_status:partially_refunded)`,
  `sortKey: UPDATED_AT, reverse: true`; reuse `shapeOrder`.
- Shape: `{ store, orders: [...] }`. Description notes the approximation
  (ordered by last update, not refund timestamp).

### Instructions update (`createMcpServer`)
Rewrite the server `instructions`: list the capability areas (sales/briefing,
orders, products/stock, customers, chargebacks, payouts, refunds, best sellers,
arbitrary read queries via run_query), prefer dedicated tools, use `run_query`
for anything they don't cover, and **"if neither fits, say you can't — never
invent numbers."**

## Schema-accuracy caveat (explicit)
Field names for `shopifyPaymentsAccount` (disputes/payouts) are encoded
best-effort against the current Admin schema and covered by mocked tests; the
live smoke for those two tools can only happen **after the user grants the new
scopes**. `run_query` is the safety net if any field drifts. This is stated in
the plan's final task.

## Docs
- README: tools table +5 rows; "seven read-only tools" → twelve (three spots);
  setup step 1 lists the two optional payments scopes; roadmap drops the
  best-sellers line (shipped) and keeps writes/future items.
- SECURITY.md: scope list updated (read-only posture unchanged; payments scopes
  marked optional).

## Testing
Mocked-fetch tests (existing pattern): `run_query` rejects mutations and passes
reads through; disputes shaping + open-filter; payouts shaping; best-sellers
aggregation (pure `rankLineItems` unit tests: quantities summed by title,
test/cancelled orders excluded, ties stable, top-N slice) + capped flag;
refunds query-string form. Local `tools/list` smoke must show 12 tools.

## Non-goals
- No write/mutation tools of any kind.
- No pagination overhaul (250/50-order caps stay, with `capped` flags).
- No Poke-side changes beyond the user re-syncing the integration.
