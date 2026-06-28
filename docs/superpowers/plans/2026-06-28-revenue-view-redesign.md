# Revenue View Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the demo dashboard's meaningless sales sparkline with a Shopify-style revenue view (area+line chart, hourly axis, yesterday comparison, % delta, KPI row).

**Architecture:** Pure SVG geometry in a `.mjs` helper (unit-tested, mirrors the existing `sparkline.mjs` pattern); a thin client `RevenueChart.js` renders it with framer-motion + a hover tooltip; `ResultPanel`'s `Sales` view composes the headline, chart, and KPIs; `demoData.mjs` supplies hourly `points` + a yesterday comparison.

**Tech Stack:** Next.js 14 / React 18, framer-motion (already present), Tailwind, Node built-in test runner (`node --test 'test/**/*.mjs'` from `frontend/`). No new dependencies.

## Global Constraints
- **No new dependencies** — hand-rolled SVG only.
- Tests run from `frontend/` via `node --test 'test/**/*.mjs'`. Test files live in `frontend/test/`.
- Theme colors come from `tailwind.config.js`: `shopify` = `#008060`, `shopify-light` = `#95bf47`. Down-delta uses `text-rose-400`.
- Demo is air-gapped — pure data only, all fake, no PII, no network.
- Live/rollup `get_sales` has no series yet → the rich view must **degrade gracefully** to the number-only view when `detail.series.points` / `detail.comparison` are absent.
- Keep numbers consistent with the existing reply text: 2,480 USD today, 18 orders, $137.78 AOV, yesterday 2,100 (→ ▲ 18%).

---

### Task 1: Pure chart geometry (`revenueChart.mjs`)

**Files:**
- Create: `frontend/lib/revenueChart.mjs`
- Test: `frontend/test/revenueChart.test.mjs`

**Interfaces:**
- Produces:
  - `pctChange(today: number, prev: number) => number | null`
  - `buildRevenueChart(points, opts?) => { areaPath, linePath, prevPath, xTicks, yGrid, dots, width, height, padding, baselineY }`
    - `points: [{ label: string, value: number, prev?: number }]`
    - `opts: { width?, height?, padding?: {top,right,bottom,left} }`
    - `xTicks: [{ x, label }]`, `yGrid: [{ y }]`, `dots: [{ x, y, label, value }]`, `prevPath: string | null`

- [ ] **Step 1: Write the failing test** — `frontend/test/revenueChart.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pctChange, buildRevenueChart } from "../lib/revenueChart.mjs";

test("pctChange computes signed percent change", () => {
  assert.equal(Math.round(pctChange(2480, 2100)), 18);
  assert.equal(Math.round(pctChange(80, 100)), -20);
});

test("pctChange guards divide-by-zero and missing input", () => {
  assert.equal(pctChange(100, 0), null);
  assert.equal(pctChange(100, undefined), null);
  assert.equal(pctChange(null, 100), null);
});

test("buildRevenueChart returns drawable paths for a normal series", () => {
  const pts = [
    { label: "8a", value: 0, prev: 5 },
    { label: "9a", value: 10, prev: 8 },
    { label: "10a", value: 6, prev: 9 },
  ];
  const c = buildRevenueChart(pts, { width: 300, height: 100 });
  assert.ok(c.linePath.startsWith("M"));
  assert.ok(c.areaPath.endsWith("Z"));
  assert.ok(c.prevPath && c.prevPath.startsWith("M"));
  assert.equal(c.dots.length, 3);
});

test("buildRevenueChart prevPath is null when any point lacks prev", () => {
  const c = buildRevenueChart(
    [{ label: "8a", value: 1 }, { label: "9a", value: 2 }],
    { width: 100, height: 50 }
  );
  assert.equal(c.prevPath, null);
});

test("buildRevenueChart x-ticks include the first label and stay sparse", () => {
  const pts = Array.from({ length: 14 }, (_, i) => ({ label: `h${i}`, value: i }));
  const c = buildRevenueChart(pts, { width: 560, height: 180 });
  assert.equal(c.xTicks[0].label, "h0");
  assert.ok(c.xTicks.length <= 8);
});

test("buildRevenueChart handles degenerate input without throwing", () => {
  for (const bad of [[], [{ label: "a", value: 1 }], null, undefined]) {
    const c = buildRevenueChart(bad, { width: 100, height: 50 });
    assert.equal(c.linePath, "");
    assert.equal(c.areaPath, "");
    assert.equal(c.dots.length, 0);
  }
});

test("buildRevenueChart does not divide by zero for an all-zero series", () => {
  const c = buildRevenueChart(
    [{ label: "a", value: 0 }, { label: "b", value: 0 }],
    { width: 100, height: 50 }
  );
  assert.ok(c.linePath.startsWith("M"));
  assert.ok(!c.linePath.includes("NaN"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node --test 'test/revenueChart.test.mjs'`
Expected: FAIL — `Cannot find module '../lib/revenueChart.mjs'`.

- [ ] **Step 3: Implement** — `frontend/lib/revenueChart.mjs`

```js
// revenueChart.mjs — pure SVG geometry for the revenue area chart. No React.
// points: [{ label: string, value: number, prev?: number }]

/** Signed percent change; null when prev is 0/missing or today is missing. */
export function pctChange(today, prev) {
  if (today == null || prev == null || prev === 0) return null;
  return ((today - prev) / prev) * 100;
}

const EMPTY = (width, height, padding) => ({
  areaPath: "", linePath: "", prevPath: null,
  xTicks: [], yGrid: [], dots: [], width, height, padding, baselineY: 0,
});

/** Build area/line/comparison paths, axis ticks, and hover dots from points. */
export function buildRevenueChart(points, opts = {}) {
  const width = opts.width ?? 560;
  const height = opts.height ?? 180;
  const padding = opts.padding ?? { top: 10, right: 8, bottom: 22, left: 8 };
  if (!Array.isArray(points) || points.length < 2) return EMPTY(width, height, padding);

  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const baselineY = padding.top + innerH;

  const todays = points.map((p) => Number(p.value) || 0);
  const hasPrev = points.every((p) => typeof p.prev === "number");
  const prevs = hasPrev ? points.map((p) => Number(p.prev) || 0) : [];
  const max = Math.max(1, ...todays, ...prevs); // >=1 so a flat/zero series stays on baseline

  const stepX = innerW / (points.length - 1);
  const xAt = (i) => padding.left + i * stepX;
  const yAt = (v) => padding.top + innerH - (v / max) * innerH;
  const f = (n) => n.toFixed(1);

  const linePts = todays.map((v, i) => [xAt(i), yAt(v)]);
  const linePath = "M " + linePts.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L ");
  const areaPath =
    `M ${f(xAt(0))} ${f(baselineY)} ` +
    linePts.map(([x, y]) => `L ${f(x)} ${f(y)}`).join(" ") +
    ` L ${f(xAt(points.length - 1))} ${f(baselineY)} Z`;
  const prevPath = hasPrev
    ? "M " + prevs.map((v, i) => `${f(xAt(i))} ${f(yAt(v))}`).join(" L ")
    : null;

  const tickEvery = Math.max(1, Math.ceil(points.length / 7));
  const xTicks = [];
  for (let i = 0; i < points.length; i += tickEvery) xTicks.push({ x: xAt(i), label: points[i].label });

  const yGrid = [0, 0.5, 1].map((g) => ({ y: padding.top + innerH - g * innerH }));
  const dots = points.map((p, i) => ({ x: xAt(i), y: yAt(todays[i]), label: p.label, value: todays[i] }));

  return { areaPath, linePath, prevPath, xTicks, yGrid, dots, width, height, padding, baselineY };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && node --test 'test/revenueChart.test.mjs'`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/revenueChart.mjs frontend/test/revenueChart.test.mjs
git commit -m "Add revenueChart.mjs: pure geometry for the revenue area chart"
```

---

### Task 2: `RevenueChart` component

**Files:**
- Create: `frontend/components/RevenueChart.js`

**Interfaces:**
- Consumes: `buildRevenueChart` from Task 1.
- Produces: `default export RevenueChart({ points, currency })` — renders an SVG area chart; returns `null` when there's nothing to draw.

- [ ] **Step 1: Implement** — `frontend/components/RevenueChart.js`

```jsx
"use client";
import { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { buildRevenueChart } from "../lib/revenueChart.mjs";

const VIEW_W = 560;
const VIEW_H = 180;

export default function RevenueChart({ points, currency = "USD" }) {
  const reduce = useReducedMotion();
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);
  const chart = buildRevenueChart(points, { width: VIEW_W, height: VIEW_H });
  if (!chart.linePath) return null;

  const fmt = (v) => `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency}`;

  function onMove(e) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    let nearest = chart.dots[0];
    for (const d of chart.dots) {
      if (Math.abs(d.x - x) < Math.abs(nearest.x - x)) nearest = d;
    }
    setHover(nearest);
  }

  return (
    <div className="w-full">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Revenue today compared with yesterday"
      >
        <defs>
          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#008060" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#008060" stopOpacity="0" />
          </linearGradient>
        </defs>

        {chart.yGrid.map((g, i) => (
          <line key={i} x1={chart.padding.left} y1={g.y} x2={VIEW_W - chart.padding.right} y2={g.y}
            className="text-foreground" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
        ))}

        <path d={chart.areaPath} fill="url(#revFill)" stroke="none" />

        {chart.prevPath && (
          <path d={chart.prevPath} className="text-muted-foreground" fill="none"
            stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="4 4" />
        )}

        <motion.path d={chart.linePath} fill="none" stroke="#008060" strokeWidth="2.5"
          strokeLinejoin="round" strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, ease: "easeOut" }} />

        {hover && (
          <g>
            <line x1={hover.x} y1={chart.padding.top} x2={hover.x} y2={chart.baselineY}
              className="text-foreground" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
            <circle cx={hover.x} cy={hover.y} r="3.5" fill="#008060" />
          </g>
        )}

        {chart.xTicks.map((t, i) => (
          <text key={i} x={t.x} y={VIEW_H - 6} textAnchor="middle"
            className="fill-muted-foreground" style={{ fontSize: 10 }}>{t.label}</text>
        ))}
      </svg>

      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-shopify" /> Today</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed border-current" /> Yesterday</span>
        </div>
        {hover && <span className="font-mono text-foreground">{hover.label} · {fmt(hover.value)}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds/renders** (no unit test for a presentational SVG component)

Run: `cd frontend && npx next build 2>&1 | tail -5` (after Task 4 wires it in, the build covers it). For now: `node -e "import('./components/RevenueChart.js').catch(e=>{console.error(e.message);process.exit(1)})"` is NOT valid (JSX/client) — rely on the build smoke in Task 4.
Expected: deferred to Task 4's build smoke.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/RevenueChart.js
git commit -m "Add RevenueChart component: gradient area + comparison line + hover"
```

---

### Task 3: Enrich demo data

**Files:**
- Modify: `frontend/lib/demoData.mjs` (the `sales-today` step `detail`)
- Modify: `frontend/test/demoData.test.mjs` (the sales-shape test, currently asserts `series` is an Array)

**Interfaces:**
- Produces: `sales-today.detail` now has `period`, `averageByCurrency`, `comparison.totalsByCurrency`, and `series.points = [{ label, value, prev }]`.

- [ ] **Step 1: Update the sales-shape test** — in `frontend/test/demoData.test.mjs`, replace the test at "sales step carries totalsByCurrency…":

```js
test("sales step carries totals, comparison, and an hourly points series", () => {
  const sales = DEMO_SCRIPT.find((s) => s.event.type === "sales");
  assert.ok(sales, "a sales step exists");
  const d = sales.event.detail;
  assert.equal(typeof d.orderCount, "number");
  assert.ok(d.totalsByCurrency.USD > 0);
  assert.ok(d.comparison.totalsByCurrency.USD > 0);
  assert.ok(Array.isArray(d.series.points) && d.series.points.length >= 2);
  const p = d.series.points[0];
  assert.ok(typeof p.label === "string" && typeof p.value === "number" && typeof p.prev === "number");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node --test 'test/demoData.test.mjs'`
Expected: FAIL — `d.comparison` undefined / `d.series.points` undefined.

- [ ] **Step 3: Implement** — replace the `sales-today` `detail` in `frontend/lib/demoData.mjs` with:

```js
      detail: {
        store: "northwind",
        period: "today",
        totalsByCurrency: { USD: 2480 },
        orderCount: 18,
        averageByCurrency: { USD: 137.78 },
        comparison: { label: "yesterday", totalsByCurrency: { USD: 2100 } },
        series: {
          points: [
            { label: "8a", value: 40, prev: 30 },
            { label: "9a", value: 80, prev: 70 },
            { label: "10a", value: 120, prev: 110 },
            { label: "11a", value: 150, prev: 130 },
            { label: "12p", value: 210, prev: 170 },
            { label: "1p", value: 180, prev: 160 },
            { label: "2p", value: 160, prev: 150 },
            { label: "3p", value: 230, prev: 190 },
            { label: "4p", value: 250, prev: 210 },
            { label: "5p", value: 300, prev: 250 },
            { label: "6p", value: 240, prev: 210 },
            { label: "7p", value: 200, prev: 180 },
            { label: "8p", value: 180, prev: 140 },
            { label: "9p", value: 140, prev: 100 },
          ],
        },
      },
```

(Today values sum to 2,480; prev to 2,100 → ▲ 18%. AOV 2,480/18 = 137.78.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && node --test 'test/demoData.test.mjs'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/demoData.mjs frontend/test/demoData.test.mjs
git commit -m "Enrich demo sales data: hourly points + yesterday comparison"
```

---

### Task 4: Rebuild the `Sales` view + remove the old sparkline

**Files:**
- Modify: `frontend/components/ResultPanel.js` (imports + `Sales` function)
- Delete: `frontend/components/Sparkline.js`, `frontend/lib/sparkline.mjs`, `frontend/test/sparkline.test.mjs`

**Interfaces:**
- Consumes: `RevenueChart` (Task 2), `pctChange` (Task 1), enriched `detail` (Task 3).

- [ ] **Step 1: Swap imports** in `frontend/components/ResultPanel.js` — replace `import Sparkline from "./Sparkline";` with:

```jsx
import RevenueChart from "./RevenueChart";
import { pctChange } from "../lib/revenueChart.mjs";
```

- [ ] **Step 2: Replace the entire `Sales` function** with:

```jsx
function DeltaBadge({ pct }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${up ? "text-shopify-light" : "text-rose-400"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% vs yesterday
    </span>
  );
}

function Sales({ detail }) {
  const rollup = detail.combined != null;
  const byCurrency = rollup ? detail.combined.byCurrency : detail.totalsByCurrency;
  const orderCount = rollup ? detail.combined.orderCount : detail.orderCount;
  const points = detail.series?.points;
  const hasChart = !rollup && Array.isArray(points) && points.length >= 2;

  const cur = Object.keys(byCurrency || {})[0] || "USD";
  const todayTotal = byCurrency?.[cur];
  const prevTotal = detail.comparison?.totalsByCurrency?.[cur];
  const pct = hasChart ? pctChange(todayTotal, prevTotal) : null;
  const aov = detail.averageByCurrency?.[cur] ?? (orderCount ? (todayTotal || 0) / orderCount : null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShoppingBag className="h-4 w-4" /> Total sales · {rollup ? "all stores · " : ""}Today
        </div>
        <DeltaBadge pct={pct} />
      </div>

      <div className="text-4xl font-semibold tracking-tight">{fmtMoney(byCurrency)}</div>

      {hasChart && <RevenueChart points={points} currency={cur} />}

      <div className="grid grid-cols-2 gap-4 border-t border-border/50 pt-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Orders</div>
          <div className="text-xl font-semibold">{orderCount ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Avg order value</div>
          <div className="text-xl font-semibold">{aov != null ? `${aov.toFixed(2)} ${cur}` : "—"}</div>
        </div>
      </div>

      {rollup && (
        <ul className="mt-2 space-y-1 text-sm">
          {detail.perStore.map((s) => (
            <li key={s.store} className="flex justify-between border-t border-border/50 py-1">
              <span>{s.store}</span>
              <span className="font-mono">{fmtMoney(s.totalsByCurrency)} · {s.orderCount}{s.capped ? " (capped)" : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Delete the superseded sparkline files**

```bash
git rm frontend/components/Sparkline.js frontend/lib/sparkline.mjs frontend/test/sparkline.test.mjs
```

- [ ] **Step 4: Run the full frontend test suite**

Run: `cd frontend && node --test 'test/**/*.mjs'`
Expected: PASS, with no reference to the deleted `sparkline.test.mjs`. (revenueChart + demoData + demoPhases tests pass.)

- [ ] **Step 5: Build smoke (compiles the new components)**

Run: `cd frontend && rm -rf .next && npx next build 2>&1 | tail -8`
Expected: build completes (`Compiled successfully` / route table), no module-not-found for `./Sparkline`.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/ResultPanel.js
git commit -m "Rebuild Sales view: Shopify-style revenue chart, delta, KPI row"
```

---

## Self-Review

**Spec coverage:** headline + delta badge (Task 4), area+line+gradient (Tasks 1–2), hourly x-axis (Task 1 `xTicks`), dashed yesterday line (Task 1 `prevPath` + Task 2), hover tooltip (Task 2), KPI row (Task 4), demo data with comparison (Task 3), graceful fallback (Task 4 `hasChart`), remove Sparkline (Task 4), tests (Tasks 1, 3). All covered.

**Type consistency:** `points: {label,value,prev}` is consistent across demoData (Task 3), buildRevenueChart (Task 1), RevenueChart (Task 2), and ResultPanel (Task 4). `pctChange(today, prev)` signature consistent. `detail.comparison.totalsByCurrency[cur]` and `detail.averageByCurrency[cur]` consistent between Tasks 3 and 4.

**No placeholders:** all steps contain full code and exact commands.
