// Staged write actions: codes, TTL, single-use, proposals, executors.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SHOPIFY_STORES = JSON.stringify([
  { key: "alpha", label: "Alpha", shopDomain: "alpha.myshopify.com", clientId: "i", clientSecret: "s", apiVersion: "2026-01" },
]);
const { stageAction, takeAction, _clearPending } = await import("../actions.js");

test("stageAction returns an unambiguous single-use code and takeAction consumes it", () => {
  _clearPending();
  const { code, expiresAt } = stageAction("cancel_refund", "alpha", { orderName: "#1" });
  assert.match(code, /^R-[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(new Date(expiresAt) > new Date());
  const action = takeAction(code.toLowerCase()); // case-insensitive
  assert.equal(action.kind, "cancel_refund");
  assert.equal(action.payload.orderName, "#1");
  assert.throws(() => takeAction(code), /used already|never existed/i); // single-use
});

test("expired codes are rejected with a clear message", () => {
  _clearPending();
  const { code } = stageAction("inventory_adjust", "alpha", {}, { ttlMs: -1 });
  assert.throws(() => takeAction(code), /expired/i);
});

test("inventory actions get the I- prefix", () => {
  _clearPending();
  const { code } = stageAction("inventory_adjust", "alpha", {});
  assert.match(code, /^I-/);
});
