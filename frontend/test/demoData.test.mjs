import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_SCRIPT, DEMO_STORES } from "../lib/demoData.mjs";

const RESULT_TYPES = ["stores", "sales", "orders", "order", "products", "customers"];

test("DEMO_STORES are tokenless summaries", () => {
  assert.ok(DEMO_STORES.length >= 1);
  for (const s of DEMO_STORES) {
    assert.deepEqual(Object.keys(s).sort(), ["key", "label", "shopDomain"].sort());
  }
});

test("every script step has a valid, ResultPanel-shaped event", () => {
  assert.ok(DEMO_SCRIPT.length >= 3);
  for (const step of DEMO_SCRIPT) {
    assert.ok(step.id && step.question && step.reply, "step has id/question/reply");
    assert.ok(RESULT_TYPES.includes(step.event.type), `valid type: ${step.event.type}`);
    assert.ok(step.event.message, "event has a message");
    assert.ok("detail" in step.event, "event has detail");
  }
});

test("sales step carries totals, comparison, and an hourly points series", () => {
  const sales = DEMO_SCRIPT.find((s) => s.event.type === "sales");
  assert.ok(sales, "a sales step exists");
  const d = sales.event.detail;
  assert.equal(typeof d.orderCount, "number");
  assert.ok(d.totalsByCurrency.USD > 0);
  assert.ok(d.comparison.totalsByCurrency.USD > 0);
  assert.ok(Array.isArray(d.series.points) && d.series.points.length >= 2);
  const p = d.series.points[0];
  assert.ok(typeof p.label === "string" && typeof p.value === "number" && typeof p.prev === "number");
});

test("orders/products/customers details are arrays with the right fields", () => {
  const orders = DEMO_SCRIPT.find((s) => s.event.type === "orders").event.detail;
  assert.ok(Array.isArray(orders) && orders[0].name && typeof orders[0].total === "number");
  const products = DEMO_SCRIPT.find((s) => s.event.type === "products").event.detail;
  assert.ok(Array.isArray(products) && products[0].title && typeof products[0].price === "number");
  const customers = DEMO_SCRIPT.find((s) => s.event.type === "customers").event.detail;
  assert.ok(Array.isArray(customers) && customers[0].email && typeof customers[0].amountSpent === "number");
});
