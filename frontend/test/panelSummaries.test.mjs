import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stockLevel, summarizeOrders, summarizeProducts, summarizeCustomers,
} from "../lib/panelSummaries.mjs";

test("stockLevel classifies out/low/in", () => {
  assert.equal(stockLevel(0), "out");
  assert.equal(stockLevel(-5), "out"); // oversold is still out of stock
  assert.equal(stockLevel(5), "low");
  assert.equal(stockLevel(10), "low");
  assert.equal(stockLevel(11), "in");
  assert.equal(stockLevel(null), "in");
});

test("summarizeOrders totals value and counts unfulfilled", () => {
  const r = summarizeOrders([
    { total: 168, currency: "USD", fulfillmentStatus: "UNFULFILLED" },
    { total: 92.5, currency: "USD", fulfillmentStatus: "FULFILLED" },
    { total: 240, currency: "USD", fulfillmentStatus: "PARTIALLY_FULFILLED" },
    { total: 54, currency: "USD", fulfillmentStatus: null },
  ]);
  assert.equal(r.count, 4);
  assert.deepEqual(r.valueByCurrency, { USD: 554.5 });
  assert.equal(r.unfulfilled, 2); // UNFULFILLED + PARTIALLY_FULFILLED; FULFILLED & null excluded
});

test("summarizeProducts counts active and restock-needed", () => {
  const r = summarizeProducts([
    { status: "ACTIVE", totalInventory: 7 },    // low
    { status: "ACTIVE", totalInventory: 130 },  // in
    { status: "DRAFT", totalInventory: 0 },     // out
  ]);
  assert.equal(r.count, 3);
  assert.equal(r.active, 2);
  assert.equal(r.needRestock, 2); // low + out
});

test("summarizeCustomers totals spend, averages orders, tracks max", () => {
  const r = summarizeCustomers([
    { amountSpent: 1840, currency: "USD", orders: 12 },
    { amountSpent: 1320.5, currency: "USD", orders: 9 },
    { amountSpent: 980, currency: "USD", orders: 7 },
    { amountSpent: 610, currency: "USD", orders: 5 },
  ]);
  assert.equal(r.count, 4);
  assert.deepEqual(r.spentByCurrency, { USD: 4750.5 });
  assert.equal(r.avgOrders, 8); // round(33/4)=8
  assert.equal(r.maxSpent, 1840);
});

test("summaries handle empty input", () => {
  assert.deepEqual(summarizeOrders([]), { count: 0, valueByCurrency: {}, unfulfilled: 0 });
  assert.deepEqual(summarizeProducts([]), { count: 0, active: 0, needRestock: 0 });
  assert.deepEqual(summarizeCustomers([]), { count: 0, spentByCurrency: {}, avgOrders: 0, maxSpent: 0 });
});
