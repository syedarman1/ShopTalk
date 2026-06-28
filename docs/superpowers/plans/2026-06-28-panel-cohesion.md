# Panel Cohesion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the orders/products/customers result panels to match the revenue view (header + summary KPI strip + colored status pills + light per-panel visuals).

**Architecture:** Pure summary helpers in a `.mjs` (unit-tested); shared presentational components in `PanelUI.js`; `ResultPanel` swaps the three bare-table branches for dedicated components. All summaries derive from existing demo arrays — no demo-data or backend changes.

**Tech Stack:** Next.js 14 / React 18, Tailwind, lucide-react, framer-motion (present). Tests: `node --test 'test/**/*.mjs'` from `frontend/`. No new dependencies.

## Global Constraints
- **No new dependencies**; **no demo-data or backend changes** (derive at render).
- Tests run from `frontend/` via `node --test 'test/**/*.mjs'`; test files in `frontend/test/`.
- Money displays via the existing `fmtMoney` (e.g. `1840.00 USD`) — no `$`/thousands reformat.
- Tones: `success`=`bg-shopify/15 text-shopify-light`, `warn`=`bg-amber-500/15 text-amber-400`, `danger`=`bg-rose-500/15 text-rose-400`, `muted`=`bg-muted text-muted-foreground`. `LOW_STOCK = 10`.
- `list_stores` panel keeps its existing `Rows` table (out of scope); `Rows` stays.

---

### Task 1: Pure panel summaries (`panelSummaries.mjs`)

**Files:**
- Create: `frontend/lib/panelSummaries.mjs`
- Test: `frontend/test/panelSummaries.test.mjs`

**Interfaces:**
- Produces:
  - `stockLevel(inventory) => "out" | "low" | "in"`
  - `summarizeOrders(orders=[]) => { count, valueByCurrency, unfulfilled }`
  - `summarizeProducts(products=[]) => { count, active, needRestock }`
  - `summarizeCustomers(customers=[]) => { count, spentByCurrency, avgOrders, maxSpent }`

- [ ] **Step 1: Write the failing test** — `frontend/test/panelSummaries.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stockLevel, summarizeOrders, summarizeProducts, summarizeCustomers,
} from "../lib/panelSummaries.mjs";

test("stockLevel classifies out/low/in", () => {
  assert.equal(stockLevel(0), "out");
  assert.equal(stockLevel(5), "low");
  assert.equal(stockLevel(10), "low");
  assert.equal(stockLevel(11), "in");
  assert.equal(stockLevel(null), "in");
});

test("summarizeOrders totals value and counts unfulfilled", () => {
  const r = summarizeOrders([
    { total: 168, currency: "USD", fulfillmentStatus: "UNFULFILLED" },
    { total: 92.5, currency: "USD", fulfillmentStatus: "FULFILLED" },
    { total: 240, currency: "USD", fulfillmentStatus: "PARTIALLY_FULFILLED" },
    { total: 54, currency: "USD", fulfillmentStatus: null },
  ]);
  assert.equal(r.count, 4);
  assert.deepEqual(r.valueByCurrency, { USD: 554.5 });
  assert.equal(r.unfulfilled, 2); // UNFULFILLED + PARTIALLY_FULFILLED; FULFILLED & null excluded
});

test("summarizeProducts counts active and restock-needed", () => {
  const r = summarizeProducts([
    { status: "ACTIVE", totalInventory: 7 },    // low
    { status: "ACTIVE", totalInventory: 130 },  // in
    { status: "DRAFT", totalInventory: 0 },     // out
  ]);
  assert.equal(r.count, 3);
  assert.equal(r.active, 2);
  assert.equal(r.needRestock, 2); // low + out
});

test("summarizeCustomers totals spend, averages orders, tracks max", () => {
  const r = summarizeCustomers([
    { amountSpent: 1840, currency: "USD", orders: 12 },
    { amountSpent: 1320.5, currency: "USD", orders: 9 },
    { amountSpent: 980, currency: "USD", orders: 7 },
    { amountSpent: 610, currency: "USD", orders: 5 },
  ]);
  assert.equal(r.count, 4);
  assert.deepEqual(r.spentByCurrency, { USD: 4750.5 });
  assert.equal(r.avgOrders, 8); // round(33/4)=8
  assert.equal(r.maxSpent, 1840);
});

test("summaries handle empty input", () => {
  assert.deepEqual(summarizeOrders([]), { count: 0, valueByCurrency: {}, unfulfilled: 0 });
  assert.deepEqual(summarizeProducts([]), { count: 0, active: 0, needRestock: 0 });
  assert.deepEqual(summarizeCustomers([]), { count: 0, spentByCurrency: {}, avgOrders: 0, maxSpent: 0 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node --test 'test/panelSummaries.test.mjs'`
Expected: FAIL — `Cannot find module '../lib/panelSummaries.mjs'`.

- [ ] **Step 3: Implement** — `frontend/lib/panelSummaries.mjs`

```js
// panelSummaries.mjs — pure derivations for the orders/products/customers panels.
// No React. Group money by currency (never sum across currencies).

const LOW_STOCK = 10;

export function stockLevel(inventory) {
  if (inventory === 0) return "out";
  if (typeof inventory === "number" && inventory > 0 && inventory <= LOW_STOCK) return "low";
  return "in";
}

function addMoney(acc, amount, currency) {
  if (currency != null && amount != null) acc[currency] = (acc[currency] || 0) + amount;
}

export function summarizeOrders(orders = []) {
  const valueByCurrency = {};
  let unfulfilled = 0;
  for (const o of orders) {
    addMoney(valueByCurrency, o.total, o.currency);
    if (o.fulfillmentStatus && o.fulfillmentStatus !== "FULFILLED") unfulfilled += 1;
  }
  return { count: orders.length, valueByCurrency, unfulfilled };
}

export function summarizeProducts(products = []) {
  let active = 0;
  let needRestock = 0;
  for (const p of products) {
    if (p.status === "ACTIVE") active += 1;
    const lvl = stockLevel(p.totalInventory);
    if (lvl === "out" || lvl === "low") needRestock += 1;
  }
  return { count: products.length, active, needRestock };
}

export function summarizeCustomers(customers = []) {
  const spentByCurrency = {};
  let totalOrders = 0;
  let maxSpent = 0;
  for (const c of customers) {
    addMoney(spentByCurrency, c.amountSpent, c.currency);
    totalOrders += c.orders || 0;
    if ((c.amountSpent || 0) > maxSpent) maxSpent = c.amountSpent || 0;
  }
  const count = customers.length;
  return { count, spentByCurrency, avgOrders: count ? Math.round(totalOrders / count) : 0, maxSpent };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && node --test 'test/panelSummaries.test.mjs'`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/panelSummaries.mjs frontend/test/panelSummaries.test.mjs
git commit -m "Add panelSummaries.mjs: pure summaries for orders/products/customers"
```

---

### Task 2: Shared panel UI components (`PanelUI.js`)

**Files:**
- Create: `frontend/components/PanelUI.js`

**Interfaces:**
- Produces (named exports): `PanelHeader({ icon, title, badge })`, `StatStrip({ stats })`, `StatusPill({ tone, children })`, `SplitBar({ parts })`, `SpendBar({ fraction })`.

- [ ] **Step 1: Implement** — `frontend/components/PanelUI.js`

```jsx
"use client";

const TONES = {
  success: "bg-shopify/15 text-shopify-light",
  warn: "bg-amber-500/15 text-amber-400",
  danger: "bg-rose-500/15 text-rose-400",
  muted: "bg-muted text-muted-foreground",
};

export function StatusPill({ tone = "muted", children }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone] || TONES.muted}`}>
      {children}
    </span>
  );
}

export function PanelHeader({ icon: Icon, title, badge }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" /> {title}
      </div>
      {badge}
    </div>
  );
}

export function StatStrip({ stats }) {
  return (
    <div
      className="grid gap-4 border-y border-border/50 py-3"
      style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
    >
      {stats.map((s) => (
        <div key={s.label}>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</div>
          <div className="text-lg font-semibold">{s.value}</div>
        </div>
      ))}
    </div>
  );
}

export function SplitBar({ parts }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0) || 1;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {parts.filter((p) => p.value > 0).map((p, i) => (
        <div key={i} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} />
      ))}
    </div>
  );
}

export function SpendBar({ fraction }) {
  const pct = Math.max(2, Math.min(100, (fraction || 0) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-shopify" style={{ width: `${pct}%` }} />
    </div>
  );
}
```

- [ ] **Step 2: Commit** (build smoke happens in Task 3 once wired in)

```bash
git add frontend/components/PanelUI.js
git commit -m "Add shared PanelUI components (header, stat strip, pills, bars)"
```

---

### Task 3: Rebuild orders/products/customers in `ResultPanel`

**Files:**
- Modify: `frontend/components/ResultPanel.js`

**Interfaces:**
- Consumes: `panelSummaries.mjs` (Task 1) + `PanelUI.js` (Task 2).

- [ ] **Step 1: Add imports** — after the existing `pctChange` import line in `frontend/components/ResultPanel.js`, add:

```jsx
import { PanelHeader, StatStrip, StatusPill, SplitBar, SpendBar } from "./PanelUI";
import { summarizeOrders, summarizeProducts, summarizeCustomers, stockLevel } from "../lib/panelSummaries.mjs";
```

- [ ] **Step 2: Add the three panel components** — insert these functions right after the `Sales` function (before `function Rows`):

```jsx
const fulfillLabel = (s) =>
  ({ FULFILLED: "Fulfilled", UNFULFILLED: "Unfulfilled", PARTIALLY_FULFILLED: "Partial" }[s] || s || "—");

function Orders({ orders }) {
  const { count, valueByCurrency, unfulfilled } = summarizeOrders(orders);
  const badge = unfulfilled > 0
    ? <StatusPill tone="warn">{unfulfilled} unfulfilled</StatusPill>
    : <StatusPill tone="success">all fulfilled</StatusPill>;
  return (
    <div className="space-y-4">
      <PanelHeader icon={Receipt} title="Recent orders" badge={badge} />
      <StatStrip stats={[
        { label: "Orders", value: count },
        { label: "Value", value: fmtMoney(valueByCurrency) },
        { label: "Unfulfilled", value: unfulfilled },
      ]} />
      <SplitBar parts={[
        { value: count - unfulfilled, className: "bg-shopify" },
        { value: unfulfilled, className: "bg-amber-400" },
      ]} />
      <ul>
        {orders.map((o) => (
          <li key={o.name} className="flex items-center gap-3 border-t border-border/50 py-2 text-sm">
            <span className="w-14 font-mono text-muted-foreground">{o.name}</span>
            <span className="flex-1 truncate">{o.customer ?? "—"}</span>
            <span className="font-mono">{o.total != null ? `${o.total.toFixed(2)} ${o.currency}` : "—"}</span>
            <span className="w-24 text-right">
              <StatusPill tone={o.fulfillmentStatus === "FULFILLED" ? "success" : o.fulfillmentStatus ? "warn" : "muted"}>
                {fulfillLabel(o.fulfillmentStatus)}
              </StatusPill>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Products({ products }) {
  const { count, active, needRestock } = summarizeProducts(products);
  const badge = needRestock > 0
    ? <StatusPill tone="warn">{needRestock} need restock</StatusPill>
    : <StatusPill tone="success">stock healthy</StatusPill>;
  return (
    <div className="space-y-4">
      <PanelHeader icon={Package} title="Products" badge={badge} />
      <StatStrip stats={[
        { label: "Products", value: count },
        { label: "Active", value: active },
        { label: "Need restock", value: needRestock },
      ]} />
      <ul>
        {products.map((p, i) => {
          const lvl = stockLevel(p.totalInventory);
          const tone = lvl === "out" ? "danger" : lvl === "low" ? "warn" : "success";
          const text = lvl === "out" ? "Out of stock" : lvl === "low" ? `Low · ${p.totalInventory}` : `${p.totalInventory ?? "—"} in stock`;
          return (
            <li key={`${p.title}-${i}`} className="flex items-center gap-3 border-t border-border/50 py-2 text-sm">
              <span className="flex flex-1 items-center gap-2 truncate">
                <span className="truncate">{p.title}</span>
                {p.status !== "ACTIVE" && <StatusPill tone="muted">Draft</StatusPill>}
              </span>
              <span className="font-mono">{p.price != null ? `${p.price.toFixed(2)} ${p.currency}` : "—"}</span>
              <span className="w-28 text-right"><StatusPill tone={tone}>{text}</StatusPill></span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Customers({ customers }) {
  const { count, spentByCurrency, avgOrders, maxSpent } = summarizeCustomers(customers);
  return (
    <div className="space-y-4">
      <PanelHeader icon={Users} title="Repeat customers" badge={<StatusPill tone="muted">{count} customers</StatusPill>} />
      <StatStrip stats={[
        { label: "Customers", value: count },
        { label: "Total spent", value: fmtMoney(spentByCurrency) },
        { label: "Avg orders", value: avgOrders },
      ]} />
      <ul className="space-y-2">
        {customers.map((c, i) => (
          <li key={`${c.email}-${i}`} className="space-y-1 border-t border-border/50 pt-2">
            <div className="flex items-center gap-3 text-sm">
              <span className="w-5 text-center font-mono text-muted-foreground">{i + 1}</span>
              <span className="flex-1 truncate">{c.name}</span>
              <span className="text-muted-foreground">{c.orders ?? "—"} orders</span>
              <span className="font-mono">{c.amountSpent != null ? `${c.amountSpent.toFixed(2)} ${c.currency}` : "—"}</span>
            </div>
            <div className="pl-8"><SpendBar fraction={maxSpent ? (c.amountSpent || 0) / maxSpent : 0} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Route the branches to the new components** — in `renderResult`, replace the existing `orders`/`order`, `products`, and `customers` blocks (the ones using `Rows`) with:

```jsx
  if (latest.type === "orders" || latest.type === "order") {
    const orders = latest.type === "order" ? (d ? [d] : []) : d || [];
    return <Orders orders={orders} />;
  }

  if (latest.type === "products") return <Products products={d || []} />;

  if (latest.type === "customers") return <Customers customers={d || []} />;
```

(Leave the `stores` branch and the `Rows` helper untouched.)

- [ ] **Step 4: Run the full frontend suite**

Run: `cd frontend && node --test 'test/**/*.mjs'`
Expected: PASS (revenueChart + panelSummaries + demoData + demoPhases).

- [ ] **Step 5: Build smoke**

Run: `cd frontend && rm -rf .next && npx next build 2>&1 | tail -8`
Expected: `Compiled successfully` / route table; no errors. (If a stale `node_modules` error appears, run `npm ci` then rebuild — known environment issue.)

- [ ] **Step 6: Commit**

```bash
git add frontend/components/ResultPanel.js
git commit -m "Rebuild orders/products/customers panels with cohesive UI"
```

---

## Self-Review

**Spec coverage:** pure summaries + stockLevel (Task 1), shared header/strip/pill/bars (Task 2), Orders/Products/Customers rebuild with badges + KPI strip + split/spend bars + stock emphasis (Task 3), `Rows`/stores untouched (Task 3 note), tests (Task 1). All covered.

**Type consistency:** `summarizeOrders → {count, valueByCurrency, unfulfilled}`, `summarizeProducts → {count, active, needRestock}`, `summarizeCustomers → {count, spentByCurrency, avgOrders, maxSpent}`, `stockLevel → "out"|"low"|"in"` — used identically in Task 3. `StatStrip` takes `stats:[{label,value}]`; `SplitBar` takes `parts:[{value,className}]`; `SpendBar` takes `{fraction}`; `PanelHeader` takes `{icon,title,badge}`; `StatusPill` takes `{tone,children}` — all consistent between Tasks 2 and 3. Icons `Receipt`/`Package`/`Users` already imported in ResultPanel; `fmtMoney` already defined there.

**No placeholders:** every step has full code + exact commands.
