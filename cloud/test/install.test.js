import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
process.env.CLOUD_ENC_KEY = "e".repeat(64);
process.env.NODE_ENV = "test";
process.env.SHOPIFY_CLOUD_CLIENT_ID = "cid";
process.env.SHOPIFY_CLOUD_CLIENT_SECRET = "csecret";
process.env.SHOPIFY_CLOUD_APP_URL = "https://cloud.test";

const { createApp, ensureFreshToken } = await import("../app.js");
const { openCloudDb, getShopByDomain, createState, upsertShop, decryptToken, decryptRefreshToken } = await import("../tenants.js");

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

test("GET /auth/callback verifies HMAC+state, stores an encrypted token, redirects to app home revealing the key once", async (t) => {
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
    const res = await realFetch(`http://127.0.0.1:${port}/auth/callback?shop=${q.shop}&code=${q.code}&state=${q.state}&timestamp=${q.timestamp}&hmac=${hmac}`, { redirect: "manual" });
    assert.equal(res.status, 302);
    const token = new URL(res.headers.get("location")).searchParams.get("t");
    assert.ok(token);
    const row = getShopByDomain(db, "acme.myshopify.com");
    assert.ok(row && row.access_token_enc && row.access_token_enc !== "TENANT-TOKEN");
    const home = await realFetch(`http://127.0.0.1:${port}/home?t=${token}`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /mcp add/);
    assert.doesNotMatch(await (await realFetch(`http://127.0.0.1:${port}/home?t=${token}`)).text(), /mcp add/); // single-use
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

test("ensureFreshToken refreshes an expiring token near expiry and persists the rotation", async (t) => {
  const db = openCloudDb(":memory:");
  const shop = upsertShop(db, { shopDomain: "acme.myshopify.com", accessToken: "OLD", scopes: "x", refreshToken: "RT1", expiresIn: 30 });
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ access_token: "NEW", refresh_token: "RT2", expires_in: 3600 }), { status: 200 }));
  const fresh = await ensureFreshToken(db, shop);
  assert.equal(decryptToken(fresh), "NEW");
  assert.equal(decryptRefreshToken(getShopByDomain(db, "acme.myshopify.com")), "RT2");
});

test("ensureFreshToken leaves a non-expiring token untouched (no network)", async (t) => {
  const db = openCloudDb(":memory:");
  const shop = upsertShop(db, { shopDomain: "acme.myshopify.com", accessToken: "AT", scopes: "x" });
  let called = false;
  t.mock.method(globalThis, "fetch", async () => { called = true; return new Response("{}", { status: 200 }); });
  const out = await ensureFreshToken(db, shop);
  assert.equal(called, false);
  assert.equal(decryptToken(out), "AT");
});

test("ensureFreshToken leaves a still-valid expiring token untouched (no network)", async (t) => {
  const db = openCloudDb(":memory:");
  const shop = upsertShop(db, { shopDomain: "acme.myshopify.com", accessToken: "AT", scopes: "x", refreshToken: "RT", expiresIn: 3600 });
  let called = false;
  t.mock.method(globalThis, "fetch", async () => { called = true; return new Response("{}", { status: 200 }); });
  await ensureFreshToken(db, shop);
  assert.equal(called, false);
});
