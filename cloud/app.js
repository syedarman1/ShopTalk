// app.js — ShopTalk Cloud: multi-tenant MCP over HTTP. Each merchant's Poke
// bearer maps to exactly one shop; the request runs inside that shop's ALS
// context, so backend/'s tools transparently query the right store with the
// right token. Reuses the single-tenant tool layer verbatim.
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { marked } from "marked";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../backend/mcp-tools.js";
import { runInTenant } from "../backend/context.js";
import {
  openCloudDb, resolveTenant, upsertShop, updateShopTokens, decryptRefreshToken,
  issueMcpCredential, markUninstalled, createState, takeState,
} from "./tenants.js";
import { tenantStore } from "./tenant-store.js";
import { config } from "./config.js";
import {
  installUrl, isValidShopDomain, verifyQueryHmac, verifyWebhookHmac,
  exchangeCodeForToken, refreshAccessToken,
} from "./oauth.js";

// Rendered privacy policy — PRIVACY.md is the single source of truth; cached
// after first render. Served at /privacy for the app listing + PCD review.
let _privacyHtml = null;
function privacyHtml() {
  if (_privacyHtml) return _privacyHtml;
  let body;
  try {
    const md = readFileSync(fileURLToPath(new URL("../PRIVACY.md", import.meta.url)), "utf8");
    body = marked.parse(md);
  } catch {
    body = "<h1>ShopTalk — Privacy Policy</h1><p>Contact syedarman2003@gmail.com.</p>";
  }
  _privacyHtml =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>ShopTalk — Privacy Policy</title>` +
    `<style>body{max-width:44rem;margin:2.5rem auto;padding:0 1.2rem;` +
    `font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1b1b1b}` +
    `h1,h2{line-height:1.25} code,pre{background:#f4f4f5;padding:.12em .35em;border-radius:4px} a{color:#5E8E3E}</style>` +
    `</head><body>${body}</body></html>`;
  return _privacyHtml;
}

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The app's merchant-facing "home" (non-embedded UI): the post-auth redirect
// lands here, and it reveals the one-time Poke connection command when present.
function appHome({ command }) {
  const key = command
    ? `<p>Connect Poke with this one-time command:</p><pre>${escapeHtml(command)}</pre><p class="muted">Copy it now — the key is shown only once.</p>`
    : `<p class="muted">ShopTalk is connected. Your Poke connection key is shown once, right after installing — reinstall from your store to generate a new one.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ShopTalk</title>` +
    `<style>body{max-width:44rem;margin:3rem auto;padding:0 1.2rem;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1b1b1b}` +
    `.brand{display:flex;align-items:center;gap:.6rem;font-weight:700;font-size:1.35rem}` +
    `.logo{width:40px;height:40px;border-radius:11px;background:linear-gradient(135deg,#95BF47,#5E8E3E)}` +
    `h1{font-size:1.5rem;margin:1.4rem 0 .4rem}h2{font-size:1.1rem;margin:1.6rem 0 .4rem}` +
    `pre{background:#f4f4f5;padding:.9rem 1rem;border-radius:10px;overflow-x:auto;font-size:.86rem}` +
    `.muted{color:#6b7280}ul{padding-left:1.1rem}li{margin:.2rem 0}</style></head><body>` +
    `<div class="brand"><div class="logo"></div>ShopTalk</div>` +
    `<h1>ShopTalk is connected \u{1F389}</h1>${key}` +
    `<h2>How to use it</h2><p>Text your store from the Messages app on your iPhone, through Poke. For example:</p>` +
    `<ul><li>&ldquo;How did sales go last week?&rdquo;</li><li>&ldquo;Any open chargebacks?&rdquo;</li><li>&ldquo;What inventory is low?&rdquo;</li><li>&ldquo;Cancel and refund order #1042&rdquo; — ShopTalk asks you to confirm first.</li></ul>` +
    `<p class="muted">Reads your store only when you ask. Writes always require a one-time confirmation code.</p></body></html>`;
}

// Verify a merchant-supplied Admin API token works for their store (cheap
// authenticated call that succeeds with any valid token).
async function validateShopifyToken(shopDomain, token) {
  const v = process.env.SHOPIFY_API_VERSION || "2026-04";
  const res = await fetch(`https://${shopDomain}/admin/api/${v}/shop.json`, {
    headers: { "X-Shopify-Access-Token": token, Accept: "application/json" },
  });
  return res.ok;
}

// The Kitchen onboarding page: a merchant pastes their store + custom-app token
// (no OAuth, no Shopify review) and gets back a Poke connection key.
function connectPage({ error } = {}) {
  const err = error ? `<p class="err">${escapeHtml(error)}</p>` : "";
  const scopes = "read_orders, read_products, read_customers, read_inventory, read_locations, write_orders, write_inventory";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect ShopTalk</title>` +
    `<style>body{max-width:44rem;margin:3rem auto;padding:0 1.2rem;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1b1b1b}` +
    `.brand{display:flex;align-items:center;gap:.6rem;font-weight:700;font-size:1.35rem}` +
    `.logo{width:40px;height:40px;border-radius:11px;background:linear-gradient(135deg,#95BF47,#5E8E3E)}` +
    `h1{font-size:1.5rem;margin:1.4rem 0 .4rem}h2{font-size:1.05rem;margin:1.6rem 0 .5rem}` +
    `code{background:#f4f4f5;padding:.1em .35em;border-radius:5px;font-size:.9em}ol{padding-left:1.2rem}li{margin:.35rem 0}` +
    `label{display:block;margin:.9rem 0 .3rem;font-weight:600}input{width:100%;box-sizing:border-box;padding:.7rem .8rem;border:1px solid #d1d5db;border-radius:9px;font-size:1rem}` +
    `button{margin-top:1.2rem;background:#5E8E3E;color:#fff;border:0;padding:.75rem 1.4rem;border-radius:9px;font-size:1rem;font-weight:600;cursor:pointer}` +
    `.err{color:#b91c1c;background:#fef2f2;padding:.7rem 1rem;border-radius:9px}.muted{color:#6b7280}a{color:#5E8E3E}</style></head><body>` +
    `<div class="brand"><div class="logo"></div>ShopTalk</div>` +
    `<h1>Connect your store</h1>` +
    `<p>ShopTalk lets you text your Shopify store from Poke. Connect it with a token from your own Shopify admin — no app install needed.</p>` +
    `<h2>1 &middot; Create a token in Shopify</h2>` +
    `<ol><li>In your Shopify admin: <b>Settings &rarr; Apps and sales channels &rarr; Develop apps</b> (enable custom app development if prompted).</li>` +
    `<li><b>Create an app</b>, then under <b>Configuration &rarr; Admin API scopes</b> enable: <code>${scopes}</code>.</li>` +
    `<li><b>Install</b> the app, then under <b>API credentials</b> reveal and copy the <b>Admin API access token</b> (starts with <code>shpat_</code>) — shown once.</li></ol>` +
    `<h2>2 &middot; Paste it here</h2>${err}` +
    `<form method="post" action="/connect" autocomplete="off">` +
    `<label>Store domain<input name="shop" placeholder="your-store.myshopify.com" autocapitalize="off" spellcheck="false"></label>` +
    `<label>Admin API access token<input name="token" type="password" placeholder="shpat_..." autocomplete="off"></label>` +
    `<button type="submit">Connect</button></form>` +
    `<p class="muted" style="margin-top:1.4rem">Your token is stored encrypted and used only to answer your own requests. See our <a href="/privacy">privacy policy</a>.</p>` +
    `</body></html>`;
}

// Refresh an expiring offline token when it's within REFRESH_BUFFER_MS of
// expiry, persisting the rotated set. Non-expiring tokens (no token_expires_at)
// and still-valid ones pass through untouched. On refresh failure we fall back
// to the stored token rather than break the request.
const REFRESH_BUFFER_MS = 120_000;
export async function ensureFreshToken(db, shop) {
  if (!shop.token_expires_at || Date.now() < shop.token_expires_at - REFRESH_BUFFER_MS) return shop;
  const refreshToken = decryptRefreshToken(shop);
  if (!refreshToken) return shop;
  try {
    const t = await refreshAccessToken(shop.shop_domain, refreshToken, config);
    return updateShopTokens(db, shop.id, { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresIn: t.expiresIn });
  } catch (err) {
    console.error(`[shoptalk-cloud] token refresh failed for shop=${shop.id}: ${err.message}`);
    return shop;
  }
}

// The streamable-HTTP transport needs both Accept types; force it.
function forceAccept(req) {
  const v = "application/json, text/event-stream";
  req.headers.accept = v;
  if (Array.isArray(req.rawHeaders)) {
    const n = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (String(req.rawHeaders[i]).toLowerCase() !== "accept") n.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
    }
    n.push("Accept", v);
    req.rawHeaders = n;
  }
}

export function createApp(db) {
  const app = express();

  // One-time reveal of the Poke connection command, carried across the
  // post-auth redirect (in-memory; consumed within seconds of install).
  const reveals = new Map();
  const stageReveal = (command) => { const t = randomBytes(18).toString("base64url"); reveals.set(t, { command, exp: Date.now() + 600000 }); return t; };
  const takeReveal = (t) => { const r = reveals.get(t); if (!r) return null; reveals.delete(t); return Date.now() > r.exp ? null : r.command; };

  // Webhooks need the RAW body for HMAC — mount before express.json().
  const raw = express.raw({ type: "application/json" });
  function webhook(path, handler) {
    app.post(path, raw, (req, res) => {
      if (!verifyWebhookHmac(config.clientSecret, req.body, req.get("X-Shopify-Hmac-Sha256"))) {
        return res.status(401).json({ error: "invalid hmac" });
      }
      let payload = {};
      try { payload = JSON.parse(req.body.toString("utf8") || "{}"); } catch { /* empty */ }
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
  // Unified compliance endpoint — Shopify's canonical model is ONE URI with the
  // topic in the X-Shopify-Topic header. Kept alongside the per-topic paths so
  // either dashboard style (single URL or per-topic) works.
  webhook("/webhooks", (req, res, p) => {
    const topic = req.get("X-Shopify-Topic") || "";
    const shop = p.shop_domain || p.domain || req.get("X-Shopify-Shop-Domain");
    if ((topic === "shop/redact" || topic === "app/uninstalled") && shop) markUninstalled(db, shop);
    res.status(200).json({ ok: true });
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Readiness probe: reports whether the required env vars reached this
  // process. Secret VALUES are never echoed (booleans only); clientId and
  // appUrl are public (they appear in the OAuth redirect), so echoing them
  // aids deploy debugging.
  app.get("/healthz", (_req, res) => res.json({
    ok: true,
    config: {
      clientId: config.clientId || null,
      clientSecret: Boolean(config.clientSecret),
      encKey: Boolean(process.env.CLOUD_ENC_KEY),
      appUrl: config.appUrl,
    },
  }));

  // Hosted privacy policy (required for the app listing + protected-data review).
  app.get("/privacy", (_req, res) => res.type("html").send(privacyHtml()));

  // Merchant-facing app home (non-embedded UI). The post-auth redirect lands
  // here; ?t=<token> reveals the one-time connect command.
  app.get("/home", (req, res) => res.type("html").send(appHome({ command: req.query.t ? takeReveal(String(req.query.t)) : null })));

  // --- Poke Kitchen onboarding: bring-your-own custom-app token (no OAuth) ---
  app.get("/", (_req, res) => res.redirect(302, "/connect"));
  app.get("/connect", (_req, res) => res.type("html").send(connectPage()));
  app.post("/connect", async (req, res) => {
    try {
      const shop = String(req.body.shop || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const token = String(req.body.token || "").trim();
      if (!isValidShopDomain(shop)) return res.status(400).type("html").send(connectPage({ error: "Enter a valid your-store.myshopify.com domain." }));
      if (!token) return res.status(400).type("html").send(connectPage({ error: "Paste your Admin API access token." }));
      if (!(await validateShopifyToken(shop, token))) return res.status(400).type("html").send(connectPage({ error: "That token didn't work for that store — double-check the domain and token." }));
      const row = upsertShop(db, { shopDomain: shop, accessToken: token, scopes: null });
      const { clientId, secret } = issueMcpCredential(db, row.id);
      const command = `npx poke@latest mcp add ${config.appUrl}/mcp -n ShopTalk -k ${clientId}:${secret}`;
      return res.type("html").send(appHome({ command }));
    } catch (err) {
      return res.status(502).type("html").send(connectPage({ error: `Connection failed: ${err.message}` }));
    }
  });

  // --- Shopify OAuth: merchant install ---
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
      const { accessToken, scopes, refreshToken, expiresIn } = await exchangeCodeForToken(shop, String(req.query.code), config);
      const row = upsertShop(db, { shopDomain: shop, accessToken, scopes, refreshToken, expiresIn });
      const { clientId, secret } = issueMcpCredential(db, row.id);
      const command = `npx poke@latest mcp add ${config.appUrl}/mcp -n ShopTalk -k ${clientId}:${secret}`;
      // Redirect to the app UI (satisfies the review check "redirects to app UI
      // after authentication"); the token reveals the key once on /home.
      return res.redirect(302, `${config.appUrl}/home?t=${stageReveal(command)}`);
    } catch (err) {
      res.status(502).send(`Install failed: ${err.message}`);
    }
  });

  // Bearer / X-API-Key carries "clientId:secret" for one shop.
  function authTenant(req) {
    const auth = req.get("authorization") || "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    const raw = bearer || req.get("x-api-key") || "";
    const i = raw.indexOf(":");
    if (i < 0) return null;
    return resolveTenant(db, raw.slice(0, i), raw.slice(i + 1));
  }

  async function handleMcp(req, res) {
    let shop = authTenant(req);
    if (!shop) return res.status(401).json({ error: "unauthorized" });
    // Access log: WHO (tenant) touched WHAT (tool/method) and WHEN — never the
    // data itself. Satisfies the protected-data "log access to data" control.
    const rpc = req.body && typeof req.body === "object" ? req.body : {};
    const method = typeof rpc.method === "string" ? rpc.method : "unknown";
    const tool = method === "tools/call" ? rpc.params?.name : undefined;
    console.log(`[shoptalk-cloud] access ts=${new Date().toISOString()} shop=${shop.id} domain=${shop.shop_domain} method=${method}${tool ? ` tool=${tool}` : ""}`);
    shop = await ensureFreshToken(db, shop); // refresh an expiring token before use
    forceAccept(req);
    const server = createMcpServer(); // identical to single-tenant; store comes from ALS
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await runInTenant(
        { store: tenantStore(shop), namespace: `shop:${shop.id}` },
        () => transport.handleRequest(req, res, req.body)
      );
    } catch (err) {
      console.error("[shoptalk-cloud] mcp error:", err.message);
      if (!res.headersSent) res.status(500).json({ error: "request failed" });
    }
  }

  app.post("/mcp", handleMcp);
  app.get("/mcp", handleMcp);
  app.delete("/mcp", handleMcp);

  app.use((err, _req, res, _next) => {
    if (res.headersSent) return;
    res.status(err?.type === "entity.parse.failed" ? 400 : 500).json({
      error: err?.type === "entity.parse.failed" ? "invalid JSON" : "request failed",
    });
  });

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const PORT = process.env.PORT || 4700;
  createApp(openCloudDb()).listen(PORT, () => {
    console.log(`[shoptalk-cloud] MCP listening on http://localhost:${PORT}`);
    console.log(`[shoptalk-cloud]   GET  /healthz`);
    console.log(`[shoptalk-cloud]   ALL  /mcp   (per-tenant, clientId:secret)`);
  });
}
