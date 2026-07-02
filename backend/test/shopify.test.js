import { test } from "node:test";
import assert from "node:assert/strict";
import { periodToRange, shapeOrder, summarizeSales, aggregateSales, shapeProduct, shapeCustomer } from "../shopify.js";

test("periodToRange('today') returns midnight UTC of now", () => {
  const now = new Date("2026-06-20T15:30:00Z");
  const { since } = periodToRange("today", now);
  assert.equal(since, "2026-06-20T00:00:00.000Z");
});

test("periodToRange('7d') returns 7 days before now", () => {
  const now = new Date("2026-06-20T00:00:00Z");
  const { since } = periodToRange("7d", now);
  assert.equal(since, "2026-06-13T00:00:00.000Z");
});

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

test("periodToRange rejects unknown period", () => {
  assert.throws(() => periodToRange("forever", new Date()), /period/i);
});

test("periodToRange('today') honors a non-UTC timezone", () => {
  // 2026-06-25T04:00Z is midnight EDT (UTC-4) -> local 'today' starts at 04:00Z
  const now = new Date("2026-06-25T04:00:00Z");
  const { since } = periodToRange("today", now, "America/New_York");
  assert.equal(since, "2026-06-25T04:00:00.000Z");
});

test("periodToRange defaults to UTC when no timezone given", () => {
  const now = new Date("2026-06-20T15:30:00Z");
  assert.equal(periodToRange("today", now).since, "2026-06-20T00:00:00.000Z");
});

test("shapeOrder flattens a GraphQL order node", () => {
  const node = {
    name: "#1001",
    createdAt: "2026-06-20T10:00:00Z",
    displayFulfillmentStatus: "UNFULFILLED",
    displayFinancialStatus: "PAID",
    currentTotalPriceSet: { shopMoney: { amount: "42.50", currencyCode: "USD" } },
    customer: { displayName: "Ada Lovelace" },
  };
  assert.deepEqual(shapeOrder(node), {
    name: "#1001",
    createdAt: "2026-06-20T10:00:00Z",
    total: 42.5,
    currency: "USD",
    fulfillmentStatus: "UNFULFILLED",
    financialStatus: "PAID",
    customer: "Ada Lovelace",
    test: false,
    cancelledAt: null,
  });
});

test("shapeOrder surfaces test and cancelledAt when present", () => {
  const node = {
    name: "#1002",
    createdAt: "2026-06-20T11:00:00Z",
    displayFulfillmentStatus: "FULFILLED",
    displayFinancialStatus: "PAID",
    currentTotalPriceSet: { shopMoney: { amount: "10.00", currencyCode: "USD" } },
    customer: { displayName: "Test Buyer" },
    test: true,
    cancelledAt: "2026-06-20T12:00:00Z",
  };
  const o = shapeOrder(node);
  assert.equal(o.test, true);
  assert.equal(o.cancelledAt, "2026-06-20T12:00:00Z");
});

test("summarizeSales sums revenue by currency and computes per-currency AOV", () => {
  const r = summarizeSales([
    { total: 100, currency: "USD", test: false, cancelledAt: null },
    { total: 50, currency: "USD", test: false, cancelledAt: null },
    { total: 20, currency: "EUR", test: false, cancelledAt: null },
  ]);
  assert.equal(r.orderCount, 3);
  assert.deepEqual(r.totalsByCurrency, { USD: 150, EUR: 20 });
  assert.deepEqual(r.countByCurrency, { USD: 2, EUR: 1 });
  // AOV is per currency: USD = 150/2, EUR = 20/1 — not divided by the total count.
  assert.deepEqual(r.averageByCurrency, { USD: 75, EUR: 20 });
});

test("summarizeSales excludes test orders from revenue and count", () => {
  const r = summarizeSales([
    { total: 100, currency: "USD", test: false, cancelledAt: null },
    { total: 999, currency: "USD", test: true, cancelledAt: null },
  ]);
  assert.equal(r.orderCount, 1);
  assert.deepEqual(r.totalsByCurrency, { USD: 100 });
  assert.deepEqual(r.averageByCurrency, { USD: 100 });
});

test("summarizeSales excludes cancelled orders from revenue and count", () => {
  const r = summarizeSales([
    { total: 100, currency: "USD", test: false, cancelledAt: null },
    { total: 40, currency: "USD", test: false, cancelledAt: "2026-06-20T12:00:00Z" },
  ]);
  assert.equal(r.orderCount, 1);
  assert.deepEqual(r.totalsByCurrency, { USD: 100 });
});

test("summarizeSales handles an empty list without dividing by zero", () => {
  const r = summarizeSales([]);
  assert.equal(r.orderCount, 0);
  assert.deepEqual(r.totalsByCurrency, {});
  assert.deepEqual(r.averageByCurrency, {});
});

test("aggregateSales sums counts, groups totals, and computes per-currency AOV", () => {
  const result = aggregateSales([
    { store: "main", orderCount: 2, totalsByCurrency: { USD: 100 }, countByCurrency: { USD: 2 } },
    { store: "eu", orderCount: 3, totalsByCurrency: { USD: 50, EUR: 20 }, countByCurrency: { USD: 1, EUR: 2 } },
  ]);
  assert.equal(result.orderCount, 5);
  assert.deepEqual(result.byCurrency, { USD: 150, EUR: 20 });
  // USD: 150 / (2+1) = 50 ; EUR: 20 / 2 = 10 — rollup AOV is per currency.
  assert.deepEqual(result.averageByCurrency, { USD: 50, EUR: 10 });
});

test("aggregateSales tolerates a store missing countByCurrency (no crash, no AOV)", () => {
  const r = aggregateSales([
    { store: "main", orderCount: 2, totalsByCurrency: { USD: 100 } },
  ]);
  assert.deepEqual(r.byCurrency, { USD: 100 });
  assert.deepEqual(r.averageByCurrency, {});
});

test("aggregateSales propagates the capped flag and lists capped stores", () => {
  const r = aggregateSales([
    { store: "main", orderCount: 250, totalsByCurrency: { USD: 25000 }, capped: true },
    { store: "eu", orderCount: 50, totalsByCurrency: { USD: 5000 }, capped: false },
  ]);
  assert.equal(r.capped, true);
  assert.deepEqual(r.cappedStores, ["main"]);
  assert.equal(r.orderCount, 300);
});

test("shapeProduct flattens a GraphQL product node and coerces price to Number", () => {
  const node = {
    title: "Cool Shirt",
    status: "ACTIVE",
    totalInventory: 42,
    priceRangeV2: { minVariantPrice: { amount: "19.99", currencyCode: "USD" } },
  };
  assert.deepEqual(shapeProduct(node), {
    title: "Cool Shirt",
    status: "ACTIVE",
    totalInventory: 42,
    price: 19.99,
    currency: "USD",
  });
});

test("shapeCustomer maps defaultEmailAddress.emailAddress to email", () => {
  const node = {
    displayName: "Ada Lovelace",
    defaultEmailAddress: { emailAddress: "ada@example.com" },
    numberOfOrders: "7",
    amountSpent: { amount: "250.00", currencyCode: "GBP" },
  };
  assert.deepEqual(shapeCustomer(node), {
    name: "Ada Lovelace",
    email: "ada@example.com",
    orders: 7,
    amountSpent: 250,
    currency: "GBP",
  });
});

test("shapeCustomer returns null for email when defaultEmailAddress is absent", () => {
  const node = {
    displayName: "Guest User",
    numberOfOrders: "1",
    amountSpent: { amount: "10.00", currencyCode: "USD" },
  };
  const result = shapeCustomer(node);
  assert.equal(result.email, null);
  assert.equal(result.name, "Guest User");
});
