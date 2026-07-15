import { test } from "node:test";
import assert from "node:assert/strict";
process.env.CLOUD_ENC_KEY = "b".repeat(64);
const { openCloudDb, upsertShop, updateShopTokens, getShopByDomain, issueMcpCredential, resolveTenant, markUninstalled, decryptToken, decryptRefreshToken } = await import("../tenants.js");
const fresh = () => openCloudDb(":memory:");

test("upsertShop stores an ENCRYPTED token and decryptToken recovers it", () => {
  const db = fresh();
  const shop = upsertShop(db, { shopDomain: "a.myshopify.com", accessToken: "tok-A", scopes: "read_orders" });
  const raw = db.prepare("SELECT access_token_enc FROM shops WHERE id=?").get(shop.id).access_token_enc;
  assert.notEqual(raw, "tok-A"); // never plaintext
  assert.equal(decryptToken(getShopByDomain(db, "a.myshopify.com")), "tok-A");
});

test("upsert refreshes the token on reinstall (same domain)", () => {
  const db = fresh();
  const a = upsertShop(db, { shopDomain: "a.myshopify.com", accessToken: "old", scopes: "x" });
  const b = upsertShop(db, { shopDomain: "a.myshopify.com", accessToken: "new", scopes: "x" });
  assert.equal(a.id, b.id);
  assert.equal(decryptToken(getShopByDomain(db, "a.myshopify.com")), "new");
});

test("issued MCP secret is stored hashed; resolveTenant matches only the right pair", () => {
  const db = fresh();
  const shop = upsertShop(db, { shopDomain: "a.myshopify.com", accessToken: "t", scopes: "x" });
  const { clientId, secret } = issueMcpCredential(db, shop.id);
  const stored = db.prepare("SELECT client_secret_hash FROM mcp_credentials WHERE client_id=?").get(clientId).client_secret_hash;
  assert.notEqual(stored, secret);
  assert.equal(resolveTenant(db, clientId, secret).id, shop.id);
  assert.equal(resolveTenant(db, clientId, "wrong"), null);
  assert.equal(resolveTenant(db, "nope", secret), null);
});

test("markUninstalled wipes the token and blocks resolution", () => {
  const db = fresh();
  const shop = upsertShop(db, { shopDomain: "a.myshopify.com", accessToken: "t", scopes: "x" });
  const { clientId, secret } = issueMcpCredential(db, shop.id);
  markUninstalled(db, "a.myshopify.com");
  assert.equal(db.prepare("SELECT access_token_enc FROM shops WHERE id=?").get(shop.id).access_token_enc, null);
  assert.equal(resolveTenant(db, clientId, secret), null);
});

test("upsertShop stores an ENCRYPTED refresh token + expiry; helpers recover them", () => {
  const db = fresh();
  const before = Date.now();
  upsertShop(db, { shopDomain: "a.myshopify.com", accessToken: "AT", scopes: "x", refreshToken: "RT", expiresIn: 3600 });
  const row = getShopByDomain(db, "a.myshopify.com");
  assert.notEqual(row.refresh_token_enc, "RT"); // never plaintext
  assert.equal(decryptRefreshToken(row), "RT");
  assert.ok(row.token_expires_at >= before + 3600 * 1000);
  assert.ok(row.token_expires_at <= Date.now() + 3600 * 1000);
});

test("updateShopTokens rotates the stored token set", () => {
  const db = fresh();
  const shop = upsertShop(db, { shopDomain: "a.myshopify.com", accessToken: "AT", scopes: "x", refreshToken: "RT", expiresIn: 3600 });
  updateShopTokens(db, shop.id, { accessToken: "AT2", refreshToken: "RT2", expiresIn: 3600 });
  const row = getShopByDomain(db, "a.myshopify.com");
  assert.equal(decryptToken(row), "AT2");
  assert.equal(decryptRefreshToken(row), "RT2");
});

test("a non-expiring token stores null refresh/expiry", () => {
  const db = fresh();
  upsertShop(db, { shopDomain: "a.myshopify.com", accessToken: "AT", scopes: "x" });
  const row = getShopByDomain(db, "a.myshopify.com");
  assert.equal(row.refresh_token_enc, null);
  assert.equal(row.token_expires_at, null);
  assert.equal(decryptRefreshToken(row), null);
});

test("markUninstalled also wipes the refresh token + expiry", () => {
  const db = fresh();
  upsertShop(db, { shopDomain: "a.myshopify.com", accessToken: "AT", scopes: "x", refreshToken: "RT", expiresIn: 3600 });
  markUninstalled(db, "a.myshopify.com");
  const row = getShopByDomain(db, "a.myshopify.com");
  assert.equal(row.refresh_token_enc, null);
  assert.equal(row.token_expires_at, null);
});
