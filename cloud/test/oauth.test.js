import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
process.env.CLOUD_ENC_KEY = "d".repeat(64);
const { installUrl, isValidShopDomain, verifyQueryHmac, verifyWebhookHmac, exchangeCodeForToken, refreshAccessToken } = await import("../oauth.js");
const { openCloudDb, createState, takeState } = await import("../tenants.js");

test("isValidShopDomain accepts real shops, rejects everything else", () => {
  assert.equal(isValidShopDomain("acme.myshopify.com"), true);
  assert.equal(isValidShopDomain("a-b-1.myshopify.com"), true);
  assert.equal(isValidShopDomain("evil.com"), false);
  assert.equal(isValidShopDomain("acme.myshopify.com.evil.com"), false);
  assert.equal(isValidShopDomain("acme.myshopify.com/x"), false);
  assert.equal(isValidShopDomain("a.b.myshopify.com"), false);
});

test("installUrl targets the shop's authorize endpoint with our params", () => {
  const u = new URL(installUrl("acme.myshopify.com", "STATE1", { clientId: "cid", appUrl: "https://c.app", scopes: "read_orders,write_orders" }));
  assert.equal(u.origin + u.pathname, "https://acme.myshopify.com/admin/oauth/authorize");
  assert.equal(u.searchParams.get("client_id"), "cid");
  assert.equal(u.searchParams.get("scope"), "read_orders,write_orders");
  assert.equal(u.searchParams.get("redirect_uri"), "https://c.app/auth/callback");
  assert.equal(u.searchParams.get("state"), "STATE1");
});

test("installUrl tolerates a trailing slash on appUrl (no // in redirect_uri)", () => {
  const u = new URL(installUrl("acme.myshopify.com", "S", { clientId: "cid", appUrl: "https://c.app/", scopes: "read_orders" }));
  assert.equal(u.searchParams.get("redirect_uri"), "https://c.app/auth/callback");
});

test("verifyQueryHmac accepts a correctly-signed query and rejects tampering", () => {
  const secret = "shh";
  const params = { shop: "acme.myshopify.com", code: "abc", state: "S", timestamp: "123" };
  const msg = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  const good = createHmac("sha256", secret).update(msg).digest("hex");
  assert.equal(verifyQueryHmac(secret, { ...params, hmac: good }), true);
  assert.equal(verifyQueryHmac(secret, { ...params, hmac: good, code: "TAMPERED" }), false);
  assert.equal(verifyQueryHmac(secret, { ...params, hmac: "00" }), false);
});

test("verifyWebhookHmac checks the base64 body signature", () => {
  const secret = "shh";
  const body = Buffer.from(JSON.stringify({ shop_domain: "acme.myshopify.com" }));
  const good = createHmac("sha256", secret).update(body).digest("base64");
  assert.equal(verifyWebhookHmac(secret, body, good), true);
  assert.equal(verifyWebhookHmac(secret, body, "wrong"), false);
});

test("oauth state is single-use and carries its shop", () => {
  const db = openCloudDb(":memory:");
  const state = createState(db, "acme.myshopify.com");
  const row = takeState(db, state);
  assert.equal(row.shop_domain, "acme.myshopify.com");
  assert.equal(takeState(db, state), undefined); // single-use
});

test("exchangeCodeForToken captures refresh_token + expires_in when present", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 3600, scope: "read_orders" }), { status: 200 }));
  const r = await exchangeCodeForToken("acme.myshopify.com", "code", { clientId: "c", clientSecret: "s" });
  assert.equal(r.accessToken, "AT");
  assert.equal(r.refreshToken, "RT");
  assert.equal(r.expiresIn, 3600);
});

test("exchangeCodeForToken tolerates a non-expiring token (null refresh/expiry)", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ access_token: "AT", scope: "read_orders" }), { status: 200 }));
  const r = await exchangeCodeForToken("acme.myshopify.com", "code", { clientId: "c", clientSecret: "s" });
  assert.equal(r.accessToken, "AT");
  assert.equal(r.refreshToken, null);
  assert.equal(r.expiresIn, null);
});

test("refreshAccessToken posts grant_type=refresh_token and returns the rotated token", async (t) => {
  let sent;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ access_token: "AT2", refresh_token: "RT2", expires_in: 3600 }), { status: 200 });
  });
  const r = await refreshAccessToken("acme.myshopify.com", "RT1", { clientId: "c", clientSecret: "s" });
  assert.equal(sent.grant_type, "refresh_token");
  assert.equal(sent.refresh_token, "RT1");
  assert.equal(r.accessToken, "AT2");
  assert.equal(r.refreshToken, "RT2"); // rotated
  assert.equal(r.expiresIn, 3600);
});

test("refreshAccessToken keeps the old refresh token if Shopify doesn't rotate", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ access_token: "AT2", expires_in: 3600 }), { status: 200 }));
  const r = await refreshAccessToken("acme.myshopify.com", "RT1", { clientId: "c", clientSecret: "s" });
  assert.equal(r.refreshToken, "RT1");
});
