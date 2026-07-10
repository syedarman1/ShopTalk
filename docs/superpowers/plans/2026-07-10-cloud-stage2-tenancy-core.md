# Cloud Stage 2 — Tenancy Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The multi-tenant heart of ShopTalk Cloud: encrypted per-shop token storage, per-request tenant `store` resolution, per-shop confirm-code namespacing, and a `/mcp` handler that binds one shop per request — all against mocked Shopify, no OAuth/webhooks yet (Stage 3).

**Architecture:** New `cloud/` directory in the ShopTalk repo. SQLite (better-sqlite3) holds shops + AES-256-GCM-encrypted OAuth tokens + hashed per-tenant MCP secrets. `tenantStore(shop)` builds the injected-token `store` object Stage 1 accepts. The Express `/mcp` handler authenticates a bearer → resolves shop → decrypts token → `createMcpServer()` bound to that shop (reusing `backend/`'s tools verbatim). Confirm-flow staging becomes per-shop.

**Tech Stack:** Node 22 ESM, better-sqlite3, express, `@modelcontextprotocol/sdk`, `node:crypto`. Imports `backend/` modules directly (one source of truth).

## Global Constraints
- `cloud/` NEVER stores a plaintext shop token: AES-256-GCM at rest, key from `CLOUD_ENC_KEY` (64 hex chars = 32 bytes).
- One bearer ⇒ exactly one shop. A tool call for shop A must be structurally incapable of reaching shop B's token — tested with two shops.
- Per-tenant MCP secret stored as sha256, compared constant-time.
- Confirm codes namespaced by shop_id — tenant A cannot confirm tenant B's staged action.
- `backend/` unchanged except imports; its 78 tests stay green. Cloud DB path `CLOUD_DB` (default `./data/cloud.db`), tests use `:memory:`.
- Real Shopify calls are mocked in tests; no OAuth/webhook code this stage.

## File map
```
cloud/
  crypto.js        encrypt(text)/decrypt(blob) AES-256-GCM
  tenants.js       openCloudDb, upsertShop, getShopByDomain, issueMcpCredential,
                   resolveTenant(clientId, secret), markUninstalled
  tenant-store.js  tenantStore(shopRow) -> injected `store`; decrypts token
  actions-store.js per-shop confirm staging (namespaced Map) reused by cloud handler
  app.js           Express: /healthz + POST/GET/DELETE /mcp (bearer -> shop -> tools)
  test/
```
NOTE the confirm-flow: `backend/actions.js` currently uses a module-level Map
keyed by code. For multi-tenant we need code keys namespaced by shop. Cleanest:
`backend/actions.js` gains an optional `namespace` on stage/take (default "" =
single-tenant, unchanged). Cloud passes `shop:<id>`. This keeps ONE implementation.

---

### Task 1: token encryption (TDD)

**Files:** Create `cloud/crypto.js`, `cloud/test/crypto.test.js`.

**Interfaces:** `encrypt(plaintext) => string` (base64 iv:tag:ct), `decrypt(blob) => string`. Key from `CLOUD_ENC_KEY` (throws if missing/wrong length).

- [ ] **Step 1: scaffold** — `cloud/package.json`:
```json
{
  "name": "shoptalk-cloud",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": { "start": "node app.js", "test": "node --test" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "better-sqlite3": "^11.10.0",
    "express": "^4.21.2"
  }
}
```
`cd cloud && npm install`. Add `cloud/data/` and `cloud/node_modules/` to root `.gitignore` (append `cloud/data/`).

- [ ] **Step 2: failing tests** — `cloud/test/crypto.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.CLOUD_ENC_KEY = "a".repeat(64); // 32 bytes hex
const { encrypt, decrypt } = await import("../crypto.js");

test("round-trips a token and produces different ciphertext each time (random IV)", () => {
  const t = "shpat_tenant_secret_token";
  const a = encrypt(t), b = encrypt(t);
  assert.notEqual(a, b);
  assert.equal(decrypt(a), t);
  assert.equal(decrypt(b), t);
});

test("a tampered ciphertext fails authentication", () => {
  const blob = encrypt("hello");
  const raw = Buffer.from(blob, "base64"); raw[raw.length - 1] ^= 0xff;
  assert.throws(() => decrypt(raw.toString("base64")), /decrypt/i);
});
```

- [ ] **Step 3: implement** — `cloud/crypto.js`:
```js
// crypto.js — AES-256-GCM for shop tokens at rest. Blob = base64(iv|tag|ct).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const hex = process.env.CLOUD_ENC_KEY || "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("CLOUD_ENC_KEY must be 64 hex chars (32 bytes).");
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(blob) {
  try {
    const raw = Buffer.from(String(blob), "base64");
    const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), ct = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (e) {
    throw new Error(`Failed to decrypt token: ${e.message}`);
  }
}
```

- [ ] **Step 4:** `cd cloud && node --test test/crypto.test.js` green. **Step 5:** commit `cloud: AES-256-GCM token encryption`.

---

### Task 2: tenant store (SQLite) (TDD)

**Files:** Create `cloud/tenants.js`, `cloud/test/tenants.test.js`.

**Interfaces:** `openCloudDb(path?)`, `upsertShop(db, { shopDomain, accessToken, scopes }) => shopRow`, `getShopByDomain(db, domain)`, `issueMcpCredential(db, shopId) => { clientId, secret }` (secret returned once, stored hashed), `resolveTenant(db, clientId, secret) => shopRow | null`, `markUninstalled(db, domain)`, `decryptToken(shopRow) => token`.

- [ ] **Step 1: failing tests** — `cloud/test/tenants.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.CLOUD_ENC_KEY = "b".repeat(64);
const { openCloudDb, upsertShop, getShopByDomain, issueMcpCredential, resolveTenant, markUninstalled, decryptToken } = await import("../tenants.js");
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
```

- [ ] **Step 2:** red. **Step 3: implement** — `cloud/tenants.js`:
```js
// tenants.js — shops, encrypted tokens, and per-tenant MCP credentials.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { encrypt, decrypt } from "./crypto.js";

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_domain TEXT UNIQUE NOT NULL,
  access_token_enc TEXT,
  scopes TEXT,
  installed_at TEXT DEFAULT (datetime('now')),
  uninstalled_at TEXT
);
CREATE TABLE IF NOT EXISTS mcp_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  client_id TEXT UNIQUE NOT NULL,
  client_secret_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);`;

export function openCloudDb(path = process.env.CLOUD_DB || "./data/cloud.db") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec(SCHEMA);
  return db;
}
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");

export function upsertShop(db, { shopDomain, accessToken, scopes }) {
  const enc = accessToken != null ? encrypt(accessToken) : null;
  db.prepare(
    `INSERT INTO shops (shop_domain, access_token_enc, scopes, uninstalled_at)
     VALUES (?, ?, ?, NULL)
     ON CONFLICT(shop_domain) DO UPDATE SET
       access_token_enc = excluded.access_token_enc,
       scopes = excluded.scopes,
       uninstalled_at = NULL`
  ).run(shopDomain, enc, scopes ?? null);
  return getShopByDomain(db, shopDomain);
}
export function getShopByDomain(db, domain) {
  return db.prepare("SELECT * FROM shops WHERE shop_domain = ?").get(domain);
}
export function decryptToken(shopRow) {
  if (!shopRow?.access_token_enc) throw new Error("Shop has no stored token (uninstalled?).");
  return decrypt(shopRow.access_token_enc);
}
export function issueMcpCredential(db, shopId) {
  const clientId = "stc_" + randomBytes(9).toString("base64url");
  const secret = randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO mcp_credentials (shop_id, client_id, client_secret_hash) VALUES (?, ?, ?)")
    .run(shopId, clientId, sha(secret));
  return { clientId, secret };
}
export function resolveTenant(db, clientId, secret) {
  const cred = db.prepare("SELECT * FROM mcp_credentials WHERE client_id = ?").get(clientId);
  if (!cred) return null;
  const a = Buffer.from(sha(secret)), b = Buffer.from(cred.client_secret_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const shop = db.prepare("SELECT * FROM shops WHERE id = ?").get(cred.shop_id);
  if (!shop || shop.uninstalled_at || !shop.access_token_enc) return null;
  return shop;
}
export function markUninstalled(db, domain) {
  db.prepare("UPDATE shops SET uninstalled_at = datetime('now'), access_token_enc = NULL WHERE shop_domain = ?").run(domain);
}
```

- [ ] **Step 4:** green. **Step 5:** commit `cloud: tenant store — encrypted tokens + hashed MCP credentials`.

---

### Task 3: per-shop confirm namespacing (TDD, backend + cloud)

**Files:** Modify `backend/actions.js` (+ `namespace` param, default unchanged), `backend/test/actions.test.js` (append one isolation test).

- [ ] **Step 1: test** — append to `backend/test/actions.test.js`:
```js
test("confirm codes are isolated by namespace (tenant safety)", () => {
  _clearPending();
  const a = stageAction("cancel_refund", "shopA", { orderName: "#A" }, { namespace: "shop:1" });
  // another tenant cannot consume shop 1's code
  assert.throws(() => takeAction(a.code, "shop:2"), /never existed|used already/i);
  // right namespace works
  const got = takeAction(a.code, "shop:1");
  assert.equal(got.payload.orderName, "#A");
});
```

- [ ] **Step 2:** red. **Step 3: implement** — in `backend/actions.js`, key the Map by `${namespace} ${CODE}`:
```js
export function stageAction(kind, storeKey, payload, { ttlMs = PENDING_TTL_MS, prefix, namespace = "" } = {}) {
  const code = makeCode(prefix ?? (kind === "cancel_refund" ? "R" : "I"));
  const expiresAtMs = Date.now() + ttlMs;
  pending.set(`${namespace} ${code}`, { kind, store: storeKey ?? null, payload, expiresAt: expiresAtMs });
  return { code, expiresAt: new Date(expiresAtMs).toISOString() };
}

export function takeAction(code, namespace = "") {
  const mapKey = `${namespace} ${String(code).trim().toUpperCase()}`;
  const action = pending.get(mapKey);
  if (!action) throw new Error(`No pending action with code "${String(code).trim().toUpperCase()}" — it may have been used already or never existed. Propose again.`);
  pending.delete(mapKey);
  if (Date.now() > action.expiresAt) throw new Error(`Code "${String(code).trim().toUpperCase()}" expired (codes last 15 minutes). Propose the action again.`);
  return action;
}
```
`confirmAction(code)` stays as-is (namespace defaults to "" — single-tenant behaviour identical); the cloud handler will call the exported `propose*`/`takeAction` with a namespace via a thin wrapper in a later step if needed. For Stage 2, expose `confirmActionNs(code, namespace)` that calls `takeAction(code, namespace)` then the existing executor. Add:
```js
export async function confirmActionNs(code, namespace) {
  const { default: _ } = { default: null }; // no-op to keep diff local
  const action = takeAction(code, namespace);
  return executeActionForTests(action); // executeAction is module-private; export a wrapper
}
```
(Implementation note: rename nothing; simply export `confirmActionNs` that reuses the private `executeAction`. Keep `confirmAction` = `confirmActionNs(code, "")`.)

- [ ] **Step 4:** full `backend` suite green (79). **Step 5:** commit `backend: namespace confirm codes by tenant (default unchanged)`.

---

### Task 4: tenant-bound `/mcp` handler + isolation test (TDD)

**Files:** Create `cloud/tenant-store.js`, `cloud/app.js`, `cloud/test/mcp.test.js`.

**Interfaces:** `tenantStore(shopRow) => { key, shopDomain, apiVersion, accessToken }` (key = `shop:<id>`, apiVersion from `SHOPIFY_API_VERSION` env default "2026-04"). `app` = Express app.

- [ ] **Step 1: tenant-store** — `cloud/tenant-store.js`:
```js
import { decryptToken } from "./tenants.js";
export function tenantStore(shopRow) {
  return {
    key: `shop:${shopRow.id}`,
    shopDomain: shopRow.shop_domain,
    apiVersion: process.env.SHOPIFY_API_VERSION || "2026-04",
    accessToken: decryptToken(shopRow),
  };
}
```

- [ ] **Step 2: app** — `cloud/app.js`:
```js
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../backend/mcp-tools.js";
import { openCloudDb, resolveTenant } from "./tenants.js";
import { tenantStore } from "./tenant-store.js";

const PORT = process.env.PORT || 4700;
export const app = express();
const db = openCloudDb();
app.use(express.json());

app.get("/healthz", (_req, res) => res.json({ ok: true }));

function authTenant(req) {
  const auth = req.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const raw = bearer || req.get("x-api-key");
  if (!raw || !raw.includes(":")) return null;
  const i = raw.indexOf(":");
  return resolveTenant(db, raw.slice(0, i), raw.slice(i + 1)); // clientId:secret
}

function forceAccept(req) {
  const v = "application/json, text/event-stream";
  req.headers.accept = v;
  if (Array.isArray(req.rawHeaders)) {
    const n = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      if (String(req.rawHeaders[i]).toLowerCase() !== "accept") n.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
    n.push("Accept", v); req.rawHeaders = n;
  }
}

async function handleMcp(req, res) {
  const shop = authTenant(req);
  if (!shop) return res.status(401).json({ error: "unauthorized" });
  forceAccept(req);
  const server = createMcpServer({ store: tenantStore(shop), namespace: `shop:${shop.id}` });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
  catch (err) { if (!res.headersSent) res.status(500).json({ error: "request failed" }); }
}
app.post("/mcp", handleMcp); app.get("/mcp", handleMcp); app.delete("/mcp", handleMcp);
app.use((err, _req, res, _next) => { if (!res.headersSent) res.status(err?.type === "entity.parse.failed" ? 400 : 500).json({ error: "invalid request" }); });

if (process.env.NODE_ENV !== "test") app.listen(PORT, () => console.log(`[shoptalk-cloud] :${PORT}`));
```
APPROACH (chosen over threading a bound store through 17 tools):
**AsyncLocalStorage.** `createMcpServer()` and every tool stay byte-identical.
A new `backend/context.js` exports `runInTenant({ store, namespace }, fn)`,
`boundStore()`, `boundNamespace()`. `resolveStore` returns the ALS-bound store
when set; `actions.js` staging uses `boundNamespace()` when no explicit
namespace is passed. The cloud handler wraps `transport.handleRequest(...)` in
`runInTenant(...)`, so every tool call in that request transparently sees the
tenant's store — no per-tool changes, single-tenant path (empty ALS) unchanged.

- [ ] **Step 2a: `backend/context.js` + hooks** — create context.js (below);
  in `stores.js` `resolveStore`, first line `const b = boundStore(); if (b) return b;`;
  in `actions.js` `stageAction`/`takeAction`, default `namespace` to `boundNamespace()`.
  Backend tests stay 79 green (ALS empty in tests → no-ops).

```js
// backend/context.js — per-request tenant binding via AsyncLocalStorage.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage();
export function runInTenant(ctx, fn) { return als.run(ctx, fn); }
export function boundStore() { return als.getStore()?.store ?? null; }
export function boundNamespace() { return als.getStore()?.namespace ?? ""; }
```
(app.js then wraps: `await runInTenant({ store: tenantStore(shop), namespace: \`shop:${shop.id}\` }, () => transport.handleRequest(req, res, req.body));` and `createMcpServer()` is called with NO args, exactly as single-tenant.)

- [ ] **Step 3: isolation test** — `cloud/test/mcp.test.js`: seed two shops with tokens "TOK-A"/"TOK-B", issue creds each; mock `fetch` so the Shopify call echoes back which `X-Shopify-Access-Token` it saw; drive `tools/call get_shop_info` through `app` with shop A's `clientId:secret` and assert the outbound token was TOK-A and never TOK-B; then shop B's creds → TOK-B; a bad secret → 401. (Use `supertest`-style: import `app`, use Node's `http` + a random port, or call the handler directly with a mock req/res. Simplest: start `app.listen(0)` in the test, POST with fetch.)

- [ ] **Step 4:** `cd cloud && node --test` green; `cd backend && node --test` still 79. **Step 5:** commit `cloud: tenant-bound /mcp handler with per-shop token + isolation test`.

---

### Task 5: CI + README section

- [ ] **Step 1:** `.github/workflows/ci.yml` — add a `cloud` job (Node 22, `working-directory: cloud`, `npm ci` + `npm test`). Set `CLOUD_ENC_KEY` as a job env with a throwaway 64-hex value for tests.
- [ ] **Step 2:** README — new "## ShopTalk Cloud (multi-tenant, in progress)" section: what it is, the trust model, "self-host `backend/` is unchanged and recommended for a single store," and that Cloud awaits a public Shopify app + review. Link the Phase 2 spec.
- [ ] **Step 3:** commit `cloud: CI job + README section`; push; watch CI (all 3 jobs) → success.

## Self-Review
**Spec coverage:** encryption at rest (T1), encrypted store + hashed creds + uninstall wipe (T2), per-shop confirm isolation (T3), tenant-bound handler + two-shop token isolation + bound-store refactor (T4), CI/docs (T5). ✓
**Type consistency:** `tenantStore` output = Stage-1 injected `store` shape (`{key,shopDomain,apiVersion,accessToken}`); `createMcpServer({store,namespace})` optional args keep `createMcpServer()` identical; `resolveTenant`/`issueMcpCredential` signatures consistent across tenants.js and app.js. ✓
**Risk note:** Task 4's `createMcpServer` refactor is the one intrusive change — gated by the 78/79 backend tests staying green; if threading proves messy, fall back to a wrapper that sets a per-request AsyncLocalStorage store (documented alternative).
