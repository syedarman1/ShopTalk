// Network-layer tests with a mocked fetch — token exchange/cache, retry
// behavior, error propagation, and the all-stores partial-failure rollup.
// No real network: every test would throw on an unmocked URL.
import { test } from "node:test";
import assert from "node:assert/strict";

// Registry for the rollup test — MUST be set before anything calls getStores()
// (the registry is memoized per process; each test FILE is its own process).
process.env.SHOPIFY_STORES = JSON.stringify([
  { key: "alpha", label: "Alpha", shopDomain: "alpha.myshopify.com", clientId: "id-a", clientSecret: "sec-a", apiVersion: "2026-01" },
  { key: "beta", label: "Beta", shopDomain: "beta.myshopify.com", clientId: "id-b", clientSecret: "sec-b", apiVersion: "2026-01" },
]);

const { getAccessToken, shopifyGraphQL, getSalesAllStores, getOrder, getShopTimezone } = await import("../shopify.js");

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const TOKEN_OK = { access_token: "tok-1", scope: "read_orders", expires_in: 86399 };
// Distinct store keys per test: the token cache is keyed by store.key and
// persists for the life of this process.
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

test("a 200 response without data throws a clear error, not a TypeError", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    String(url).includes("/oauth/access_token") ? json(TOKEN_OK) : json({})
  );
  await assert.rejects(() => shopifyGraphQL(fakeStore("t7"), `{ ok }`), /Empty GraphQL response/);
});

test("getOrder returns the exact-name match, not the top relevance hit", async (t) => {
  const orderNode = (name, amount) => ({
    name, createdAt: "2026-07-01T00:00:00Z", test: false, cancelledAt: null,
    displayFulfillmentStatus: null, displayFinancialStatus: null,
    currentTotalPriceSet: { shopMoney: { amount, currencyCode: "USD" } },
    customer: null, lineItems: { edges: [] },
  });
  // Relevance puts #1001 first when searching "name:#100".
  const two = { data: { orders: { edges: [
    { node: orderNode("#1001", "1.00") },
    { node: orderNode("#100", "2.00") },
  ] } } };
  t.mock.method(globalThis, "fetch", async (url) =>
    String(url).includes("/oauth/access_token") ? json(TOKEN_OK) : json(two)
  );
  const hit = await getOrder("alpha", "100");
  assert.equal(hit.order.name, "#100");
  assert.equal(hit.order.total, 2);
  const miss = await getOrder("alpha", "999"); // no exact match in results
  assert.equal(miss.order, null);
});

test("getShopTimezone doesn't cache the UTC fallback after a transient failure", async (t) => {
  let gql = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/oauth/access_token")) return json(TOKEN_OK);
    gql += 1;
    return gql === 1 ? json({}, 500) : json({ data: { shop: { ianaTimezone: "America/New_York" } } });
  });
  const store = fakeStore("t8");
  assert.equal(await getShopTimezone(store), "UTC"); // transient failure → fallback
  assert.equal(await getShopTimezone(store), "America/New_York"); // retried, real answer
  assert.equal(await getShopTimezone(store), "America/New_York"); // now served from cache
  assert.equal(gql, 2);
});

test("a tiny expires_in still yields a positive token-cache TTL", async (t) => {
  let exchanges = 0;
  t.mock.method(globalThis, "fetch", async () => {
    exchanges += 1;
    return json({ access_token: "tok", scope: "read_orders", expires_in: 10 });
  });
  const store = fakeStore("t9");
  await getAccessToken(store);
  await getAccessToken(store);
  assert.equal(exchanges, 1); // floored TTL — not an instantly-expired entry
});

const injected = (key) => ({
  key, shopDomain: `${key}.myshopify.com`, apiVersion: "2026-01", accessToken: "oauth-tenant-token",
});

test("an injected accessToken is used directly — no client-credentials exchange", async (t) => {
  let oauthCalls = 0, sentToken = null;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (String(url).includes("/oauth/access_token")) { oauthCalls += 1; return json({ access_token: "SHOULD-NOT-USE", expires_in: 86399 }); }
    sentToken = init.headers?.["X-Shopify-Access-Token"];
    return json({ data: { ok: true } });
  });
  const data = await shopifyGraphQL(injected("t10"), `{ ok }`);
  assert.deepEqual(data, { ok: true });
  assert.equal(oauthCalls, 0);
  assert.equal(sentToken, "oauth-tenant-token");
});

test("getAccessToken returns an injected token as-is", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("no network for injected tokens"); });
  assert.equal(await getAccessToken(injected("t11")), "oauth-tenant-token");
});

test("a 401 on an injected token fails clearly without a retry loop", async (t) => {
  let gql = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/oauth/access_token")) throw new Error("must not exchange");
    gql += 1;
    return json({}, 401);
  });
  await assert.rejects(() => shopifyGraphQL(injected("t12"), `{ ok }`), /token was rejected/i);
  assert.equal(gql, 1); // no retry — refreshing a static token can't help
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
