# Parity Pack — Design Spec

**Date:** 2026-07-03
**Status:** Approved. Goal: Poke + ShopTalk ≥ Claude's official Shopify connector for every READ, with two honest exceptions (ShopifyQL analytics — API not public; writes — user-declined, re-openable).

## Context (proven live today)

- `shopifyPaymentsAccount` is scope-locked for BOTH the user's app and Claude's
  official connector — the payments door is shut. But `Order.disputes`
  (OrderDisputeSummary) needs only `read_orders`: sweeping orders found the
  user's real chargebacks (#2176, #2161).
- `read_orders` only exposes the last **60 days**; the user's other two
  chargebacks (#2046, #1918) sit beyond it. `read_all_orders` (user adding)
  lifts the window — ShopTalk will then see what Claude's connector cannot.
- What made the official connector's `graphql_query` reliable is its
  schema/validation tooling; `run_query` gets the same treatment.

## Changes (ShopTalk backend; 12 → 14 tools)

### 1. `get_disputes` rebuilt as an order-sweep (replaces the payments-account version)
`getDisputes(storeKey, { status = "open", days = 120, limit = 20 })`:
- Compute `since = startOfDayISO(now, shopTz, days)`; sweep
  `orders(first: 250, query: "created_at:>='since'", sortKey: CREATED_AT,
  reverse: true)` selecting `name createdAt currentTotalPriceSet disputes { id
  status initiatedAs }`, following `pageInfo` cursors, **max 6 pages** (1500
  orders) — `capped: true` + `sweptOrders` count when the cap hits.
- Keep orders with `disputes.length > 0`; `status:"open"` filters
  `NEEDS_RESPONSE`/`UNDER_REVIEW`. Return `{ store, status, days, sweptOrders,
  capped, disputes: [{ id, order, orderCreatedAt, orderTotal, currency,
  status, initiatedAs }] }` — `orderTotal` is the order's total (the dispute
  amount usually equals it; the exact disputed amount lives behind the locked
  payments scope — description says so).
- Tool description: needs only `read_orders` (60-day window) — add
  `read_all_orders` for full history. No payments scopes.
- Acceptance: against the live store returns `#2176, #2161` today, and all of
  `#2176, #2161, #2046, #1918` once `read_all_orders` is granted.

### 2. `get_schema` — introspection (new tool)
`getSchemaType(storeKey, typeName = "QueryRoot")`: GraphQL introspection
(`__type(name:)`) returning a compact shape: `{ type, kind, description,
fields: [{ name, type: "String!", args: ["first: Int"] }], enumValues }`.
Type strings rendered by a pure exported `renderTypeRef(ref)` (unwraps
NON_NULL/LIST → `[Order!]!`) — unit-tested. Per-store+type in-process cache.
Default type QueryRoot = "what can I query?".

### 3. `run_query` validation (upgrade)
Add the `graphql` package. Flow: `parse()` (clear syntax errors, no network) →
reject any `mutation`/`subscription` operation via the AST (keep the regex as a
cheap pre-filter) → lazily fetch full introspection once per store
(`getIntrospectionQuery()`, `buildClientSchema`, cached) → `validate()` (gives
"did you mean …" suggestions) → execute. If the introspection fetch fails,
skip validation and execute anyway (availability over strictness).

### 4. `get_shop_info` (new tool)
`getShopInfo(storeKey)`: `{ shop { name email myshopifyDomain primaryDomain {
host } currencyCode ianaTimezone plan { displayName } } }` → flat object.

### Docs
README: tool count twelve → **fourteen** (all spots incl. architecture tree),
table rows for the two new tools + rewritten `get_disputes` row, scopes line
adds optional `read_all_orders`, `run_query` row mentions validation. SECURITY
posture unchanged (still read-only).

## Testing
Mocked-fetch (existing pattern): sweep pagination + open-filter + page-cap
(`capped`), quoted `created_at` in sweep query; `renderTypeRef` pure cases;
`get_schema` formatting from a mocked introspection payload; `run_query`
syntax-error path, mutation-AST rejection (no network), validation failure
against a small schema built with `graphql` in the test, valid-query
execution, and introspection-failure fallback. `get_shop_info` shaping.
Live verification before push: disputes sweep, `get_schema(Order)`,
`get_shop_info`, validated `run_query` against the real store (read-only).

## Non-goals
ShopifyQL analytics (API not public — documented exception), writes
(user-declined), widgets (Poke is text), payouts (data only behind the locked
payments scope).
