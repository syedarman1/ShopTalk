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
  if (q.includes("fulfillment_status:unfulfilled")) {
    // "needs shipping" must include partially-fulfilled orders too
    assert.match(q, /\(fulfillment_status:unfulfilled OR fulfillment_status:partial\)/);
    return json(ORDERS_UNFUL);
  }
  if (q.includes("created_at:>=")) {
    // Shopify's search grammar requires datetime values to be quoted
    assert.match(q, /created_at:>='.+' created_at:<'.+'/);
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
