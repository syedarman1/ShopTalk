import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStoresEnv, resolveStore, listStoreSummaries } from "../stores.js";

// Must be set before any getStores()/resolveStore()/listStoreSummaries() call.
// getStores() is lazy (memoizes on first call), so setting env here — at module
// evaluation time, before any test body runs — is sufficient.
process.env.SHOPIFY_STORES = JSON.stringify([
  { key: "main", label: "Main Store", shopDomain: "main.myshopify.com", clientId: "id_main", clientSecret: "secret_main" },
  { key: "eu", label: "EU Store", shopDomain: "eu.myshopify.com", clientId: "id_eu", clientSecret: "secret_eu", apiVersion: "2025-10" },
]);

const ENV = {
  SHOPIFY_STORES: JSON.stringify([
    { key: "main", label: "Main Store", shopDomain: "main.myshopify.com", clientId: "id_main", clientSecret: "secret_main" },
    { key: "eu", label: "EU Store", shopDomain: "eu.myshopify.com", clientId: "id_eu", clientSecret: "secret_eu", apiVersion: "2025-10" },
  ]),
};

test("parseStoresEnv reads all stores and defaults apiVersion", () => {
  const stores = parseStoresEnv(ENV);
  assert.equal(stores.length, 2);
  assert.equal(stores[0].key, "main");
  assert.equal(stores[0].apiVersion, "2026-01"); // default
  assert.equal(stores[1].apiVersion, "2025-10"); // explicit override kept
});

test("parseStoresEnv throws a clear error on missing env", () => {
  assert.throws(() => parseStoresEnv({}), /SHOPIFY_STORES/);
});

test("parseStoresEnv throws when a store is missing required fields", () => {
  const bad = { SHOPIFY_STORES: JSON.stringify([{ key: "x", label: "X" }]) };
  assert.throws(() => parseStoresEnv(bad), /shopDomain|clientId|clientSecret/);
});

test("parseStoresEnv preserves clientId and clientSecret on round-trip", () => {
  const stores = parseStoresEnv(ENV);
  assert.equal(stores[0].clientId, "id_main");
  assert.equal(stores[0].clientSecret, "secret_main");
  assert.equal(stores[1].clientId, "id_eu");
  assert.equal(stores[1].clientSecret, "secret_eu");
});

test("resolveStore returns the store matching the given key", () => {
  const store = resolveStore("eu");
  assert.equal(store.key, "eu");
  assert.equal(store.shopDomain, "eu.myshopify.com");
});

test("resolveStore returns the first store when no key is given", () => {
  const store = resolveStore();
  assert.equal(store.key, "main");
});

test("resolveStore throws with a hint listing valid keys for an unknown key", () => {
  assert.throws(() => resolveStore("unknown"), /main.*eu|eu.*main/);
});

test("listStoreSummaries never leaks clientId or clientSecret", () => {
  const summaries = listStoreSummaries();
  assert.equal(summaries.length, 2);
  for (const s of summaries) {
    assert.ok(!Object.hasOwn(s, "clientId"), "clientId must not appear in summary");
    assert.ok(!Object.hasOwn(s, "clientSecret"), "clientSecret must not appear in summary");
    assert.ok(Object.hasOwn(s, "key"), "key must be present");
    assert.ok(Object.hasOwn(s, "label"), "label must be present");
    assert.ok(Object.hasOwn(s, "shopDomain"), "shopDomain must be present");
  }
});
