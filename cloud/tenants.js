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
