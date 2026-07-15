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
  refresh_token_enc TEXT,
  token_expires_at INTEGER,
  installed_at TEXT DEFAULT (datetime('now')),
  uninstalled_at TEXT
);
CREATE TABLE IF NOT EXISTS mcp_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  client_id TEXT UNIQUE NOT NULL,
  client_secret_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);`;

export function openCloudDb(path = process.env.CLOUD_DB || "./data/cloud.db") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec(SCHEMA);
  // Migrate DBs created before expiring-token support (ALTER is a no-op if the
  // column already exists).
  ensureColumn(db, "shops", "refresh_token_enc", "TEXT");
  ensureColumn(db, "shops", "token_expires_at", "INTEGER");
  return db;
}

function ensureColumn(db, table, col, decl) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

const sha = (s) => createHash("sha256").update(String(s)).digest("hex");

export function upsertShop(db, { shopDomain, accessToken, scopes, refreshToken = null, expiresIn = null }) {
  const enc = accessToken != null ? encrypt(accessToken) : null;
  const refEnc = refreshToken != null ? encrypt(refreshToken) : null;
  const expiresAt = expiresIn != null ? Date.now() + expiresIn * 1000 : null;
  db.prepare(
    `INSERT INTO shops (shop_domain, access_token_enc, scopes, refresh_token_enc, token_expires_at, uninstalled_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON CONFLICT(shop_domain) DO UPDATE SET
       access_token_enc = excluded.access_token_enc,
       scopes = excluded.scopes,
       refresh_token_enc = excluded.refresh_token_enc,
       token_expires_at = excluded.token_expires_at,
       uninstalled_at = NULL`
  ).run(shopDomain, enc, scopes ?? null, refEnc, expiresAt);
  return getShopByDomain(db, shopDomain);
}

// Persist a rotated token set after a refresh (keeps the same shop row).
export function updateShopTokens(db, shopId, { accessToken, refreshToken = null, expiresIn = null }) {
  const enc = accessToken != null ? encrypt(accessToken) : null;
  const refEnc = refreshToken != null ? encrypt(refreshToken) : null;
  const expiresAt = expiresIn != null ? Date.now() + expiresIn * 1000 : null;
  db.prepare("UPDATE shops SET access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ? WHERE id = ?")
    .run(enc, refEnc, expiresAt, shopId);
  return db.prepare("SELECT * FROM shops WHERE id = ?").get(shopId);
}

export function getShopByDomain(db, domain) {
  return db.prepare("SELECT * FROM shops WHERE shop_domain = ?").get(domain);
}

export function decryptToken(shopRow) {
  if (!shopRow?.access_token_enc) throw new Error("Shop has no stored token (uninstalled?).");
  return decrypt(shopRow.access_token_enc);
}

export function decryptRefreshToken(shopRow) {
  return shopRow?.refresh_token_enc ? decrypt(shopRow.refresh_token_enc) : null;
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
  db.prepare("UPDATE shops SET uninstalled_at = datetime('now'), access_token_enc = NULL, refresh_token_enc = NULL, token_expires_at = NULL WHERE shop_domain = ?").run(domain);
}

// --- OAuth CSRF state (single-use nonce tying an install to its callback) ---
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
