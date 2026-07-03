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
