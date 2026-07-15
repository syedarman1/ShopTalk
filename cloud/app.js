// app.js — ShopTalk Cloud: multi-tenant MCP over HTTP. Each merchant's Poke
// bearer maps to exactly one shop; the request runs inside that shop's ALS
// context, so backend/'s tools transparently query the right store with the
// right token. Reuses the single-tenant tool layer verbatim.
import express from "express";
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

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

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
