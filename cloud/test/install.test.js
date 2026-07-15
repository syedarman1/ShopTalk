import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
process.env.CLOUD_ENC_KEY = "e".repeat(64);
process.env.NODE_ENV = "test";
process.env.SHOPIFY_CLOUD_CLIENT_ID = "cid";
process.env.SHOPIFY_CLOUD_CLIENT_SECRET = "csecret";
process.env.SHOPIFY_CLOUD_APP_URL = "https://cloud.test";

const { createApp } = await import("../app.js");
const { openCloudDb, getShopByDomain, createState, upsertShop } = await import("../tenants.js");

const realFetch = globalThis.fetch;
const listen = (app) => new Promise((r) => { const s = app.listen(0, () => r({ s, port: s.address().port })); });
const signQuery = (params) =>
  createHmac("sha256", "csecret").update(Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&")).digest("hex");

test("GET /install redirects a valid shop to Shopify authorize", async () => {
  const { s, port } = await listen(createApp(openCloudDb(":memory:")));
  try {
    const res = await realFetch(`http://127.0.0.1:${port}/install?shop=acme.myshopify.com`, { redirect: "manual" });
    assert.equal(res.status, 302);
    const loc = res.headers.get("location");
    assert.match(loc, /^https:\/\/acme\.myshopify\.com\/admin\/oauth\/authorize/);
    assert.match(loc, /client_id=cid/);
  } finally { s.close(); }
});

test("GET /install rejects a non-myshopify shop", async () => {
  const { s, port } = await listen(createApp(openCloudDb(":memory:")));
  try {
    const res = await realFetch(`http://127.0.0.1:${port}/install?shop=evil.com`, { redirect: "manual" });
    assert.equal(res.status, 400);
  } finally { s.close(); }
});

test("GET /auth/callback verifies HMAC+state, stores an encrypted token, issues creds", async (t) => {
  const db = openCloudDb(":memory:");
  const state = createState(db, "acme.myshopify.com");
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url).includes("/oauth/access_token"))
      return new Response(JSON.stringify({ access_token: "TENANT-TOKEN", scope: "read_orders" }), { status: 200 });
    return realFetch(url, init);
  });
  const { s, port } = await listen(createApp(db));
  try {
    const q = { shop: "acme.myshopify.com", code: "authcode", state, timestamp: "1" };
    const hmac = signQuery(q);
    const res = await realFetch(`http://127.0.0.1:${port}/auth/callback?shop=${q.shop}&code=${q.code}&state=${q.state}&timestamp=${q.timestamp}&hmac=${hmac}`);
    assert.equal(res.status, 200);
    const row = getShopByDomain(db, "acme.myshopify.com");
    assert.ok(row && row.access_token_enc && row.access_token_enc !== "TENANT-TOKEN");
    assert.match(await res.text(), /mcp add/);
  } finally { s.close(); }
});

test("GET /auth/callback rejects a forged HMAC", async () => {
  const db = openCloudDb(":memory:");
  const state = createState(db, "acme.myshopify.com");
  const { s, port } = await listen(createApp(db));
  try {
    const res = await realFetch(`http://127.0.0.1:${port}/auth/callback?shop=acme.myshopify.com&code=x&state=${state}&hmac=deadbeef`);
    assert.equal(res.status, 401);
  } finally { s.close(); }
});

test("POST /webhooks/app/uninstalled verifies HMAC and wipes the token", async () => {
  const db = openCloudDb(":memory:");
  upsertShop(db, { shopDomain: "acme.myshopify.com", accessToken: "T", scopes: "x" });
  const { s, port } = await listen(createApp(db));
  try {
    const body = JSON.stringify({ domain: "acme.myshopify.com" });
    const hmac = createHmac("sha256", "csecret").update(body).digest("base64");
    const res = await realFetch(`http://127.0.0.1:${port}/webhooks/app/uninstalled`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Hmac-Sha256": hmac, "X-Shopify-Shop-Domain": "acme.myshopify.com" }, body,
    });
    assert.equal(res.status, 200);
    assert.equal(getShopByDomain(db, "acme.myshopify.com").access_token_enc, null);

    const bad = await realFetch(`http://127.0.0.1:${port}/webhooks/app/uninstalled`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Hmac-Sha256": "nope" }, body,
    });
    assert.equal(bad.status, 401);
  } finally { s.close(); }
});

test("GET /privacy serves the rendered privacy policy", async () => {
  const { s, port } = await listen(createApp(openCloudDb(":memory:")));
  try {
    const res = await realFetch(`http://127.0.0.1:${port}/privacy`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);
    const html = await res.text();
    assert.match(html, /Privacy Policy/);
    assert.match(html, /syedarman2003@gmail.com/);
  } finally { s.close(); }
});
