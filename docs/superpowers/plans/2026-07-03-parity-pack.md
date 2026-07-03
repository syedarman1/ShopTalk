# Parity Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `get_disputes` as an order-sweep (no payments scopes), add `get_schema` introspection + local validation to `run_query`, add `get_shop_info` — 12 → 14 tools, read-parity with Claude's official connector.

**Architecture:** Sweep + shop-info live in `backend/shopify.js`; introspection in new `backend/introspect.js` (uses `shopifyGraphQL`); `run_query` upgrades in-place with the `graphql` package (parse → AST mutation guard → cached client schema → validate → execute, with graceful fallback when introspection fails).

**Tech Stack:** existing stack + `graphql` (^16) dependency. Mocked-fetch tests; live read-only verification against the real store before push.

## Global Constraints
- Read-only; the AST guard must reject any non-`query` operation with no network I/O first.
- Dispute sweep: pages of 250, `DISPUTE_SWEEP_MAX_PAGES = 6`, quoted `created_at:>='…'`, capped+sweptOrders honesty fields.
- Acceptance (live): sweep returns `#2176, #2161` with today's scopes; all four (`#2046, #1918` too) once `read_all_orders` lands.
- Update existing `getDisputes` tests (they mock the old payments-account shape) — do not leave both.

---

### Task 1: `get_disputes` order-sweep (TDD)

**Files:** Modify `backend/shopify.js` (replace `getDisputes`; keep `OPEN_DISPUTE_STATUSES`), `backend/test/tools.network.test.js` (replace the 2 payments-account dispute tests + `DISPUTES` fixture), `backend/mcp-tools.js` (tool description/schema).

- [ ] **Step 1: replace the dispute tests** — delete the `DISPUTES` fixture and both `getDisputes` tests; add:

```js
const orderNode = (name, createdAt, amount, disputes = []) => ({
  node: { name, createdAt, currentTotalPriceSet: { shopMoney: { amount, currencyCode: "USD" } }, disputes },
});

test("getDisputes sweeps order pages, follows cursors, filters to open", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", tokenOr((u, init) => {
    const body = JSON.parse(String(init.body));
    if ((body.query || "").includes("ianaTimezone")) return json({ data: { shop: { ianaTimezone: "UTC" } } });
    assert.match(body.variables.q, /created_at:>='.+'/);
    calls += 1;
    if (calls === 1) return json({ data: { orders: { edges: [
      orderNode("#2225", "2026-07-03T00:00:00Z", "42.98"),
      orderNode("#2176", "2026-06-17T00:00:00Z", "42.98", [{ id: "gid://d1", status: "NEEDS_RESPONSE", initiatedAs: "CHARGEBACK" }]),
    ], pageInfo: { hasNextPage: true, endCursor: "c1" } } } });
    assert.equal(body.variables.after, "c1");
    return json({ data: { orders: { edges: [
      orderNode("#2046", "2026-05-01T00:00:00Z", "26.18", [{ id: "gid://d2", status: "NEEDS_RESPONSE", initiatedAs: "CHARGEBACK" }]),
      orderNode("#1918", "2026-04-10T00:00:00Z", "30.00", [{ id: "gid://d3", status: "WON", initiatedAs: "CHARGEBACK" }]),
    ], pageInfo: { hasNextPage: false, endCursor: null } } } });
  }));
  const open = await getDisputes("alpha");
  assert.equal(open.sweptOrders, 4);
  assert.equal(open.capped, false);
  assert.deepEqual(open.disputes.map((d) => d.order), ["#2176", "#2046"]);
  assert.equal(open.disputes[0].orderTotal, 42.98);
  assert.equal(open.disputes[0].status, "NEEDS_RESPONSE");
});

test("getDisputes status:'all' includes closed; hitting the page cap sets capped", async (t) => {
  t.mock.method(globalThis, "fetch", tokenOr((u, init) => {
    const body = JSON.parse(String(init.body));
    if ((body.query || "").includes("ianaTimezone")) return json({ data: { shop: { ianaTimezone: "UTC" } } });
    return json({ data: { orders: { edges: [
      orderNode("#1", "2026-06-01T00:00:00Z", "10.00", [{ id: "gid://x", status: "WON", initiatedAs: "CHARGEBACK" }]),
    ], pageInfo: { hasNextPage: true, endCursor: "next" } } } });
  }));
  const all = await getDisputes("alpha", { status: "all" });
  assert.equal(all.capped, true);
  assert.equal(all.sweptOrders, 6);
  assert.equal(all.disputes.length, 6);
});
```

- [ ] **Step 2:** run → red. **Step 3: implement** — replace `getDisputes` in `shopify.js`:

```js
const DISPUTE_SWEEP_MAX_PAGES = 6; // 6 × 250 = 1500 orders

/**
 * Chargebacks/inquiries found by sweeping orders' dispute summaries — needs
 * only read_orders (last 60 days; grant read_all_orders for full history),
 * NOT the locked Shopify Payments scopes. orderTotal approximates the
 * disputed amount (the exact figure lives behind the payments scope).
 */
export async function getDisputes(storeKey, { status = "open", days = 120, limit = 20 } = {}) {
  const store = resolveStore(storeKey);
  const timeZone = await getShopTimezone(store);
  const since = startOfDayISO(new Date(), timeZone, days);
  const query = `
    query($q: String!, $after: String) {
      orders(first: 250, query: $q, sortKey: CREATED_AT, reverse: true, after: $after) {
        edges { node {
          name createdAt
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          disputes { id status initiatedAs }
        } }
        pageInfo { hasNextPage endCursor }
      }
    }`;
  const found = [];
  let sweptOrders = 0;
  let after = null;
  let capped = false;
  for (let page = 0; page < DISPUTE_SWEEP_MAX_PAGES; page++) {
    const data = await shopifyGraphQL(store, query, { q: `created_at:>='${since}'`, after });
    const { edges, pageInfo } = data.orders;
    sweptOrders += edges.length;
    for (const { node } of edges) {
      for (const d of node.disputes || []) {
        found.push({
          id: d.id,
          order: node.name,
          orderCreatedAt: node.createdAt,
          orderTotal: node.currentTotalPriceSet?.shopMoney?.amount != null
            ? Number(node.currentTotalPriceSet.shopMoney.amount) : null,
          currency: node.currentTotalPriceSet?.shopMoney?.currencyCode ?? null,
          status: d.status,
          initiatedAs: d.initiatedAs,
        });
      }
    }
    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor;
    capped = page === DISPUTE_SWEEP_MAX_PAGES - 1;
  }
  const disputes = (status === "open"
    ? found.filter((d) => OPEN_DISPUTE_STATUSES.has(d.status))
    : found
  ).slice(0, limit);
  return { store: store.key, status, days, sweptOrders, capped, disputes };
}
```

- [ ] **Step 4: tool metadata** — in `mcp-tools.js`, get_disputes description → "Chargebacks and inquiries, found by sweeping recent orders' dispute records. Needs only read_orders (last 60 days of orders — grant read_all_orders for full history). Default lists OPEN disputes; orderTotal approximates the disputed amount."; inputSchema adds `days: z.number().int().min(1).max(365).optional()` and keeps status/limit.
- [ ] **Step 5:** full suite green → commit `get_disputes: order-sweep (read_orders only) replacing the scope-locked payments path`.

---

### Task 2: `get_schema` introspection (TDD)

**Files:** Create `backend/introspect.js`, `backend/test/introspect.test.js`; register tool in `mcp-tools.js`.

- [ ] **Step 1: tests** — `backend/test/introspect.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SHOPIFY_STORES = JSON.stringify([
  { key: "alpha", label: "Alpha", shopDomain: "alpha.myshopify.com", clientId: "i", clientSecret: "s", apiVersion: "2026-01" },
]);
const { renderTypeRef, getSchemaType } = await import("../introspect.js");

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const TOKEN_OK = { access_token: "tok", scope: "read_orders", expires_in: 86399 };

test("renderTypeRef unwraps NON_NULL and LIST", () => {
  assert.equal(renderTypeRef({ kind: "SCALAR", name: "String" }), "String");
  assert.equal(renderTypeRef({ kind: "NON_NULL", ofType: { kind: "SCALAR", name: "Int" } }), "Int!");
  assert.equal(
    renderTypeRef({ kind: "NON_NULL", ofType: { kind: "LIST", ofType: { kind: "NON_NULL", ofType: { kind: "OBJECT", name: "Order" } } } }),
    "[Order!]!"
  );
});

test("getSchemaType shapes fields/args and caches per type", async (t) => {
  let gql = 0;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (String(url).includes("/oauth/access_token")) return json(TOKEN_OK);
    gql += 1;
    return json({ data: { __type: {
      name: "Order", kind: "OBJECT", description: "An order.",
      fields: [{
        name: "disputes", description: "Dispute summaries",
        type: { kind: "NON_NULL", ofType: { kind: "LIST", ofType: { kind: "NON_NULL", ofType: { kind: "OBJECT", name: "OrderDisputeSummary" } } } },
        args: [{ name: "first", type: { kind: "SCALAR", name: "Int" } }],
      }],
      inputFields: null, enumValues: null,
    } } });
  });
  const shape = await getSchemaType("alpha", "Order");
  assert.equal(shape.fields[0].type, "[OrderDisputeSummary!]!");
  assert.deepEqual(shape.fields[0].args, ["first: Int"]);
  await getSchemaType("alpha", "Order");
  assert.equal(gql, 1); // cached
});

test("getSchemaType throws a helpful error for unknown types", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    String(url).includes("/oauth/access_token") ? json(TOKEN_OK) : json({ data: { __type: null } })
  );
  await assert.rejects(() => getSchemaType("alpha", "Nope"), /No type "Nope"/);
});
```

- [ ] **Step 2:** red. **Step 3: implement** — `backend/introspect.js`:

```js
// introspect.js — targeted Admin-schema introspection so the AI can look up
// real field names instead of guessing (the thing that makes run_query reliable).
import { resolveStore } from "./stores.js";
import { shopifyGraphQL } from "./shopify.js";

/** Render an introspection type ref like [Order!]! */
export function renderTypeRef(ref) {
  if (!ref) return "Unknown";
  if (ref.kind === "NON_NULL") return `${renderTypeRef(ref.ofType)}!`;
  if (ref.kind === "LIST") return `[${renderTypeRef(ref.ofType)}]`;
  return ref.name ?? "Unknown";
}

const TYPE_REF = "kind name ofType { kind name ofType { kind name ofType { kind name } } }";
const typeCache = new Map(); // `${store.key}:${type}` -> shaped result

export async function getSchemaType(storeKey, typeName = "QueryRoot") {
  const store = resolveStore(storeKey);
  const key = `${store.key}:${typeName}`;
  if (typeCache.has(key)) return typeCache.get(key);
  const query = `
    query($name: String!) {
      __type(name: $name) {
        name kind description
        fields(includeDeprecated: false) {
          name description
          type { ${TYPE_REF} }
          args { name type { ${TYPE_REF} } }
        }
        inputFields { name type { ${TYPE_REF} } }
        enumValues(includeDeprecated: false) { name }
      }
    }`;
  const data = await shopifyGraphQL(store, query, { name: typeName });
  const t = data.__type;
  if (!t) {
    throw new Error(`No type "${typeName}" in the Admin schema. Check capitalization (e.g. Order, Customer, Product, QueryRoot).`);
  }
  const shaped = {
    type: t.name,
    kind: t.kind,
    description: t.description ?? null,
    fields: (t.fields ?? []).map((f) => ({
      name: f.name,
      type: renderTypeRef(f.type),
      args: (f.args ?? []).map((a) => `${a.name}: ${renderTypeRef(a.type)}`),
      description: f.description ? String(f.description).slice(0, 140) : null,
    })),
    inputFields: (t.inputFields ?? []).map((f) => ({ name: f.name, type: renderTypeRef(f.type) })),
    enumValues: (t.enumValues ?? []).map((e) => e.name),
  };
  typeCache.set(key, shaped);
  return shaped;
}
```

- [ ] **Step 4: register tool** (`mcp-tools.js`, import `getSchemaType` from `./introspect.js`):

```js
  // get_schema ----------------------------------------------------------------
  server.registerTool(
    "get_schema",
    {
      title: "Inspect Admin Schema",
      description:
        "Look up REAL field names before writing a run_query. Default type " +
        "QueryRoot lists everything queryable; pass any type name (Order, " +
        "Customer, Product, ShopifyPaymentsDispute…) to see its fields, " +
        "argument lists, and enum values.",
      inputSchema: {
        store: z.string().optional().describe("Store key (default store if omitted)."),
        type: z.string().optional().describe("GraphQL type name (default QueryRoot)."),
      },
    },
    async ({ store, type }) => {
      try {
        const r = await getSchemaType(store, type ?? "QueryRoot");
        return text(r);
      } catch (err) {
        return errorText(err.message);
      }
    }
  );
```

- [ ] **Step 5:** suite green → commit `Add get_schema: targeted Admin-schema introspection with type cache`.

---

### Task 3: validated `run_query` (TDD)

**Files:** `backend/package.json` (+`graphql`), `backend/shopify.js` (runReadQuery upgrade + imports), `backend/test/tools.network.test.js` (env gains a `beta` store; passthrough test serves introspection; two new tests).

- [ ] **Step 1:** `cd backend && npm install graphql@^16`
- [ ] **Step 2: tests** — in `tools.network.test.js`: extend `SHOPIFY_STORES` env with `{ key: "beta", label: "Beta", shopDomain: "beta.myshopify.com", clientId: "i2", clientSecret: "s2", apiVersion: "2026-01" }`; add imports:

```js
import { buildSchema, introspectionFromSchema } from "graphql";
const MINI = buildSchema("schema { query: QueryRoot } type QueryRoot { shop: Shop } type Shop { name: String }");
const INTRO = { data: introspectionFromSchema(MINI) };
```

Update the passthrough test's mock to serve introspection first:

```js
test("runReadQuery passes read queries through and returns data", async (t) => {
  t.mock.method(globalThis, "fetch", tokenOr((u, init) => {
    const body = JSON.parse(String(init.body));
    if (body.query.includes("__schema")) return json(INTRO);
    assert.match(body.query, /shop \{ name \}/);
    return json({ data: { shop: { name: "Alpha" } } });
  }));
  assert.deepEqual(await runReadQuery("alpha", `{ shop { name } }`), { shop: { name: "Alpha" } });
});
```

Add after it:

```js
test("runReadQuery validates fields against the schema before executing", async (t) => {
  t.mock.method(globalThis, "fetch", tokenOr((u, init) => {
    const body = JSON.parse(String(init.body));
    if (body.query.includes("__schema")) return json(INTRO);
    throw new Error("must not execute an invalid query");
  }));
  await assert.rejects(() => runReadQuery("alpha", `{ shop { nmae } }`), /Query invalid.*nmae/s);
});

test("runReadQuery rejects malformed GraphQL with a syntax error, pre-network", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("no network"); });
  await assert.rejects(() => runReadQuery("alpha", `{ shop {`), /syntax error/i);
});

test("runReadQuery still executes when introspection fails (fallback)", async (t) => {
  t.mock.method(globalThis, "fetch", tokenOr((u, init) => {
    const body = JSON.parse(String(init.body));
    if (body.query.includes("__schema")) return json({}, 500);
    return json({ data: { shop: { name: "Beta" } } });
  }));
  assert.deepEqual(await runReadQuery("beta", `{ shop { name } }`), { shop: { name: "Beta" } });
});
```

(`alpha`'s schema is cached by the earlier passthrough test — the validation test relies on that or re-serves INTRO; `beta` exercises the uncached-failure path.)

- [ ] **Step 3: implement** — in `shopify.js` add `import { parse, validate, buildClientSchema, getIntrospectionQuery } from "graphql";` and replace `runReadQuery`:

```js
const schemaCache = new Map(); // store.key -> GraphQLSchema | null (null = introspection failed)

async function getClientSchema(store) {
  if (schemaCache.has(store.key)) return schemaCache.get(store.key);
  try {
    const data = await shopifyGraphQL(store, getIntrospectionQuery());
    const schema = buildClientSchema(data);
    schemaCache.set(store.key, schema);
    return schema;
  } catch {
    schemaCache.set(store.key, null); // availability over strictness
    return null;
  }
}

/**
 * Read-only escape hatch: run an arbitrary Admin GraphQL QUERY. Syntax and
 * schema validation happen locally first (clear errors, "did you mean…");
 * mutations/subscriptions are rejected from the AST before any network I/O,
 * and the app's read-only scopes make writes impossible anyway.
 */
export async function runReadQuery(storeKey, query, variables = {}) {
  if (/\bmutation\b/i.test(query)) {
    throw new Error("read-only: mutations are not allowed. Send a query instead.");
  }
  let doc;
  try {
    doc = parse(query);
  } catch (e) {
    throw new Error(`GraphQL syntax error: ${e.message}`);
  }
  for (const def of doc.definitions) {
    if (def.kind === "OperationDefinition" && def.operation !== "query") {
      throw new Error(`read-only: ${def.operation}s are not allowed.`);
    }
  }
  const store = resolveStore(storeKey);
  const schema = await getClientSchema(store);
  if (schema) {
    const errors = validate(schema, doc);
    if (errors.length) {
      throw new Error(
        `Query invalid: ${errors.slice(0, 3).map((e) => e.message).join(" | ")} — use get_schema to inspect types.`
      );
    }
  }
  return shopifyGraphQL(store, query, variables);
}
```

- [ ] **Step 4:** run_query tool description gains: "Validated locally against the store's schema before executing (clear 'did you mean' errors). Use get_schema first when unsure of field names." Suite green → commit `run_query: local syntax/schema validation with graceful fallback (graphql dep)`.

---

### Task 4: `get_shop_info` + README + live verify + push + CI

**Files:** `backend/shopify.js` (getShopInfo), `backend/test/tools.network.test.js` (one test), `backend/mcp-tools.js` (import + register), `README.md`.

- [ ] **Step 1: test:**

```js
test("getShopInfo flattens the shop payload", async (t) => {
  t.mock.method(globalThis, "fetch", tokenOr((u, init) => {
    const body = JSON.parse(String(init.body));
    if (!body.query.includes("myshopifyDomain")) throw new Error("unexpected query");
    return json({ data: { shop: {
      name: "Alpha", email: "a@x.com", myshopifyDomain: "alpha.myshopify.com",
      primaryDomain: { host: "alpha.com" }, currencyCode: "USD",
      ianaTimezone: "America/New_York", plan: { displayName: "Shopify" },
    } } });
  }));
  const r = await getShopInfo("alpha");
  assert.equal(r.domain, "alpha.com");
  assert.equal(r.plan, "Shopify");
  assert.equal(r.timezone, "America/New_York");
});
```

- [ ] **Step 2: implement** (shopify.js):

```js
/** Basic store facts: name, domains, currency, timezone, plan. */
export async function getShopInfo(storeKey) {
  const store = resolveStore(storeKey);
  const data = await shopifyGraphQL(store, `{
    shop {
      name email myshopifyDomain
      primaryDomain { host }
      currencyCode ianaTimezone
      plan { displayName }
    }
  }`);
  const s = data.shop;
  return {
    store: store.key,
    name: s.name,
    email: s.email,
    myshopifyDomain: s.myshopifyDomain,
    domain: s.primaryDomain?.host ?? null,
    currency: s.currencyCode,
    timezone: s.ianaTimezone,
    plan: s.plan?.displayName ?? null,
  };
}
```

Register tool `get_shop_info` ("Store basics: name, domain, currency, timezone, plan.") with `{ store? }`.

- [ ] **Step 3: README** — twelve → fourteen (explainer line + heading); tree line "the 12" → "the 14"; table: rewrite get_disputes row ("Any open chargebacks?" — sweeps recent orders' dispute records; needs only read_orders — add `read_all_orders` for full history); add rows `get_schema` ("What fields does Order have?" — schema lookup so run_query never guesses) and `get_shop_info`; run_query row adds "validated locally before executing"; setup scopes line adds optional `read_all_orders`.
- [ ] **Step 4: live verification** (read-only, `node --env-file=.env`): `getDisputes("main")` → expect #2176 + #2161 today (all four post-scope); `getSchemaType("main","Order")` returns fields incl. `disputes`; `runReadQuery("main", "{ shop { nmae } }")` → rejected with "did you mean name"; `getShopInfo("main")` → Vyse.
- [ ] **Step 5:** commit `Add get_shop_info; docs: 14 tools + read_all_orders note`; push; `gh run watch` → success.

## Self-Review
**Spec coverage:** sweep w/ cap+honesty (T1), introspection+cache+renderTypeRef (T2), parse/AST-guard/validate/fallback (T3), shop info (T4), README counts/rows/scopes (T4), live acceptance vs real chargebacks (T4). ✓
**Type consistency:** `getDisputes` return `{store,status,days,sweptOrders,capped,disputes[]}` matches T1 tests; `getSchemaType(storeKey, typeName)` matches tool call; `runReadQuery` signature unchanged (tool untouched except description); imports named exactly as defined. ✓
**No placeholders.** ✓
