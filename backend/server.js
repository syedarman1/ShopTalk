// server.js — ShopTalk web backend.
// Serves the REST API the dashboard reads from, and owns the Server-Sent
// Events stream that pushes live updates to every connected browser. The MCP
// process (mcp-server.js) calls the Shopify Admin API and then pings
// POST /internal/broadcast so those mutations show up in the UI instantly.

import express from "express";
import cors from "cors";
import { listStoreSummaries } from "./stores.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp-tools.js";

const PORT = process.env.PORT || 4000;
const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000" }));
app.use(express.json());

// Tolerate clients/tunnels that prefix the path with a per-session UUID
// (e.g. Poke's tunnel sends /<uuid>/mcp); collapse it back to the real path so
// the /mcp route below matches whether or not a tunnel sits in front.
app.use((req, _res, next) => {
  const stripped = req.url.replace(
    /^\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?=\/|$)/,
    ""
  );
  if (stripped !== req.url) req.url = stripped || "/";
  next();
});

// ---------------------------------------------------------------------------
// SSE broadcaster
// ---------------------------------------------------------------------------

/** @type {Set<import('express').Response>} */
const clients = new Set();

function broadcast(event) {
  const payload = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    res.write(frame);
  }
  return payload;
}

app.get("/api/events", (req, res) => {
  // The SSE stream carries tool results (incl. customer data), so gate it like
  // /mcp. Browsers can't set headers on EventSource, so the dashboard passes the
  // token as ?token=... When MCP_TOKEN is unset this is open (dev only).
  if (!mcpAuthorized(req)) return res.status(401).json({ error: "unauthorized" });
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Let proxies/Nginx know not to buffer.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  clients.add(res);
  // Greet the client so the hook can flip to "connected".
  res.write(
    `data: ${JSON.stringify({
      type: "connected",
      message: "Live stream connected",
      timestamp: new Date().toISOString(),
    })}\n\n`
  );

  // Keep the connection alive through idle proxies. A real event (not an SSE
  // comment) so the browser surfaces it — the dashboard uses it as a heartbeat
  // to detect zombie connections and show a truthful online/offline status.
  const keepAlive = setInterval(
    () => res.write(`data: ${JSON.stringify({ type: "ping" })}\n\n`),
    25000
  );

  req.on("close", () => {
    clearInterval(keepAlive);
    clients.delete(res);
  });
});

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, clients: clients.size });
});

app.get("/api/stores", (_req, res) => {
  try {
    res.json({ stores: listStoreSummaries() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Internal hook the MCP process calls after a successful tool run. Not meant
// for browsers — it simply fans the event out to all SSE clients.
app.post("/internal/broadcast", (req, res) => {
  const ip = req.socket.remoteAddress || "";
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) {
    return res.status(403).json({ error: "forbidden" });
  }
  const event = req.body || {};
  const payload = broadcast(event);
  res.json({ ok: true, delivered: clients.size, payload });
});

// ---------------------------------------------------------------------------
// MCP endpoint (streamable HTTP)
// ---------------------------------------------------------------------------
// Lets a remote MCP client like Poke drive the database directly, in-process —
// no stdio bridge, no supergateway, no tunnel-side proxy. Stateless: a fresh
// MCP server + transport per request (no sessions, nothing spawned), and tool
// mutations broadcast straight to the SSE clients above.
// @hono/node-server (used by the SDK transport) builds the Web Request from
// req.rawHeaders, so to override Accept we must rewrite that raw array — not
// just req.headers.
function forceAccept(req) {
  const value = "application/json, text/event-stream";
  req.headers.accept = value;
  if (Array.isArray(req.rawHeaders)) {
    const next = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (String(req.rawHeaders[i]).toLowerCase() !== "accept") {
        next.push(req.rawHeaders[i], req.rawHeaders[i + 1]);
      }
    }
    next.push("Accept", value);
    req.rawHeaders = next;
  }
}

// Optional shared-secret auth for /mcp. When MCP_TOKEN is set, every /mcp request
// must present it (Bearer, X-API-Key, or X-ShopTalk-Token — covers how MCP clients
// like Poke's `mcp add -k` send a key). When unset, /mcp is open (dev only).
function mcpAuthorized(req) {
  const expected = process.env.MCP_TOKEN;
  if (!expected) return true;
  const auth = req.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided = bearer || req.get("x-api-key") || req.get("x-shoptalk-token") || req.query.token;
  return provided === expected;
}

async function handleMcp(req, res) {
  if (!mcpAuthorized(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  // The streamable-HTTP transport requires both types in Accept; force it so
  // clients that send */* or application/json alone aren't rejected with 406.
  forceAccept(req);
  const server = createMcpServer(broadcast);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[shoptalk-mcp-http] error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

app.post("/mcp", handleMcp);
app.get("/mcp", handleMcp);
app.delete("/mcp", handleMcp);

app.listen(PORT, () => {
  console.log(`[shoptalk] API + SSE listening on http://localhost:${PORT}`);
  console.log(`[shoptalk]   GET  /api/stores`);
  console.log(`[shoptalk]   GET  /api/events   (SSE)`);
  console.log(`[shoptalk]   ALL  /mcp          (MCP streamable HTTP)`);
  if (!process.env.MCP_TOKEN) {
    console.warn("[shoptalk] WARNING: MCP_TOKEN not set — /mcp is unauthenticated. Set it before exposing the backend publicly.");
  }
});
