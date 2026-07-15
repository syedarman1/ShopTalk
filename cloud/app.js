// app.js — ShopTalk Cloud: multi-tenant MCP over HTTP. Each merchant's Poke
// bearer maps to exactly one shop; the request runs inside that shop's ALS
// context, so backend/'s tools transparently query the right store with the
// right token. Reuses the single-tenant tool layer verbatim.
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../backend/mcp-tools.js";
import { runInTenant } from "../backend/context.js";
import {
  openCloudDb, resolveTenant, upsertShop, issueMcpCredential,
  markUninstalled, createState, takeState,
} from "./tenants.js";
import { tenantStore } from "./tenant-store.js";
import { config } from "./config.js";
import {
  installUrl, isValidShopDomain, verifyQueryHmac, verifyWebhookHmac, exchangeCodeForToken,
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
    `h1,h2{line-height:1.25} code,pre{background:#f4f4f5;padding:.12em .35em;border-radius:4px} a{color:#2563eb}</style>` +
    `</head><body>${body}</body></html>`;
  return _privacyHtml;
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

  app.use(express.json());

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
      const { accessToken, scopes } = await exchangeCodeForToken(shop, String(req.query.code), config);
      const row = upsertShop(db, { shopDomain: shop, accessToken, scopes });
      const { clientId, secret } = issueMcpCredential(db, row.id);
      res.status(200).send(
        `<h2>ShopTalk connected \u{1F389}</h2><p>Connect Poke with:</p>` +
        `<pre>npx poke@latest mcp add ${config.appUrl}/mcp -n ShopTalk -k ${clientId}:${secret}</pre>` +
        `<p>Save this key — it is shown once.</p>`
      );
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
    const shop = authTenant(req);
    if (!shop) return res.status(401).json({ error: "unauthorized" });
    // Access log: WHO (tenant) touched WHAT (tool/method) and WHEN — never the
    // data itself. Satisfies the protected-data "log access to data" control.
    const rpc = req.body && typeof req.body === "object" ? req.body : {};
    const method = typeof rpc.method === "string" ? rpc.method : "unknown";
    const tool = method === "tools/call" ? rpc.params?.name : undefined;
    console.log(`[shoptalk-cloud] access ts=${new Date().toISOString()} shop=${shop.id} domain=${shop.shop_domain} method=${method}${tool ? ` tool=${tool}` : ""}`);
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
