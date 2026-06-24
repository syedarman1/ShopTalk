import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStoresEnv } from "../stores.js";

const ENV = {
  SHOPIFY_STORES: JSON.stringify([
    { key: "main", label: "Main Store", shopDomain: "main.myshopify.com", adminAccessToken: "tok_main" },
    { key: "eu", label: "EU Store", shopDomain: "eu.myshopify.com", adminAccessToken: "tok_eu", apiVersion: "2025-10" },
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
  assert.throws(() => parseStoresEnv(bad), /shopDomain|adminAccessToken/);
});
