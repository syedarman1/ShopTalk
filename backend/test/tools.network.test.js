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
