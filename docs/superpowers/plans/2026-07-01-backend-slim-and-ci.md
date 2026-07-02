# Backend Slim-Down + CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the backend's unused dashboard-serving layer (SSE/broadcast/`/api/stores`) so only `/mcp` + `/api/health` remain, then add GitHub Actions CI and mocked-fetch tests for the Shopify network layer.

**Architecture:** Pure deletion in `server.js`/`mcp-tools.js`/`mcp-server.js` (+ remove `notify.js` and the `cors` dep); docs updated to match. New `test/shopify.network.test.js` mocks `globalThis.fetch` via `node:test`'s `t.mock.method` — no real network. CI = one workflow, two jobs (backend, frontend).

**Tech Stack:** Node 22, Express, `node --test`, GitHub Actions.

## Global Constraints
- Keep: `GET /api/health`, the UUID-strip middleware, `forceAccept()`, `backend/auth.js` unchanged (incl. `?token=`), the stdio entrypoint `mcp-server.js`.
- Tool return values to the MCP client (`text(r)`) must be byte-identical before/after.
- Tests never touch real Shopify; each test uses a distinct store key (module-level `tokenCache` persists within the file's process).
- Repo remote: push `shoptalk-release` → `shoptalk-origin main`. No co-author trailers.

---

### Task 1: Slim the backend to MCP-only

**Files:**
- Modify: `backend/server.js`, `backend/mcp-tools.js`, `backend/mcp-server.js`, `backend/package.json` (+lockfile via npm), `README.md`, `SECURITY.md`
- Delete: `backend/notify.js`

**Interfaces:**
- Produces: `createMcpServer()` (no arguments) — consumed by `server.js` and `mcp-server.js`.

- [ ] **Step 1: server.js — new header comment**

Replace:
```js
// server.js — ShopTalk web backend.
// Serves the REST API the dashboard reads from, and owns the Server-Sent
// Events stream that pushes live updates to every connected browser. The MCP
// process (mcp-server.js) calls the Shopify Admin API and then pings
// POST /internal/broadcast so those mutations show up in the UI instantly.
```
with:
```js
// server.js — ShopTalk backend: the MCP endpoint Poke talks to.
// Express serves streamable-HTTP MCP at /mcp (auth-gated) plus a health check.
```

- [ ] **Step 2: server.js — drop cors + listStoreSummaries imports and middleware**

Delete the lines `import cors from "cors";` and `import { listStoreSummaries } from "./stores.js";`. Replace:
```js
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000" }));
app.use(express.json());
```
with:
```js
app.use(express.json());
```

- [ ] **Step 3: server.js — delete the SSE broadcaster section**

Delete everything from the `// SSE broadcaster` banner comment through the end of the `app.get("/api/events", …)` route (the `clients` Set, `broadcast()`, and the whole route incl. keepalive). Also delete the `app.get("/api/stores", …)` route and the `app.post("/internal/broadcast", …)` route (and the `isLoopback` import usage it carried — change the auth import to `import { mcpAuthorized } from "./auth.js";`). Keep `app.get("/api/health", …)` but change its body to `res.json({ ok: true });` (the `clients.size` field is gone).

- [ ] **Step 4: server.js — MCP section**

Replace `const server = createMcpServer(broadcast);` with `const server = createMcpServer();`. Update the MCP banner comment sentence "…and tool mutations broadcast straight to the SSE clients above." to end at "(no sessions, nothing spawned)." Update the boot log to only:
```js
  console.log(`[shoptalk] MCP listening on http://localhost:${PORT}`);
  console.log(`[shoptalk]   GET  /api/health`);
  console.log(`[shoptalk]   ALL  /mcp   (MCP streamable HTTP)`);
```
(keep the existing `MCP_TOKEN` warning block).

- [ ] **Step 5: mcp-tools.js — remove the broadcast plumbing**

Header comment: replace lines 3–5 (`// The \`broadcast\` callback is injected…` through `//   - stdio …`) with:
```js
// Served over streamable HTTP by server.js and over stdio by mcp-server.js.
```
Signature: `export function createMcpServer(broadcast = () => {})` → `export function createMcpServer()`.
Instructions string: `"ShopTalk gives read-only access to the owner's Shopify store(s) over a " + "live dashboard. Call list_stores first…"` → `"ShopTalk gives read-only access to the owner's Shopify store(s). " + "Call list_stores first…"` (verify exact text with grep before editing).
Delete the now-unused `money` helper (lines 34–37).
Then delete all 7 `await broadcast({ … });` blocks. The two get_sales sites also lose their `msg` composition; each handler body becomes call + `return text(…)`:
```js
        const stores = listStoreSummaries();
        return text({ stores });
```
```js
          const r = await getSales(store, period);
          return text(r);
```
```js
        const r = await getSalesAllStores(period);
        return text(r);
```
```js
        const r = await getOrders(store, { status, limit });
        return text(r);
```
```js
        const r = await getOrder(store, name);
        return text(r);
```
```js
        const r = await searchProducts(store, { query, limit });
        return text(r);
```
```js
        const r = await searchCustomers(store, { query, limit });
        return text(r);
```

- [ ] **Step 6: mcp-server.js + notify.js**

In `mcp-server.js`: delete `import { notifyDashboard } from "./notify.js";`, change `const server = createMcpServer(notifyDashboard);` → `const server = createMcpServer();`, and replace header-comment lines 4–6 ("…announce mutations to the dashboard via notifyDashboard, since this runs as a separate process…") with "…transport for clients that spawn a local process instead of hitting /mcp.". Then `git rm backend/notify.js`.

- [ ] **Step 7: remove the cors dependency**

Run: `cd backend && npm uninstall cors`
Expected: `package.json` no longer lists `cors`; lockfile regenerated.

- [ ] **Step 8: syntax + tests + boot smoke**

Run: `cd backend && node --check server.js && node --check mcp-tools.js && node --check mcp-server.js && node --test`
Expected: 31/31 pass.
Boot smoke (no MCP_TOKEN → loopback allowed):
```bash
PORT=4555 SHOPIFY_STORES='[]' node server.js &   # background
curl -s --retry 15 --retry-connrefused --retry-delay 1 localhost:4555/api/health   # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:4555/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'   # 200
curl -s -o /dev/null -w "%{http_code}\n" localhost:4555/api/events        # 404
curl -s -o /dev/null -w "%{http_code}\n" localhost:4555/api/stores        # 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:4555/internal/broadcast  # 404
```
Then kill the server (`lsof -ti tcp:4555 | xargs kill -9`).

- [ ] **Step 9: docs**

README security bullet:
```md
- **Security-conscious** — read-only scopes only; `/mcp` requires a shared
  secret and **fails closed to loopback-only** when none is set; credentials
  live only in environment variables, never in the repo; the backend surface is
  deliberately tiny (the MCP endpoint plus a health check).
```
README architecture line: `  server.js      Express: MCP-over-HTTP at /mcp (auth-gated) + /api/health`
README `.env` comment:
```md
# Shared secret for /mcp. Without it, the endpoint accepts loopback (local)
# requests only — set it to allow remote clients like Poke.
```
README deploy paragraph: drop the `CORS_ORIGIN` parenthetical and replace the last sentence with `Prefer an always-on host: MCP responses stream over long-lived HTTP connections.`
SECURITY.md MCP bullet: drop "and the dashboard's `/api/events` stream"; singular ("it **fails closed**").

- [ ] **Step 10: Commit**

```bash
git add -A backend README.md SECURITY.md
git commit -m "Slim backend to MCP-only: drop SSE/broadcast/api-stores layer

The dashboard is demo-only, so nothing consumed the SSE stream, the broadcast
plumbing, or /api/stores — but they were still publicly reachable and carried
the audit's remaining findings (unauthenticated /api/stores; IP-gated
/internal/broadcast). Delete the layer, the notify.js bridge, and the cors
dependency. Poke's /mcp endpoint and /api/health are unchanged."
```

---

### Task 2: Mocked-fetch tests for the Shopify network layer

**Files:**
- Test: `backend/test/shopify.network.test.js` (new)

**Interfaces:**
- Consumes: `getAccessToken(store)`, `shopifyGraphQL(store, query, vars?)`, `getSalesAllStores(period)` from `backend/shopify.js` (store = plain object `{key, shopDomain, clientId, clientSecret, apiVersion}`).

- [ ] **Step 1: Write the test file**

```js
import { test } from "node:test";
import assert from "node:assert/strict";

// Registry for the rollup test — MUST be set before shopify.js/stores.js run getStores().
process.env.SHOPIFY_STORES = JSON.stringify([
  { key: "alpha", label: "Alpha", shopDomain: "alpha.myshopify.com", clientId: "id-a", clientSecret: "sec-a", apiVersion: "2026-01" },
  { key: "beta", label: "Beta", shopDomain: "beta.myshopify.com", clientId: "id-b", clientSecret: "sec-b", apiVersion: "2026-01" },
]);

const { getAccessToken, shopifyGraphQL, getSalesAllStores } = await import("../shopify.js");

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const TOKEN_OK = { access_token: "tok-1", scope: "read_orders", expires_in: 86399 };
const fakeStore = (key) => ({
  key, shopDomain: `${key}.myshopify.com`, clientId: "id", clientSecret: "sec", apiVersion: "2026-01",
});

test("getAccessToken exchanges once and caches per store", async (t) => {
  let exchanges = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.match(String(url), /t1\.myshopify\.com\/admin\/oauth\/access_token/);
    exchanges += 1;
    return json(TOKEN_OK);
  });
  const store = fakeStore("t1");
  assert.equal(await getAccessToken(store), "tok-1");
  assert.equal(await getAccessToken(store), "tok-1");
  assert.equal(exchanges, 1);
});

test("shopifyGraphQL retries once with a fresh token after a 401", async (t) => {
  const calls = { token: 0, gql: 0 };
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/oauth/access_token")) {
      calls.token += 1;
      return json({ ...TOKEN_OK, access_token: `tok-${calls.token}` });
    }
    calls.gql += 1;
    return calls.gql === 1 ? json({}, 401) : json({ data: { ok: true } });
  });
  const data = await shopifyGraphQL(fakeStore("t2"), `{ ok }`);
  assert.deepEqual(data, { ok: true });
  assert.equal(calls.token, 2); // initial exchange + re-exchange after invalidation
  assert.equal(calls.gql, 2);
});

test("persistent 401 surfaces a clear authentication error", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    String(url).includes("/oauth/access_token") ? json(TOKEN_OK) : json({}, 401)
  );
  await assert.rejects(
    () => shopifyGraphQL(fakeStore("t3"), `{ ok }`),
    /Authentication failed for store "t3"/
  );
});

test("a 429 is retried after backoff and then succeeds", async (t) => {
  let gql = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/oauth/access_token")) return json(TOKEN_OK);
    gql += 1;
    return gql === 1 ? json({}, 429) : json({ data: { ok: true } });
  });
  assert.deepEqual(await shopifyGraphQL(fakeStore("t4"), `{ ok }`), { ok: true }); // ~1s real backoff
  assert.equal(gql, 2);
});

test("GraphQL-level errors are thrown with the API's message", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    String(url).includes("/oauth/access_token")
      ? json(TOKEN_OK)
      : json({ errors: [{ message: "Field 'nope' doesn't exist" }] })
  );
  await assert.rejects(() => shopifyGraphQL(fakeStore("t5"), `{ nope }`), /Field 'nope' doesn't exist/);
});

test("getSalesAllStores keeps healthy stores and reports failures", async (t) => {
  const ORDERS = { data: { orders: { edges: [
    { node: {
      name: "#1", createdAt: "2026-07-01T00:00:00Z", test: false, cancelledAt: null,
      displayFulfillmentStatus: "FULFILLED", displayFinancialStatus: "PAID",
      currentTotalPriceSet: { shopMoney: { amount: "10.00", currencyCode: "USD" } },
      customer: { displayName: "A" },
    } },
  ], pageInfo: { hasNextPage: false } } } };
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? String(init.body) : "";
    if (u.includes("alpha.myshopify.com/admin/oauth")) return json(TOKEN_OK);
    if (u.includes("beta.myshopify.com/admin/oauth")) return json({}, 401);
    if (u.includes("alpha.myshopify.com") && body.includes("ianaTimezone"))
      return json({ data: { shop: { ianaTimezone: "UTC" } } });
    if (u.includes("alpha.myshopify.com")) return json(ORDERS);
    throw new Error(`unmocked fetch: ${u}`);
  });
  const r = await getSalesAllStores("today");
  assert.equal(r.perStore.length, 1);
  assert.equal(r.perStore[0].store, "alpha");
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].store, "beta");
  assert.match(r.failures[0].error, /Token exchange failed/);
  assert.deepEqual(r.combined.byCurrency, { USD: 10 });
  assert.deepEqual(r.combined.averageByCurrency, { USD: 10 });
});
```

(If `t.mock.method(globalThis, "fetch", …)` errors on this Node version, fall back to saving `globalThis.fetch` in `t.before`-style manual assignment with restoration in a `finally`.)

- [ ] **Step 2: Run**

Run: `cd backend && node --test`
Expected: 37/37 pass (31 existing + 6 new; the 429 test adds ~1s). These are characterization tests of existing behavior — a FAILURE here means a real bug was found: stop and report, don't force the test green.

- [ ] **Step 3: Commit**

```bash
git add backend/test/shopify.network.test.js
git commit -m "Test the Shopify network layer with a mocked fetch

Covers token caching, 401 invalidate-and-retry, persistent-401 messaging,
429 backoff, GraphQL error propagation, and the all-stores partial-failure
rollup — the riskiest previously-untested paths. No real network."
```

---

### Task 3: GitHub Actions CI + badge

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md` (badge line under the title)

- [ ] **Step 1: Workflow**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  backend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
      - run: npm test
  frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm test
      - run: npm run build
```
(Verify `frontend/package.json` has a `build` script — `next build` — before relying on it.)

- [ ] **Step 2: Badge**

Under `# ShopTalk` (before the Live demo line) add:
```md
![CI](https://github.com/syedarman1/ShopTalk/actions/workflows/ci.yml/badge.svg)
```

- [ ] **Step 3: Commit and push the batch**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "Add GitHub Actions CI: backend + frontend tests and build on every push"
git push shoptalk-origin shoptalk-release:main
```

- [ ] **Step 4: Verify CI is green on GitHub**

Run: `gh run watch -R syedarman1/ShopTalk --exit-status $(gh run list -R syedarman1/ShopTalk --workflow ci.yml --limit 1 --json databaseId -q '.[0].databaseId')`
Fallback (no gh auth): poll the public badge until it reports passing:
`curl -sL https://github.com/syedarman1/ShopTalk/actions/workflows/ci.yml/badge.svg | grep -o 'passing\|failing\|no status'`
Expected: `passing`. If failing, read the log (`gh run view --log-failed`), fix, commit, re-push.

---

## Self-Review

**Spec coverage:** delete list (SSE/broadcast/api-stores/notify/cors/broadcast-callback) → Task 1 steps 1–7; keep list honored (health, UUID-strip, forceAccept, auth.js, stdio entry) → Task 1 steps 3–6 touch none of them beyond the import line; docs → step 9; boot smoke incl. 404s → step 8; six network tests exactly as specced → Task 2; workflow/two jobs/badge/`gh` verification → Task 3. Covered.

**Type consistency:** `createMcpServer()` no-arg used in both server.js (Task 1 step 4) and mcp-server.js (step 6). Test file consumes `getAccessToken/shopifyGraphQL/getSalesAllStores` with store objects — matches shopify.js signatures. `failures[].error` is a string (matches the `res.reason?.message` implementation).

**No placeholders:** every step carries exact code/commands. One deliberate runtime-verify note (instructions string wording) is flagged as "verify with grep", not left vague.
