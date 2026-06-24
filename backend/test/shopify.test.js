import { test } from "node:test";
import assert from "node:assert/strict";
import { periodToRange, shapeOrder, aggregateSales } from "../shopify.js";

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

test("periodToRange rejects unknown period", () => {
  assert.throws(() => periodToRange("forever", new Date()), /period/i);
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
  });
});

test("aggregateSales sums counts and groups totals by currency", () => {
  const result = aggregateSales([
    { store: "main", orderCount: 2, totalsByCurrency: { USD: 100 } },
    { store: "eu", orderCount: 3, totalsByCurrency: { USD: 50, EUR: 20 } },
  ]);
  assert.equal(result.orderCount, 5);
  assert.deepEqual(result.byCurrency, { USD: 150, EUR: 20 });
});
