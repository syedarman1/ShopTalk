// app.js — ShopTalk Cloud: multi-tenant MCP over HTTP. Each merchant's Poke
// bearer maps to exactly one shop; the request runs inside that shop's ALS
// context, so backend/'s tools transparently query the right store with the
// right token. Reuses the single-tenant tool layer verbatim.
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "../backend/mcp-tools.js";
import { runInTenant } from "../backend/context.js";
import { openCloudDb, resolveTenant } from "./tenants.js";
import { tenantStore } from "./tenant-store.js";

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
  app.use(express.json());

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

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
