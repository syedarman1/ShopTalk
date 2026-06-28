# Revenue View Redesign — Design Spec

**Date:** 2026-06-28
**Status:** Approved (verbal), proceeding to plan + build per user instruction.

## Goal

Replace the demo dashboard's weak "How much did I sell today?" result — a big
number plus a meaningless 160×36 nine-point sparkline — with a Shopify-analytics-
style revenue view that fills the panel and actually conveys the day's sales.

## Problem

`ResultPanel.js`'s `Sales` view renders `$2,480.00`, an order count, and a tiny
polyline of arbitrary values (`[180,240,90,320,150,410,260,300,330]`). The line
has no axis, no time, no comparison, and means nothing; most of the center column
(`1fr`, full height) sits empty.

## Outcome (approved layout)

```
┌────────────────────────────────────────────┐
│ Total sales · Today          ▲ 18% vs yest. │
│ $2,480.00                                    │
│                  (green area + line, today)  │
│                  (faded dashed line, yest.)  │
│  └─9a──11a──1p──3p──5p──7p──9p─┘  x-axis     │
│ ──────────────────────────────────────────  │
│  Orders 18   │  Avg order $137.78           │
└────────────────────────────────────────────┘
```

- Headline: `Total sales · Today` + a **% change vs yesterday** badge (green ▲ up,
  red ▼ down).
- Big total (existing `fmtMoney`).
- An **area+line chart** with a real hourly x-axis, a solid green "today" line over
  a green→transparent gradient fill, and a faded **dashed "yesterday" line** for
  comparison, plus subtle y gridlines and a small legend.
- A light **hover tooltip** (vertical guide + value bubble) on the chart.
- KPI row: **Orders** | **Avg order value**.

## Architecture / components

Follow the existing pattern: pure geometry in a `.mjs` helper (unit-tested), thin
React component renders SVG, `ResultPanel` composes.

### New: `frontend/lib/revenueChart.mjs` (pure, no React)
- `pctChange(today, prev)` → number | null. `(today - prev) / prev * 100`; returns
  `null` when `prev` is `0`, `null`, or `undefined` (avoid divide-by-zero / fake %).
- `buildRevenueChart(points, { width, height, padding })` → object with:
  - `areaPath` (string) — closed path for the today gradient fill.
  - `linePath` (string) — today line.
  - `prevPath` (string | null) — yesterday line, `null` if no `prev` values present.
  - `xTicks` — `[{ x, label }]` for the hour axis (every Nth point to avoid crowding).
  - `yGrid` — `[{ y }]` gridline positions (e.g., 3 lines).
  - `dots` — `[{ x, y, label, value }]` per point, for hover hit-testing.
  - Degenerate input (empty/one point/all-equal) returns empty paths, never throws.
- `points` shape: `[{ label: string, value: number, prev?: number }]`.

### New: `frontend/components/RevenueChart.js` (client)
- Props: `{ points, width?, height? }` (responsive width via a container ref;
  fixed viewBox, `preserveAspectRatio`).
- Renders: y gridlines, gradient `<defs>`, area fill, today `<path>` (green
  `#008060`/`text-shopify`), dashed yesterday `<path>` (muted), x-axis labels,
  legend ("Today" solid · "Yesterday" dashed).
- Animation: framer-motion draw-in via `pathLength` on the line; skipped when
  `useReducedMotion()` is true.
- Hover: track pointer x over the SVG, find nearest `dot`, show a vertical guide +
  a small value bubble (label + formatted value). Touch/no-hover: no crash, chart
  still static-readable.

### Changed: `frontend/components/ResultPanel.js`
- Rebuild `Sales` to the approved layout. New helpers:
  - delta badge from `pctChange(todayTotal, comparisonTotal)` — green/▲ when ≥ 0,
    red/▼ when < 0, hidden when `null`.
  - KPI row reads `orderCount` and `averageByCurrency` (fallback: derive
    `total / orderCount`).
- **Graceful fallback:** render the rich chart + delta only when
  `detail.series?.points?.length` and a comparison total exist; otherwise show the
  current number-only view (keeps live `get_sales` and the all-stores rollup
  working, since neither returns a series yet).
- Rollup (`detail.combined`) keeps its existing combined-total + per-store list;
  no chart for rollup in this pass.

### Changed: `frontend/lib/demoData.mjs`
Enrich the `sales-today` step `detail`:
```js
{
  store: "northwind", period: "today",
  totalsByCurrency: { USD: 2480 }, orderCount: 18,
  averageByCurrency: { USD: 137.78 },
  comparison: { label: "yesterday", totalsByCurrency: { USD: 2100 } },
  series: { points: [ { label, value, prev }, … ] },  // ~14 hourly buckets 8a–9p
}
```
Today hourly `value`s sum to 2,480; `prev`s sum to 2,100 → headline ▲ 18%. The
existing reply text already says "2,480.00 USD across 18 orders … average order
137.78 USD," so the numbers stay consistent.

### Removed
- `frontend/components/Sparkline.js` and `frontend/lib/sparkline.mjs` (+ its test)
  — superseded by `revenueChart.mjs`. Verify no other importer first (currently
  only `ResultPanel` imports `Sparkline`).

## Data flow
Demo: `useDemo` → `composeDemoState` → `latest.detail` (now enriched) → `ResultPanel`
`Sales` → `RevenueChart`. No backend change; the demo is air-gapped. Live mode is
unchanged (falls back to number view).

## Theme
Reuse `tailwind.config.js` `shopify` (`#008060`) / `shopify-light` (`#95bf47`).
Up delta uses shopify green; down delta uses a red (`text-rose-400`/`500`).
Area gradient: green at top → transparent at baseline. Dark card background as-is.

## Testing
`frontend/lib/revenueChart.test.mjs` (or matching existing test runner/location):
- `pctChange`: positive, negative, `prev = 0` → null, missing prev → null.
- `buildRevenueChart`: produces non-empty `areaPath`/`linePath` for normal input;
  `prevPath` null when no `prev`s; correct number of `xTicks`/`dots`; empty input
  yields empty paths without throwing; all-equal values don't divide by zero.

## Non-goals (this pass)
- No backend `get_sales` hourly series / comparison (README-roadmap item; separate).
- No redesign of the orders/products/customers panels.
- No new charting dependency.
- No sessions/conversion KPIs (no real data source — would be fabricated).
```
