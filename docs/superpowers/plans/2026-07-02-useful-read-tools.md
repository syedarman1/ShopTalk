# Useful Read Tools + run_query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow ShopTalk from 7 to 12 read-only tools: a `run_query` GraphQL escape hatch plus dedicated chargebacks, best-sellers, payouts, and refunds tools, with honesty instructions.

**Architecture:** Five new read functions in `backend/shopify.js` (one pure ranking helper, unit-tested; the rest mocked-fetch tested); five `registerTool` blocks + an instructions rewrite in `backend/mcp-tools.js`; docs updated. Everything read-only — `run_query` rejects mutations in code and the app's scopes enforce it regardless.

**Tech Stack:** Node 22, existing mocked-fetch test pattern (`node --test`), zod v4 schemas. No new dependencies.

## Global Constraints
- **Read-only only.** No mutation may be executable through any path; `runReadQuery` rejects `/\bmutation\b/i`.
- New scopes (`read_shopify_payments_disputes`, `read_shopify_payments_payouts`) are a USER action after merge; disputes/payouts tools must degrade to the underlying Shopify error and their descriptions must name the scope.
- Quoted `created_at` datetimes (match the fixed grammar); test/cancelled orders excluded from best-sellers like revenue.
- Keep handler style identical to existing tools (`try { return text(...) } catch { return errorText(err.message) }`).

---

### Task 1: `rankLineItems` pure helper (TDD)

**Files:** Modify `backend/shopify.js` (export, in the pure-helpers section). Test `backend/test/shopify.test.js`.

**Interfaces:** Produces `rankLineItems(orders, limit=5) => [{ title, unitsSold, orders }]` where input orders are `[{ test, cancelledAt, lineItems: [{ title, quantity }] }]`.

- [ ] **Step 1: failing tests** — append to `backend/test/shopify.test.js` (add `rankLineItems` to the import):

```js
test("rankLineItems sums units by title and counts orders", () => {
  const r = rankLineItems([
    { test: false, cancelledAt: null, lineItems: [{ title: "Hoodie", quantity: 2 }, { title: "Tote", quantity: 1 }] },
    { test: false, cancelledAt: null, lineItems: [{ title: "Hoodie", quantity: 3 }] },
  ]);
  assert.deepEqual(r[0], { title: "Hoodie", unitsSold: 5, orders: 2 });
  assert.deepEqual(r[1], { title: "Tote", unitsSold: 1, orders: 1 });
});

test("rankLineItems excludes test and cancelled orders", () => {
  const r = rankLineItems([
    { test: true, cancelledAt: null, lineItems: [{ title: "X", quantity: 99 }] },
    { test: false, cancelledAt: "2026-01-01T00:00:00Z", lineItems: [{ title: "X", quantity: 99 }] },
    { test: false, cancelledAt: null, lineItems: [{ title: "X", quantity: 1 }] },
  ]);
  assert.deepEqual(r, [{ title: "X", unitsSold: 1, orders: 1 }]);
});

test("rankLineItems slices to the limit, highest first", () => {
  const orders = [{ test: false, cancelledAt: null, lineItems: [
    { title: "A", quantity: 3 }, { title: "B", quantity: 2 }, { title: "C", quantity: 1 },
  ] }];
  const top2 = rankLineItems(orders, 2);
  assert.equal(top2.length, 2);
  assert.equal(top2[0].title, "A");
});
```

- [ ] **Step 2:** `cd backend && node --test test/shopify.test.js` → FAIL (not exported).
- [ ] **Step 3: implement** — add after `aggregateSales` in the pure-helpers section:

```js
/**
 * Rank products by units sold across a list of orders. Excludes test and
 * cancelled orders (same rules as revenue). `orders` on each result = how many
 * orders contained that product. Stable sort keeps first-seen order on ties.
 */
export function rankLineItems(orders, limit = 5) {
  const byTitle = new Map();
  for (const o of orders) {
    if (o.test || o.cancelledAt != null) continue;
    const seen = new Set();
    for (const li of o.lineItems || []) {
      if (!li?.title) continue;
      const entry = byTitle.get(li.title) || { title: li.title, unitsSold: 0, orders: 0 };
      entry.unitsSold += li.quantity || 0;
      if (!seen.has(li.title)) { entry.orders += 1; seen.add(li.title); }
      byTitle.set(li.title, entry);
    }
  }
  return [...byTitle.values()].sort((a, b) => b.unitsSold - a.unitsSold).slice(0, limit);
}
```

- [ ] **Step 4:** tests pass. **Step 5:** commit `Add rankLineItems: pure best-seller ranking (units by product)`.

---

### Task 2: the five read functions + network tests

**Files:** Modify `backend/shopify.js`. Test `backend/test/tools.network.test.js` (new).

**Interfaces:** Produces `runReadQuery(storeKey, query, variables?)`, `getDisputes(storeKey, {status="open", limit=10})`, `getBestSellers(storeKey, {period="30d", limit=5})`, `getPayouts(storeKey, {limit=5})`, `getRefunds(storeKey, {limit=10})`.

- [ ] **Step 1: failing tests** — create `backend/test/tools.network.test.js`:

```js
// New read tools, mocked fetch. Each test routes by URL/body; no real network.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SHOPIFY_STORES = JSON.stringify([
  { key: "alpha", label: "Alpha", shopDomain: "alpha.myshopify.com", clientId: "id-a", clientSecret: "sec-a", apiVersion: "2026-01" },
]);

const { runReadQuery, getDisputes, getBestSellers, getPayouts, getRefunds } =
  await import("../shopify.js");

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const TOKEN_OK = { access_token: "tok", scope: "read_orders", expires_in: 86399 };
const tokenOr = (handler) => async (url, init = {}) =>
  String(url).includes("/oauth/access_token") ? json(TOKEN_OK) : handler(String(url), init);

test("runReadQuery rejects mutations without touching the network", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("network should not be called"); });
  await assert.rejects(() => runReadQuery("alpha", `mutation { shopUpdate }`), /read-only/);
  await assert.rejects(() => runReadQuery("alpha", `  MUTATION Evil { x }`), /read-only/);
});

test("runReadQuery passes read queries through and returns data", async (t) => {
  t.mock.method(globalThis, "fetch", tokenOr((u, init) => {
    const body = JSON.parse(String(init.body));
    assert.match(body.query, /shop \{ name \}/);
    return json({ data: { shop: { name: "Alpha" } } });
  }));
  assert.deepEqual(await runReadQuery("alpha", `{ shop { name } }`), { shop: { name: "Alpha" } });
});

const DISPUTES = { data: { shopifyPaymentsAccount: { disputes: { edges: [
  { node: { id: "gid://1", status: "NEEDS_RESPONSE", type: "CHARGEBACK",
    evidenceDueBy: "2026-07-10T00:00:00Z", initiatedAt: "2026-07-01T00:00:00Z",
    amount: { amount: "45.00", currencyCode: "USD" },
    reasonDetails: { reason: "fraudulent", networkReasonCode: "4837" },
    order: { name: "#1042" } } },
  { node: { id: "gid://2", status: "WON", type: "CHARGEBACK",
    evidenceDueBy: null, initiatedAt: "2026-06-01T00:00:00Z",
    amount: { amount: "20.00", currencyCode: "USD" },
    reasonDetails: { reason: "product_not_received", networkReasonCode: null },
    order: { name: "#0999" } } },
] } } } };

test("getDisputes shapes disputes and filters to open by default", async (t) => {
  t.mock.method(globalThis, "fetch", tokenOr(() => json(DISPUTES)));
  const open = await getDisputes("alpha");
  assert.equal(open.disputes.length, 1);
  assert.deepEqual(open.disputes[0], {
    id: "gid://1", order: "#1042", amount: 45, currency: "USD",
    reason: "fraudulent", networkReasonCode: "4837", status: "NEEDS_RESPONSE",
    type: "CHARGEBACK", evidenceDueBy: "2026-07-10T00:00:00Z", initiatedAt: "2026-07-01T00:00:00Z",
  });
  const all = await getDisputes("alpha", { status: "all" });
  assert.equal(all.disputes.length, 2);
});

test("getDisputes handles a store without Shopify Payments", async (t) => {
  t.mock.method(globalThis, "fetch", tokenOr(() => json({ data: { shopifyPaymentsAccount: null } })));
  const r = await getDisputes("alpha");
  assert.deepEqual(r.disputes, []);
  assert.match(r.note, /No Shopify Payments/);
});

test("getPayouts shapes balance and payouts", async (t) => {
  t.mock.method(globalThis, "fetch", tokenOr(() => json({ data: { shopifyPaymentsAccount: {
    balance: [{ amount: "310.55", currencyCode: "USD" }],
    payouts: { edges: [
      { node: { id: "gid://p1", issuedAt: "2026-07-01T00:00:00Z", status: "PAID",
        net: { amount: "120.00", currencyCode: "USD" } } },
    ] },
  } } })));
  const r = await getPayouts("alpha");
  assert.deepEqual(r.balance, [{ amount: 310.55, currency: "USD" }]);
  assert.deepEqual(r.payouts[0], { id: "gid://p1", issuedAt: "2026-07-01T00:00:00Z", status: "PAID", net: 120, currency: "USD" });
});

test("getBestSellers ranks units over the period and excludes test orders", async (t) => {
  t.mock.method(globalThis, "fetch", tokenOr((u, init) => {
    const body = JSON.parse(String(init.body));
    if ((body.query || "").includes("ianaTimezone"))
      return json({ data: { shop: { ianaTimezone: "UTC" } } });
    assert.match(body.variables.q, /created_at:>='.+'/); // quoted bound
    return json({ data: { orders: { edges: [
      { node: { test: false, cancelledAt: null, lineItems: { edges: [
        { node: { title: "Hoodie", quantity: 2 } }, { node: { title: "Tote", quantity: 1 } },
      ] } } },
      { node: { test: true, cancelledAt: null, lineItems: { edges: [
        { node: { title: "Hoodie", quantity: 50 } },
      ] } } },
    ], pageInfo: { hasNextPage: false } } } });
  }));
  const r = await getBestSellers("alpha", { period: "30d", limit: 5 });
  assert.equal(r.label, "last 30 days");
  assert.deepEqual(r.bestSellers[0], { title: "Hoodie", unitsSold: 2, orders: 1 });
  assert.equal(r.capped, false);
});

test("getRefunds queries refunded orders by last update", async (t) => {
  t.mock.method(globalThis, "fetch", tokenOr((u, init) => {
    const body = JSON.parse(String(init.body));
    assert.match(body.variables.q, /financial_status:refunded OR financial_status:partially_refunded/);
    assert.match(body.query, /sortKey: UPDATED_AT/);
    return json({ data: { orders: { edges: [
      { node: { name: "#1040", createdAt: "2026-06-30T00:00:00Z", test: false, cancelledAt: null,
        displayFulfillmentStatus: "FULFILLED", displayFinancialStatus: "REFUNDED",
        currentTotalPriceSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } },
        customer: { displayName: "A" } } },
    ] } } });
  }));
  const r = await getRefunds("alpha");
  assert.equal(r.orders[0].name, "#1040");
  assert.equal(r.orders[0].financialStatus, "REFUNDED");
});
```

- [ ] **Step 2:** `node --test test/tools.network.test.js` → FAIL (functions not exported).
- [ ] **Step 3: implement** — append to `backend/shopify.js` (after `getRefunds` insertion point = after `searchCustomers`):

```js
/**
 * Read-only escape hatch: run an arbitrary Admin GraphQL QUERY. Mutations are
 * rejected here, and the app's read-only scopes make writes impossible anyway.
 */
export async function runReadQuery(storeKey, query, variables = {}) {
  if (/\bmutation\b/i.test(query)) {
    throw new Error("read-only: mutations are not allowed. Send a query instead.");
  }
  const store = resolveStore(storeKey);
  return shopifyGraphQL(store, query, variables);
}

const OPEN_DISPUTE_STATUSES = new Set(["NEEDS_RESPONSE", "UNDER_REVIEW"]);

/** Chargebacks/inquiries from Shopify Payments. Needs read_shopify_payments_disputes. */
export async function getDisputes(storeKey, { status = "open", limit = 10 } = {}) {
  const store = resolveStore(storeKey);
  const query = `
    query($n: Int!) {
      shopifyPaymentsAccount {
        disputes(first: $n) {
          edges { node {
            id status type evidenceDueBy initiatedAt
            amount { amount currencyCode }
            reasonDetails { reason networkReasonCode }
            order { name }
          } }
        }
      }
    }`;
  const data = await shopifyGraphQL(store, query, { n: limit });
  const account = data.shopifyPaymentsAccount;
  if (!account) {
    return { store: store.key, status, disputes: [], note: "No Shopify Payments account on this store." };
  }
  let disputes = account.disputes.edges.map(({ node }) => ({
    id: node.id,
    order: node.order?.name ?? null,
    amount: node.amount?.amount != null ? Number(node.amount.amount) : null,
    currency: node.amount?.currencyCode ?? null,
    reason: node.reasonDetails?.reason ?? null,
    networkReasonCode: node.reasonDetails?.networkReasonCode ?? null,
    status: node.status,
    type: node.type,
    evidenceDueBy: node.evidenceDueBy ?? null,
    initiatedAt: node.initiatedAt ?? null,
  }));
  if (status === "open") disputes = disputes.filter((d) => OPEN_DISPUTE_STATUSES.has(d.status));
  return { store: store.key, status, disputes };
}

/** Top products by units sold over a period (excludes test/cancelled orders). */
export async function getBestSellers(storeKey, { period = "30d", limit = 5 } = {}) {
  const store = resolveStore(storeKey);
  const timeZone = await getShopTimezone(store);
  const { since, until, label } = periodToRange(period, new Date(), timeZone);
  const query = `
    query($q: String!) {
      orders(first: 50, query: $q, sortKey: CREATED_AT, reverse: true) {
        edges { node {
          test cancelledAt
          lineItems(first: 20) { edges { node { title quantity } } }
        } }
        pageInfo { hasNextPage }
      }
    }`;
  const data = await shopifyGraphQL(store, query, {
    q: `created_at:>='${since}'` + (until ? ` created_at:<'${until}'` : ""),
  });
  const orders = data.orders.edges.map(({ node }) => ({
    test: node.test === true,
    cancelledAt: node.cancelledAt ?? null,
    lineItems: node.lineItems.edges.map((e) => e.node),
  }));
  return {
    store: store.key,
    label,
    bestSellers: rankLineItems(orders, limit),
    capped: data.orders.pageInfo.hasNextPage, // true => based on the newest 50 orders only
  };
}

/** Recent Shopify Payments payouts + current balance. Needs read_shopify_payments_payouts. */
export async function getPayouts(storeKey, { limit = 5 } = {}) {
  const store = resolveStore(storeKey);
  const query = `
    query($n: Int!) {
      shopifyPaymentsAccount {
        balance { amount currencyCode }
        payouts(first: $n) {
          edges { node { id issuedAt status net { amount currencyCode } } }
        }
      }
    }`;
  const data = await shopifyGraphQL(store, query, { n: limit });
  const account = data.shopifyPaymentsAccount;
  if (!account) {
    return { store: store.key, balance: [], payouts: [], note: "No Shopify Payments account on this store." };
  }
  return {
    store: store.key,
    balance: (account.balance || []).map((b) => ({ amount: Number(b.amount), currency: b.currencyCode })),
    payouts: account.payouts.edges.map(({ node }) => ({
      id: node.id,
      issuedAt: node.issuedAt ?? null,
      status: node.status,
      net: node.net?.amount != null ? Number(node.net.amount) : null,
      currency: node.net?.currencyCode ?? null,
    })),
  };
}

/** Recently refunded / partially refunded orders (ordered by last update). */
export async function getRefunds(storeKey, { limit = 10 } = {}) {
  const store = resolveStore(storeKey);
  const query = `
    query($q: String!, $n: Int!) {
      orders(first: $n, query: $q, sortKey: UPDATED_AT, reverse: true) {
        edges { node { ${ORDER_FIELDS} } }
      }
    }`;
  const data = await shopifyGraphQL(store, query, {
    q: "(financial_status:refunded OR financial_status:partially_refunded)",
    n: limit,
  });
  return { store: store.key, orders: data.orders.edges.map((e) => shapeOrder(e.node)) };
}
```

- [ ] **Step 4:** full backend suite passes. **Step 5:** commit `Add read functions: runReadQuery, disputes, best sellers, payouts, refunds`.

---

### Task 3: register the 5 MCP tools + honesty instructions

**Files:** Modify `backend/mcp-tools.js`.

- [ ] **Step 1:** extend the `./shopify.js` import with `runReadQuery, getDisputes, getBestSellers, getPayouts, getRefunds` (and keep existing).
- [ ] **Step 2:** replace the `instructions` string with:

```js
      instructions:
        "ShopTalk gives read-only access to the owner's Shopify store(s). " +
        "Call list_stores first if unsure which stores exist. Every tool takes " +
        "an optional `store` key; omit it for the default store (get_sales " +
        "rolls up across all stores when omitted). Coverage: sales & AOV " +
        "(get_sales), morning summary (get_daily_briefing), orders (get_orders, " +
        "get_order), refunds (get_refunds), chargebacks (get_disputes), payouts " +
        "& balance (get_payouts), products & stock (search_products), best " +
        "sellers (get_best_sellers), customers (search_customers). For anything " +
        "else, use run_query with a read-only Admin GraphQL query. Prefer the " +
        "dedicated tools when one fits. If neither a tool nor run_query can " +
        "answer, say so plainly — never invent numbers. Everything is " +
        "read-only: there is no way to change store data.",
```

- [ ] **Step 3:** after the `get_daily_briefing` registration, add five `registerTool` blocks (handler style identical to existing tools):

```js
  // get_best_sellers --------------------------------------------------------
  server.registerTool(
    "get_best_sellers",
    {
      title: "Best Sellers",
      description:
        "Top products by units actually sold over a period (test and cancelled " +
        "orders excluded). Use for \"what's selling?\" / \"top products this month\".",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        period: z.enum(["today", "yesterday", "7d", "30d"]).optional().describe("Window (default 30d)."),
        limit: z.number().int().min(1).max(20).optional().describe("How many products (default 5)."),
      },
    },
    async ({ store, period, limit }) => {
      try {
        const r = await getBestSellers(store, { period, limit });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // get_disputes -------------------------------------------------------------
  server.registerTool(
    "get_disputes",
    {
      title: "Chargebacks / Disputes",
      description:
        "Shopify Payments chargebacks and inquiries — amount, reason, status, " +
        "and the evidence-due deadline. Default lists OPEN disputes " +
        "(needs response / under review). Requires the app to have the " +
        "read_shopify_payments_disputes scope (grant it and reinstall if missing).",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        status: z.enum(["open", "all"]).optional().describe("open (default) or all."),
        limit: z.number().int().min(1).max(50).optional().describe("Max disputes (default 10)."),
      },
    },
    async ({ store, status, limit }) => {
      try {
        const r = await getDisputes(store, { status, limit });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // get_payouts ---------------------------------------------------------------
  server.registerTool(
    "get_payouts",
    {
      title: "Payouts & Balance",
      description:
        "Shopify Payments: current balance and recent payouts with status " +
        "(scheduled / in transit / paid) — \"when does my money land?\". Requires " +
        "the read_shopify_payments_payouts scope (grant it and reinstall if missing).",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        limit: z.number().int().min(1).max(20).optional().describe("Max payouts (default 5)."),
      },
    },
    async ({ store, limit }) => {
      try {
        const r = await getPayouts(store, { limit });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // get_refunds ---------------------------------------------------------------
  server.registerTool(
    "get_refunds",
    {
      title: "Recent Refunds",
      description:
        "Recently refunded or partially refunded orders (ordered by last " +
        "update, which approximates refund time).",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        limit: z.number().int().min(1).max(50).optional().describe("Max orders (default 10)."),
      },
    },
    async ({ store, limit }) => {
      try {
        const r = await getRefunds(store, { limit });
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );

  // run_query -----------------------------------------------------------------
  server.registerTool(
    "run_query",
    {
      title: "Run Read Query",
      description:
        "Escape hatch: run any READ-ONLY Shopify Admin GraphQL query when no " +
        "dedicated tool covers the question. Mutations are rejected and the app " +
        "holds read scopes only. Keep selections small (a few fields, first: <= 10). " +
        "Examples — shop info: { shop { name currencyCode plan { displayName } } } | " +
        "abandoned checkouts: { abandonedCheckouts(first: 5) { edges { node { " +
        "createdAt totalPriceSet { shopMoney { amount currencyCode } } } } } }",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        query: z.string().describe("A GraphQL query document. Mutations are rejected."),
        variables: z.record(z.string(), z.any()).optional().describe("Optional GraphQL variables."),
      },
    },
    async ({ store, query, variables }) => {
      try {
        const r = await runReadQuery(store, query, variables ?? {});
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );
```

- [ ] **Step 4:** `node --check mcp-tools.js`; full suite; boot smoke `tools/list` → **12 names** including the five new ones.
- [ ] **Step 5:** commit `Register 5 new read tools + honesty instructions (12 tools total)`.

---

### Task 4: docs + push + CI

**Files:** Modify `README.md`, `SECURITY.md`.

- [ ] **Step 1: README**
  - "exposes seven read-only tools" → "exposes twelve read-only tools"; heading "(the seven tools)" → "(the twelve tools)"; grep for any other "seven".
  - Tools table — add after the `get_daily_briefing` row:

```md
| `get_best_sellers` | "What's actually selling?" — top products by units sold over a period |
| `get_disputes` | "Any open chargebacks?" — amount, reason, and the evidence-due deadline |
| `get_payouts` | "When does my money land?" — Shopify Payments balance + recent payouts |
| `get_refunds` | "Any refunds lately?" — recently refunded orders |
| `run_query` | Anything else — a read-only Admin GraphQL escape hatch (mutations rejected) |
```

  - Setup step 2 scope line → `2. Give it read scopes — \`read_orders\`, \`read_products\`, \`read_customers\` (plus \`read_shopify_payments_disputes\` and \`read_shopify_payments_payouts\` for chargebacks/payouts) — and **release** the version.`
  - Roadmap: delete the "**Deeper analytics** — sales trend charts and best-seller ranking by units sold…" line's best-seller half → `- **Deeper analytics** — sales trend charts (today \`get_sales\` returns the period total + order count).`
- [ ] **Step 2: SECURITY.md** — scope sentence → `read Shopify scopes (\`read_orders\`, \`read_products\`, \`read_customers\`, and optionally the Shopify Payments read scopes for disputes/payouts)`.
- [ ] **Step 3:** commit `Docs: twelve tools, new scopes, roadmap update`; push `shoptalk-origin shoptalk-release:main`; watch CI to success (`gh run watch --exit-status`).
- [ ] **Step 4 (post-merge note to user):** grant the two scopes in the Dev Dashboard → release → reinstall; re-sync the ShopTalk integration in Poke; then text "any open chargebacks?" as the live smoke. (Schema fields for disputes/payouts are mock-tested; the live smoke is the final validation — `run_query` is the fallback if a field drifted.)

## Self-Review
**Spec coverage:** run_query + guard (T2/T3), disputes (T2/T3), best sellers + pure ranking (T1/T2/T3), payouts (T2/T3), refunds (T2/T3), instructions (T3), docs/scopes/roadmap (T4), 12-tool smoke (T3), degradation notes in descriptions (T3). Covered.
**Type consistency:** `rankLineItems(orders, limit)` input shape matches getBestSellers' mapping; tool handlers call the exact exported names with option objects matching each signature; zod v4 `z.record(key, value)` two-arg form.
**No placeholders:** full code and commands throughout.
