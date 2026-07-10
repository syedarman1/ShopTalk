// Two-tenant isolation over the real HTTP handler: shop A's bearer must only
// ever reach shop A's token, never shop B's. Shopify is mocked; the test's own
// requests to the local server pass through to the real fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.CLOUD_ENC_KEY = "c".repeat(64);
process.env.NODE_ENV = "test";

const { createApp } = await import("../app.js");
const { openCloudDb, upsertShop, issueMcpCredential } = await import("../tenants.js");

const realFetch = globalThis.fetch;
const shopPayload = (name) => ({ data: { shop: {
  name, email: "x@y.com", myshopifyDomain: `${name}.myshopify.com`,
  primaryDomain: { host: `${name}.com` }, currencyCode: "USD",
  ianaTimezone: "UTC", plan: { displayName: "Shopify" },
} } });

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

async function callShopInfo(port, creds) {
  const res = await realFetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${creds}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_shop_info", arguments: {} } }),
  });
  return res;
}

test("a tenant's bearer only ever reaches that tenant's Shopify token", async (t) => {
  const db = openCloudDb(":memory:");
  const a = upsertShop(db, { shopDomain: "a.myshopify.com", accessToken: "TOK-A", scopes: "x" });
  const b = upsertShop(db, { shopDomain: "b.myshopify.com", accessToken: "TOK-B", scopes: "x" });
  const credA = issueMcpCredential(db, a.id);
  const credB = issueMcpCredential(db, b.id);

  let seenToken = null;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const u = String(url);
    if (u.includes("myshopify.com")) {
      seenToken = init.headers?.["X-Shopify-Access-Token"];
      const which = u.includes("a.myshopify.com") ? "a" : "b";
      return new Response(JSON.stringify(shopPayload(which)), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return realFetch(url, init); // the test's own request to the local server
  });

  const { server, port } = await listen(createApp(db));
  try {
    seenToken = null;
    const rA = await callShopInfo(port, `${credA.clientId}:${credA.secret}`);
    assert.equal(rA.status, 200);
    assert.equal(seenToken, "TOK-A"); // never TOK-B

    seenToken = null;
    const rB = await callShopInfo(port, `${credB.clientId}:${credB.secret}`);
    assert.equal(rB.status, 200);
    assert.equal(seenToken, "TOK-B");

    const rBad = await callShopInfo(port, `${credA.clientId}:wrong-secret`);
    assert.equal(rBad.status, 401);
  } finally {
    server.close();
  }
});
