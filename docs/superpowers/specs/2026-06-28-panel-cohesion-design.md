# Panel Cohesion Redesign — Design Spec

**Date:** 2026-06-28
**Status:** Approved (verbal). Proceeding to plan + build.

## Goal

Bring the orders / products / customers result panels up to the revenue view's
visual language so the whole demo dashboard feels cohesive. Today those three use
a single bare `Rows` table (plain headers, no badges, no summary, lots of empty
space); the revenue view has a header + summary KPI strip + colored accents.

## Approach

Reuse the revenue view's language via small shared components, and derive every
summary number from the existing demo arrays (no demo-data changes). Pure
derivation lives in a `.mjs` helper (unit-tested, matching `revenueChart.mjs` /
`sparkline.mjs` precedent); presentational bits live in a shared component file.

## New: `frontend/lib/panelSummaries.mjs` (pure, no React)

- `stockLevel(inventory) => "out" | "low" | "in"` — `out` when `inventory === 0`;
  `low` when `1 <= inventory <= 10`; `in` otherwise (including `null`/unknown).
  `LOW_STOCK = 10`.
- `summarizeOrders(orders=[]) => { count, valueByCurrency, unfulfilled }` —
  `valueByCurrency` groups `total` by `currency`; `unfulfilled` counts orders whose
  `fulfillmentStatus` is set and `!== "FULFILLED"` (so `UNFULFILLED` /
  `PARTIALLY_FULFILLED` count; `null` does not).
- `summarizeProducts(products=[]) => { count, active, needRestock }` — `active`
  counts `status === "ACTIVE"`; `needRestock` counts `stockLevel` of `out` or `low`.
- `summarizeCustomers(customers=[]) => { count, spentByCurrency, avgOrders, maxSpent }`
  — `spentByCurrency` groups `amountSpent` by `currency`; `avgOrders =
  round(sum(orders)/count)` (0 when empty); `maxSpent` = max `amountSpent`.

Currency grouping mirrors `aggregateSales`/`summarizeSales`: never sum across
currencies; display via the existing `fmtMoney`.

## New: `frontend/components/PanelUI.js` (presentational)

- `PanelHeader({ icon, title, badge })` — `flex items-center justify-between`;
  icon `h-4 w-4` + `text-sm text-muted-foreground` title (same as `Sales`), with an
  optional right-aligned `badge`.
- `StatStrip({ stats })` — `stats: [{label, value}]`; a `grid` with
  `border-y border-border/50 py-3`, uppercase muted labels + `text-lg font-semibold`
  values. Column count = `stats.length`.
- `StatusPill({ tone, children })` — rounded-full `px-2 py-0.5 text-xs font-medium`.
  Tones: `success` = `bg-shopify/15 text-shopify-light`, `warn` =
  `bg-amber-500/15 text-amber-400`, `danger` = `bg-rose-500/15 text-rose-400`,
  `muted` = `bg-muted text-muted-foreground`.
- `SplitBar({ parts })` — `parts: [{value, className}]`; a `h-1.5` rounded bar split
  by value proportion (zero-value parts omitted; total 0 → empty track).
- `SpendBar({ fraction })` — `h-1.5` rounded track with a `bg-shopify` fill at
  `max(2, fraction*100)%`.

## Changed: `frontend/components/ResultPanel.js`

Replace the `orders`/`order`/`products`/`customers` branches (currently the generic
`Rows`) with dedicated components using the shared bits. `list_stores` keeps its
current `Rows` table (not in the demo; out of scope). `Rows` stays (still used by
stores).

- `Orders({ orders })` — `PanelHeader` (Receipt, "Recent orders", badge: `N
  unfulfilled` warn / "all fulfilled" success); `StatStrip` Orders / Value
  (`fmtMoney`) / Unfulfilled; a `SplitBar` (green fulfilled vs amber unfulfilled);
  rows: `name` (mono), customer (truncate), total (mono), fulfillment `StatusPill`
  (`FULFILLED` → success, `null` → muted, else warn). Single `order` type passes
  `[detail]`.
- `Products({ products })` — `PanelHeader` (Package, "Products", badge: `N need
  restock` warn / "stock healthy" success); `StatStrip` Products / Active / Need
  restock; rows: title (+ muted "Draft" pill when `status !== "ACTIVE"`), price
  (mono), stock `StatusPill` (out → danger "Out of stock", low → warn `Low · N`, in
  → success `N in stock`).
- `Customers({ customers })` — `PanelHeader` (Users, "Repeat customers", badge: `N
  customers` muted); `StatStrip` Customers / Total spent (`fmtMoney`) / Avg orders;
  ranked rows (1..N), name, `N orders`, amountSpent (mono), and a `SpendBar`
  (`amountSpent / maxSpent`).

## Data flow

Demo arrays already carry the needed fields (orders: name/customer/total/currency/
fulfillmentStatus; products: title/price/currency/totalInventory/status;
customers: name/email/orders/amountSpent/currency). Components derive summaries at
render. No backend or demo-data change. Live mode renders identically from the real
tools' same-shaped arrays.

## Theme

Reuse `tailwind.config.js` `shopify`/`shopify-light`; amber = `amber-400/500`,
rose = `rose-400/500`, muted = existing `muted`/`muted-foreground`.

## Testing

`frontend/test/panelSummaries.test.mjs`:
- `stockLevel`: `0→out`, `5→low`, `10→low`, `11→in`, `null→in`.
- `summarizeOrders`: count, `valueByCurrency` sum, `unfulfilled` (FULFILLED not
  counted, UNFULFILLED & PARTIALLY_FULFILLED counted, null not).
- `summarizeProducts`: count, active, needRestock.
- `summarizeCustomers`: count, `spentByCurrency`, `avgOrders` rounding, `maxSpent`;
  empty input → `avgOrders 0`, `maxSpent 0`.

Visual components verified via `next build` + a headless screenshot of each panel.

## Non-goals
- No `list_stores` panel redesign.
- No demo-data or backend changes.
- No `$`/thousands-separator money reformat (separate global option).
- No new dependencies.
