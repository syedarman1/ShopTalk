# Daily Briefing — Design Spec

**Date:** 2026-07-01
**Status:** Approved (contents: yesterday's sales + unfulfilled orders + low stock; top seller deferred to best-sellers).

## Goal

A new read-only MCP tool, `get_daily_briefing`, that bundles what a merchant
wants in a morning text: **yesterday's sales** (revenue, orders, AOV),
**unfulfilled orders**, and **low-stock products** — one tool call, so a Poke
automation ("every morning at 9…") can deliver it as a scheduled text.

**Opt-in by design (user requirement):** ShopTalk never sends anything on its
own — no scheduler, no push. The morning text exists only if the user creates a
Poke automation on their own account; the tool also works on demand ("how's my
store doing?"). The README states this explicitly.

## Backend changes (`backend/shopify.js`)

1. **`"yesterday"` period.** `periodToRange` gains `yesterday` →
   `{ since: start-of-yesterday, until: start-of-today, label: "yesterday" }`,
   both computed in the store's timezone. DST-safe derivation: 1 ms before
   today's local midnight is an instant inside yesterday, so
   `startOfDayISO(new Date(Date.parse(startToday) - 1), timeZone)` is
   yesterday's local midnight. Existing periods are unchanged (`until`
   undefined). Unknown-period error message now lists `yesterday`.
2. **Bounded sales window.** `getSales` appends ` created_at:<${until}` to the
   query when `until` is present (Shopify search terms AND by default; keep the
   existing unquoted style for consistency with what runs in prod).
3. **`getLowStock(storeKey, { threshold = 10, limit = 10 })`** — products query
   `status:active inventory_total:<=${threshold}` with `sortKey: INVENTORY_TOTAL`
   (lowest first); reuses `shapeProduct`. Returns `{ store, threshold, products }`.
4. **`getDailyBriefing({ storeKey, lowStockThreshold = 10 })`** — for one store
   (if `storeKey`) or all stores: per store, `Promise.all` of
   `getSales(key, "yesterday")` + `getOrders(key, { status: "unfulfilled",
   limit: 10 })` + `getLowStock(key, { threshold })`, composed via
   `Promise.allSettled` across stores (rollup pattern: healthy stores report,
   failed stores land in `failures`). Returns
   `{ period: "yesterday", stores: [{ store, label, sales, unfulfilled: { count,
   orders }, lowStock }], failures: [{ store, error }] }`.

## MCP tool (`backend/mcp-tools.js`)

`get_daily_briefing` — optional `store` (key; all stores if omitted), optional
`lowStockThreshold` (int 1–500, default 10). Description tells the AI it's for
scheduled morning check-ins / "how's my store doing?". Also extend `get_sales`'s
`period` enum with `"yesterday"` (free win: "how much did I sell yesterday?").

## Tests

- Pure (`test/shopify.test.js`): `periodToRange("yesterday")` in UTC and
  `America/New_York` (exact since/until), `today` has no `until`.
- Network (`test/briefing.network.test.js`, mocked fetch, fresh process):
  `getSales("yesterday")` sends a bounded `created_at:>=… created_at:<…` range;
  `getLowStock` sends `status:active inventory_total:<=10` and shapes products;
  `getDailyBriefing` bundles all three per store and reports a failing store in
  `failures` without killing the briefing.

## README

- Tools table: add `get_daily_briefing` row; update `get_sales` row with
  "yesterday". Update every "six tools" count to seven (explainer, heading,
  architecture tree).
- New "Optional: a morning briefing text" subsection after "Connect Poke": the
  one-text Poke automation, plus the opt-in note (no automation → no messages).
- Roadmap "Flexible time ranges" line now reads "beyond `today` / `yesterday` /
  `7d` / `30d`".

## Non-goals
- No top-seller/line-item analytics (future best-sellers feature).
- No server-side scheduling, webhooks, or push of any kind.
- No write scopes; everything stays read-only.
