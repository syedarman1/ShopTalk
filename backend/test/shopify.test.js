import { test } from "node:test";
import assert from "node:assert/strict";
import { periodToRange, shapeOrder, aggregateSales, shapeProduct, shapeCustomer } from "../shopify.js";

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
