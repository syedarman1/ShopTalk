# Cloud Stage 3 — Shopify OAuth Install + Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a merchant install ShopTalk Cloud via Shopify OAuth (install → HMAC-verified callback → encrypted token stored → per-merchant MCP credentials issued), and implement Shopify's mandatory `app/uninstalled` + GDPR webhooks. All against mocked Shopify; real Client Secret only needed at deploy.

**Architecture:** `cloud/config.js` reads app credentials/URLs from env. `cloud/oauth.js` = pure helpers (install URL, shop-domain guard, query-HMAC + webhook-HMAC verify, token exchange). `oauth_states` table (CSRF nonces) in tenants.js. `cloud/app.js` gains `/install`, `/auth/callback`, and webhook routes (raw-body for HMAC). Reuses Stage 2's `upsertShop`/`issueMcpCredential`/`markUninstalled`.

**Tech Stack:** existing cloud stack + `node:crypto`. No new deps.

## Global Constraints
- Every OAuth callback and webhook is **HMAC-verified** (reject on mismatch) — non-negotiable, tested.
- `shop` is validated as `*.myshopify.com` (single label) before any redirect or query — no open redirect / SSRF.
- OAuth `state` is single-use with a TTL; callback also checks the state's shop matches.
- Client Secret is read from env (`SHOPIFY_CLOUD_CLIENT_SECRET`), never committed; tests mock the token exchange.
- The App retains no customer records, so GDPR redact endpoints verify + 200 (shop/redact also wipes the token).

## File map
```
cloud/config.js     env-backed { clientId, clientSecret, appUrl, scopes }
cloud/oauth.js      installUrl, isValidShopDomain, verifyQueryHmac,
                    verifyWebhookHmac, exchangeCodeForToken
cloud/tenants.js    + oauth_states table, createState, takeState
cloud/app.js        + GET /install, GET /auth/callback, POST /webhooks/*
cloud/test/oauth.test.js       pure-helper + state tests
cloud/test/install.test.js     end-to-end install/callback/webhook via createApp
```

---

### Task 1: OAuth pure helpers + state store (TDD)

- [ ] **Step 1: tests** — `cloud/test/oauth.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
process.env.CLOUD_ENC_KEY = "d".repeat(64);
const { installUrl, isValidShopDomain, verifyQueryHmac, verifyWebhookHmac } = await import("../oauth.js");
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
```

- [ ] **Step 2:** red. **Step 3: implement** — `cloud/oauth.js`:

```js
// oauth.js — Shopify OAuth helpers (pure) + token exchange.
import { createHmac, timingSafeEqual } from "node:crypto";

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
export function isValidShopDomain(shop) {
  return typeof shop === "string" && SHOP_RE.test(shop);
}

export function installUrl(shop, state, { clientId, appUrl, scopes }) {
  const p = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: `${appUrl}/auth/callback`,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${p.toString()}`;
}

function safeEq(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function verifyQueryHmac(secret, query) {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;
  const msg = Object.keys(rest).sort()
    .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`)
    .join("&");
  const digest = createHmac("sha256", secret).update(msg).digest("hex");
  return safeEq(digest, hmac);
}

export function verifyWebhookHmac(secret, rawBody, headerB64) {
  if (!headerB64) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest("base64");
  return safeEq(digest, headerB64);
}

export async function exchangeCodeForToken(shop, code, { clientId, clientSecret }) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!res.ok) throw new Error(`Token exchange failed for ${shop} (HTTP ${res.status}).`);
  const json = await res.json();
  if (!json.access_token) throw new Error(`No access_token returned for ${shop}.`);
  return { accessToken: json.access_token, scopes: json.scope ?? null };
}
```

Add to `cloud/tenants.js` schema + functions:
```js
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```
```js
export function createState(db, shopDomain) {
  const state = randomBytes(16).toString("base64url");
  db.prepare("INSERT INTO oauth_states (state, shop_domain) VALUES (?, ?)").run(state, shopDomain);
  return state;
}
export function takeState(db, state) {
  const row = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(state);
  if (row) db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  return row;
}
```

- [ ] **Step 4:** green. **Step 5:** commit `cloud: OAuth helpers (HMAC, install URL, token exchange) + state store`.

---

### Task 2: install/callback/webhook routes (TDD)

- [ ] **Step 1: tests** — `cloud/test/install.test.js` (drives `createApp` over a real port; mocks Shopify token exchange; test's own requests pass through via saved realFetch):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
process.env.CLOUD_ENC_KEY = "e".repeat(64);
process.env.NODE_ENV = "test";
process.env.SHOPIFY_CLOUD_CLIENT_ID = "cid";
process.env.SHOPIFY_CLOUD_CLIENT_SECRET = "csecret";
process.env.SHOPIFY_CLOUD_APP_URL = "https://cloud.test";

const { createApp } = await import("../app.js");
const { openCloudDb, getShopByDomain, createState } = await import("../tenants.js");

const realFetch = globalThis.fetch;
const listen = (app) => new Promise((r) => { const s = app.listen(0, () => r({ s, port: s.address().port })); });
const signQuery = (params) => {
  const msg = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return createHmac("sha256", "csecret").update(msg).digest("hex");
};

test("GET /install redirects a valid shop to Shopify authorize", async () => {
  const db = openCloudDb(":memory:");
  const { s, port } = await listen(createApp(db));
  try {
    const res = await realFetch(`http://127.0.0.1:${port}/install?shop=acme.myshopify.com`, { redirect: "manual" });
    assert.equal(res.status, 302);
    const loc = res.headers.get("location");
    assert.match(loc, /^https:\/\/acme\.myshopify\.com\/admin\/oauth\/authorize/);
    assert.match(loc, /client_id=cid/);
  } finally { s.close(); }
});

test("GET /install rejects a non-myshopify shop", async () => {
  const db = openCloudDb(":memory:");
  const { s, port } = await listen(createApp(db));
  try {
    const res = await realFetch(`http://127.0.0.1:${port}/install?shop=evil.com`, { redirect: "manual" });
    assert.equal(res.status, 400);
  } finally { s.close(); }
});

test("GET /auth/callback verifies HMAC+state, stores an encrypted token, issues creds", async (t) => {
  const db = openCloudDb(":memory:");
  const state = createState(db, "acme.myshopify.com");
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url).includes("/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "TENANT-TOKEN", scope: "read_orders" }), { status: 200 });
    }
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
    const body = await res.text();
    assert.match(body, /mcp add/); // success page shows the Poke connect line
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
  const { upsertShop } = await import("../tenants.js");
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
```

- [ ] **Step 2:** red. **Step 3: implement** — `cloud/config.js`:
```js
export const config = {
  clientId: process.env.SHOPIFY_CLOUD_CLIENT_ID || "",
  clientSecret: process.env.SHOPIFY_CLOUD_CLIENT_SECRET || "",
  appUrl: process.env.SHOPIFY_CLOUD_APP_URL || "http://localhost:4700",
  scopes: process.env.SHOPIFY_CLOUD_SCOPES ||
    "read_orders,read_all_orders,read_products,read_customers,read_inventory,read_locations,write_orders,write_inventory",
};
```
In `cloud/app.js`, inside `createApp(db)` **before** `app.use(express.json())`, mount raw-body webhook routes; then add install/callback. Key pieces:
```js
import { config } from "./config.js";
import { installUrl, isValidShopDomain, verifyQueryHmac, verifyWebhookHmac, exchangeCodeForToken } from "./oauth.js";
import { upsertShop, issueMcpCredential, markUninstalled, createState, takeState } from "./tenants.js";

// --- webhooks need the raw body for HMAC; mount before express.json() ---
const raw = express.raw({ type: "application/json" });
function webhook(path, handler) {
  app.post(path, raw, (req, res) => {
    if (!verifyWebhookHmac(config.clientSecret, req.body, req.get("X-Shopify-Hmac-Sha256"))) {
      return res.status(401).json({ error: "invalid hmac" });
    }
    const payload = JSON.parse(req.body.toString("utf8") || "{}");
    return handler(req, res, payload);
  });
}
webhook("/webhooks/app/uninstalled", (req, res, p) => {
  const shop = p.domain || req.get("X-Shopify-Shop-Domain");
  if (shop) markUninstalled(db, shop);
  res.status(200).json({ ok: true });
});
webhook("/webhooks/shop/redact", (req, res, p) => {
  if (p.shop_domain) markUninstalled(db, p.shop_domain);
  res.status(200).json({ ok: true });
});
webhook("/webhooks/customers/redact", (_req, res) => res.status(200).json({ ok: true, note: "No customer data retained." }));
webhook("/webhooks/customers/data_request", (_req, res) => res.status(200).json({ ok: true, note: "No customer data retained." }));

app.use(express.json()); // everything below parses JSON

app.get("/install", (req, res) => {
  const shop = String(req.query.shop || "");
  if (!isValidShopDomain(shop)) return res.status(400).send("Invalid shop. Use your-store.myshopify.com.");
  const state = createState(db, shop);
  res.redirect(302, installUrl(shop, state, config));
});

app.get("/auth/callback", async (req, res) => {
  try {
    const shop = String(req.query.shop || "");
    if (!isValidShopDomain(shop)) return res.status(400).send("Invalid shop.");
    if (!verifyQueryHmac(config.clientSecret, req.query)) return res.status(401).send("HMAC verification failed.");
    const st = takeState(db, String(req.query.state || ""));
    if (!st || st.shop_domain !== shop) return res.status(400).send("Invalid or expired state.");
    const { accessToken, scopes } = await exchangeCodeForToken(shop, String(req.query.code), config);
    const row = upsertShop(db, { shopDomain: shop, accessToken, scopes });
    const { clientId, secret } = issueMcpCredential(db, row.id);
    res.status(200).send(
      `<h2>ShopTalk connected 🎉</h2><p>Connect Poke with:</p>` +
      `<pre>npx poke@latest mcp add ${config.appUrl}/mcp -n ShopTalk -k ${clientId}:${secret}</pre>` +
      `<p>Save this — the key is shown once.</p>`
    );
  } catch (err) {
    res.status(502).send(`Install failed: ${err.message}`);
  }
});
```

- [ ] **Step 4:** `cd cloud && node --test` green (Stage-2 tests unaffected). **Step 5:** commit `cloud: OAuth install/callback + mandatory & GDPR webhooks`.

---

### Task 3: docs + env example + push + CI

- [ ] **Step 1:** `cloud/.env.example` documenting `SHOPIFY_CLOUD_CLIENT_ID/SECRET`, `SHOPIFY_CLOUD_APP_URL`, `SHOPIFY_CLOUD_SCOPES`, `CLOUD_ENC_KEY`, `CLOUD_DB`. Root `.gitignore` already covers `cloud/data/`; ensure `.env*` covered (it is).
- [ ] **Step 2:** README ShopTalk-Cloud section: add the install URL (`/install?shop=…`) and the four webhook paths (what the user pastes into the app config's webhook settings at Stage 5).
- [ ] **Step 3:** commit `cloud: env example + install/webhook docs`; push; watch CI (all jobs) → success.

## Self-Review
**Spec coverage:** HMAC on callback + webhooks (T1/T2), shop-domain guard (T1), single-use state (T1/T2), encrypted token on install (T2), issued per-merchant creds shown once (T2), mandatory + GDPR webhooks (T2), env/docs (T3). ✓
**Type consistency:** `config` shape consumed by `installUrl`/`exchangeCodeForToken`/routes; `createState`/`takeState`/`upsertShop`/`issueMcpCredential`/`markUninstalled` signatures match Stage 2; webhook raw-body mounted before json(). ✓
**No placeholders.** ✓
