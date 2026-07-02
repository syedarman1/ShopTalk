# Daily Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `get_daily_briefing` MCP tool (yesterday's sales + unfulfilled orders + low stock, per store) plus a `"yesterday"` period for `get_sales`, so a Poke automation can deliver a morning text.

**Architecture:** Extend `periodToRange` with a bounded `yesterday` range (store timezone, DST-safe); add `getLowStock` and a `getDailyBriefing` composer using the existing allSettled rollup pattern; register one new MCP tool; document the opt-in Poke automation in the README.

**Tech Stack:** Node 22, existing mocked-fetch test pattern (`node --test`). No new dependencies. No server-side scheduling of any kind.

## Global Constraints
- Read-only; no push/scheduler — the morning text is a user-created Poke automation (opt-in), and the README must say so.
- Query style stays consistent with prod: unquoted `created_at:` terms, space = AND.
- Rollup failure semantics match `getSalesAllStores`: healthy stores report, failures surface as `{ store, error }`.
- Low-stock default threshold 10, limit 10, `status:active` only, `sortKey: INVENTORY_TOTAL` (lowest first).

---

### Task 1: `yesterday` period + bounded sales window

**Files:** Modify `backend/shopify.js` (periodToRange, getSales query), `backend/mcp-tools.js` (period enum). Test `backend/test/shopify.test.js`.

**Interfaces:** Produces `periodToRange(period, now, timeZone) => { since, until?, label }`; `getSales(storeKey, "yesterday")` now valid.

- [ ] **Step 1: failing tests** — append to `backend/test/shopify.test.js`:

```js
test("periodToRange('yesterday') spans yesterday's local day (UTC)", () => {
  const now = new Date("2026-06-20T15:30:00Z");
  const r = periodToRange("yesterday", now);
  assert.equal(r.since, "2026-06-19T00:00:00.000Z");
  assert.equal(r.until, "2026-06-20T00:00:00.000Z");
  assert.equal(r.label, "yesterday");
});

test("periodToRange('yesterday') honors a non-UTC timezone", () => {
  const now = new Date("2026-06-25T04:00:00Z"); // midnight EDT
  const r = periodToRange("yesterday", now, "America/New_York");
  assert.equal(r.since, "2026-06-24T04:00:00.000Z");
  assert.equal(r.until, "2026-06-25T04:00:00.000Z");
});

test("periodToRange('today') has no upper bound", () => {
  const r = periodToRange("today", new Date("2026-06-20T15:30:00Z"));
  assert.equal(r.until, undefined);
});
```

- [ ] **Step 2:** `cd backend && node --test` → expect 3 failures (yesterday unknown).
- [ ] **Step 3: implement** — replace `periodToRange` body:

```js
/** Map a named period to an ISO time range relative to `now`, in `timeZone`. */
export function periodToRange(period, now, timeZone = "UTC") {
  const startToday = startOfDayISO(now, timeZone);
  if (period === "today") return { since: startToday, label: "today" };
  if (period === "yesterday") {
    // 1ms before today's local midnight is an instant inside yesterday (local),
    // so its local day-start is yesterday's midnight — DST-safe.
    const since = startOfDayISO(new Date(Date.parse(startToday) - 1), timeZone);
    return { since, until: startToday, label: "yesterday" };
  }
  const days = { "7d": 7, "30d": 30 }[period];
  if (!days) {
    throw new Error(`Unknown period "${period}". Use today, yesterday, 7d, or 30d.`);
  }
  const since = new Date(Date.parse(startToday) - days * 24 * 60 * 60 * 1000).toISOString();
  return { since, label: `last ${days} days` };
}
```

In `getSales`, destructure `until` and bound the query:
```js
  const { since, until, label } = periodToRange(period, new Date(), timeZone);
```
```js
  const data = await shopifyGraphQL(store, query, {
    q: `created_at:>=${since}` + (until ? ` created_at:<${until}` : ""),
  });
```
In `mcp-tools.js`: `.enum(["today", "7d", "30d"])` → `.enum(["today", "yesterday", "7d", "30d"])`.

- [ ] **Step 4:** `node --test` → all pass (40). **Step 5:** commit `feat: add yesterday period` (message: "Add 'yesterday' period to get_sales (store-timezone, bounded range)").

---

### Task 2: `getLowStock` + `getDailyBriefing` + network tests

**Files:** Modify `backend/shopify.js` (two new exports). Test `backend/test/briefing.network.test.js` (new).

**Interfaces:** Produces `getLowStock(storeKey, { threshold=10, limit=10 }) => { store, threshold, products }` and `getDailyBriefing({ storeKey, lowStockThreshold=10 }) => { period: "yesterday", stores: [{ store, label, sales, unfulfilled: { count, orders }, lowStock }], failures }`.

- [ ] **Step 1: failing tests** — create `backend/test/briefing.network.test.js`:

```js
// Briefing-layer tests with a mocked fetch. Routes GraphQL calls by their
// variables, so the sales/unfulfilled/low-stock queries are each verified.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SHOPIFY_STORES = JSON.stringify([
  { key: "alpha", label: "Alpha", shopDomain: "alpha.myshopify.com", clientId: "id-a", clientSecret: "sec-a", apiVersion: "2026-01" },
  { key: "beta", label: "Beta", shopDomain: "beta.myshopify.com", clientId: "id-b", clientSecret: "sec-b", apiVersion: "2026-01" },
]);

const { getSales, getLowStock, getDailyBriefing } = await import("../shopify.js");

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const TOKEN_OK = { access_token: "tok", scope: "read_orders", expires_in: 86399 };

const ORDERS_YDAY = { data: { orders: { edges: [
  { node: { name: "#9", createdAt: "2026-06-30T12:00:00Z", test: false, cancelledAt: null,
    displayFulfillmentStatus: "FULFILLED", displayFinancialStatus: "PAID",
    currentTotalPriceSet: { shopMoney: { amount: "10.00", currencyCode: "USD" } },
    customer: { displayName: "A" } } },
], pageInfo: { hasNextPage: false } } } };
const ORDERS_UNFUL = { data: { orders: { edges: [
  { node: { name: "#42", createdAt: "2026-07-01T09:00:00Z", test: false, cancelledAt: null,
    displayFulfillmentStatus: "UNFULFILLED", displayFinancialStatus: "PAID",
    currentTotalPriceSet: { shopMoney: { amount: "25.00", currencyCode: "USD" } },
    customer: { displayName: "B" } } },
] } } };
const PRODUCTS_LOW = { data: { products: { edges: [
  { node: { title: "Hoodie", status: "ACTIVE", totalInventory: 3,
    priceRangeV2: { minVariantPrice: { amount: "68.00", currencyCode: "USD" } } } },
] } } };

function alphaRouter(url, init = {}) {
  const u = String(url);
  if (u.includes("/oauth/access_token")) return json(TOKEN_OK);
  const body = JSON.parse(String(init.body || "{}"));
  const q = body?.variables?.q || "";
  if ((body.query || "").includes("ianaTimezone"))
    return json({ data: { shop: { ianaTimezone: "UTC" } } });
  if (q.includes("fulfillment_status:unfulfilled")) return json(ORDERS_UNFUL);
  if (q.includes("created_at:>=")) {
    assert.match(q, /created_at:>=.+ created_at:</); // yesterday = bounded range
    return json(ORDERS_YDAY);
  }
  if (q.includes("inventory_total:<=")) {
    assert.match(q, /status:active inventory_total:<=10/);
    return json(PRODUCTS_LOW);
  }
  throw new Error(`unrouted alpha query: ${q}`);
}

test("getSales('yesterday') sends a bounded created_at range", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => alphaRouter(url, init));
  const r = await getSales("alpha", "yesterday");
  assert.equal(r.label, "yesterday");
  assert.deepEqual(r.totalsByCurrency, { USD: 10 });
});

test("getLowStock queries active products at/below the threshold", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => alphaRouter(url, init));
  const r = await getLowStock("alpha", { threshold: 10 });
  assert.equal(r.store, "alpha");
  assert.equal(r.threshold, 10);
  assert.equal(r.products[0].title, "Hoodie");
  assert.equal(r.products[0].totalInventory, 3);
});

test("getDailyBriefing bundles sales/unfulfilled/low stock; failures don't kill it", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url).includes("beta.myshopify.com/admin/oauth")) return json({}, 401);
    return alphaRouter(url, init);
  });
  const r = await getDailyBriefing();
  assert.equal(r.period, "yesterday");
  assert.equal(r.stores.length, 1);
  const s = r.stores[0];
  assert.equal(s.store, "alpha");
  assert.equal(s.label, "Alpha");
  assert.deepEqual(s.sales.totalsByCurrency, { USD: 10 });
  assert.equal(s.unfulfilled.count, 1);
  assert.equal(s.unfulfilled.orders[0].name, "#42");
  assert.equal(s.lowStock.products.length, 1);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].store, "beta");
});
```

- [ ] **Step 2:** `node --test` → new file fails (`getLowStock` not exported).
- [ ] **Step 3: implement** — append to `backend/shopify.js` (after `getSalesAllStores`):

```js
/** Active products at/below a stock threshold, lowest inventory first. */
export async function getLowStock(storeKey, { threshold = 10, limit = 10 } = {}) {
  const store = resolveStore(storeKey);
  const gql = `
    query($q: String!, $n: Int!) {
      products(first: $n, query: $q, sortKey: INVENTORY_TOTAL) {
        edges { node {
          title status totalInventory
          priceRangeV2 { minVariantPrice { amount currencyCode } }
        } }
      }
    }`;
  const data = await shopifyGraphQL(store, gql, {
    q: `status:active inventory_total:<=${threshold}`,
    n: limit,
  });
  return {
    store: store.key,
    threshold,
    products: data.products.edges.map((e) => shapeProduct(e.node)),
  };
}

/**
 * Morning-briefing bundle: yesterday's sales, unfulfilled orders, and
 * low-stock products — per store (all stores unless storeKey is given).
 * Store-level failures don't kill the briefing; they surface in `failures`.
 * Read-only and pull-only: nothing here schedules or sends anything.
 */
export async function getDailyBriefing({ storeKey, lowStockThreshold = 10 } = {}) {
  const stores = storeKey ? [resolveStore(storeKey)] : getStores();
  const settled = await Promise.allSettled(
    stores.map(async (store) => {
      const [sales, orders, lowStock] = await Promise.all([
        getSales(store.key, "yesterday"),
        getOrders(store.key, { status: "unfulfilled", limit: 10 }),
        getLowStock(store.key, { threshold: lowStockThreshold }),
      ]);
      return {
        store: store.key,
        label: store.label,
        sales,
        unfulfilled: { count: orders.orders.length, orders: orders.orders },
        lowStock,
      };
    })
  );
  const perStore = [];
  const failures = [];
  settled.forEach((res, i) => {
    if (res.status === "fulfilled") perStore.push(res.value);
    else failures.push({ store: stores[i].key, error: res.reason?.message || String(res.reason) });
  });
  return { period: "yesterday", stores: perStore, failures };
}
```

- [ ] **Step 4:** `node --test` → all pass (43). **Step 5:** commit ("Add getLowStock and getDailyBriefing (allSettled per store)").

---

### Task 3: MCP tool + README + push + CI green

**Files:** Modify `backend/mcp-tools.js` (import + one registerTool), `README.md`.

- [ ] **Step 1: register the tool** — add `getDailyBriefing` to the `./shopify.js` import list, and after the `get_sales` registration add:

```js
  // get_daily_briefing ------------------------------------------------------
  server.registerTool(
    "get_daily_briefing",
    {
      title: "Daily Briefing",
      description:
        "Morning summary for the merchant: yesterday's sales (revenue, orders, " +
        "AOV), orders still unfulfilled, and low-stock products — per store. " +
        "Use it for scheduled morning check-ins or when asked \"how's my store " +
        "doing?\". Read-only.",
      inputSchema: {
        store: z.string().optional().describe("Store key (all stores if omitted)."),
        lowStockThreshold: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Inventory at/below this counts as low stock (default 10)."),
      },
    },
    async ({ store, lowStockThreshold }) => {
      try {
        const r = await getDailyBriefing({ storeKey: store, lowStockThreshold });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );
```

- [ ] **Step 2: README** —
  - `exposes six read-only tools` → `exposes seven read-only tools` (line ~50); `## What you can ask (the six tools)` → `(the seven tools)`; `discovers the six tools automatically` → `discovers the tools automatically`.
  - `get_sales` row: question becomes `"How much did I sell today / yesterday / this week / this month?"`.
  - New row after `get_sales`:
    `| \`get_daily_briefing\` | "How's my store doing?" — yesterday's sales, unfulfilled orders, and low-stock items in one call (built for a scheduled morning text) |`
  - After the "### 3. Connect Poke" section, insert:

```md
### 4. Optional: a morning briefing text
Poke can run scheduled automations. Once ShopTalk is connected, text Poke:

> "Every morning at 9, send me my ShopTalk daily briefing."

Poke will call `get_daily_briefing` on schedule and text you yesterday's sales,
anything unfulfilled, and what's running low on stock. **Opt-in by design:**
ShopTalk never sends anything on its own — no automation, no messages. You can
also just ask *"how's my store doing?"* any time.
```

  - Roadmap: `beyond the current \`today\` / \`7d\` / \`30d\`` → `beyond the current \`today\` / \`yesterday\` / \`7d\` / \`30d\``.
- [ ] **Step 3:** `node --check backend/mcp-tools.js`; `cd backend && node --test` (43/43); boot smoke: initialize `/mcp` → 200 and `tools/list` includes `get_daily_briefing` (7 tools).
- [ ] **Step 4:** commit ("Add get_daily_briefing MCP tool + morning-briefing docs"), push `shoptalk-release:main`, verify CI: `gh run watch … --exit-status` → success.

---

## Self-Review
**Spec coverage:** yesterday period + bounded window + enum (Task 1); getLowStock/getDailyBriefing + failure semantics + all three network tests (Task 2); tool registration, README counts/table/automation section/roadmap, push + CI (Task 3). Covered.
**Type consistency:** `periodToRange` `{since, until?, label}` consumed in Task 1's getSales edit; `getDailyBriefing({storeKey, lowStockThreshold})` matches Task 3's call; briefing return shape matches Task 2's test assertions (`stores[].label`, `unfulfilled.count/orders`, `lowStock.products`).
**No placeholders:** full code and exact commands throughout.
