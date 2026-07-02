// server.js — ShopTalk backend: the MCP endpoint Poke talks to.
// Express serves streamable-HTTP MCP at /mcp (auth-gated) plus a health check.

import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp-tools.js";
import { mcpAuthorized } from "./auth.js";

const PORT = process.env.PORT || 4000;
const app = express();

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
// Health check
// ---------------------------------------------------------------------------

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// MCP endpoint (streamable HTTP)
// ---------------------------------------------------------------------------
// Lets a remote MCP client like Poke call the tools directly, in-process —
// no stdio bridge, no supergateway, no tunnel-side proxy. Stateless: a fresh
// MCP server + transport per request (no sessions, nothing spawned).
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

async function handleMcp(req, res) {
  if (!mcpAuthorized(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  // The streamable-HTTP transport requires both types in Accept; force it so
  // clients that send */* or application/json alone aren't rejected with 406.
  forceAccept(req);
  const server = createMcpServer();
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

// Malformed JSON hits the body parser before auth, and Express's default
// handler echoes stack traces outside production — return clean JSON instead.
app.use((err, _req, res, _next) => {
  if (res.headersSent) return;
  const invalidJson = err?.type === "entity.parse.failed";
  res.status(invalidJson ? 400 : err?.status || 500).json({
    error: invalidJson ? "invalid JSON" : "request failed",
  });
});

app.listen(PORT, () => {
  console.log(`[shoptalk] MCP listening on http://localhost:${PORT}`);
  console.log(`[shoptalk]   GET  /api/health`);
  console.log(`[shoptalk]   ALL  /mcp   (MCP streamable HTTP)`);
  if (!process.env.MCP_TOKEN) {
    console.warn("[shoptalk] WARNING: MCP_TOKEN not set — /mcp accepts LOCAL (loopback) requests only. Set MCP_TOKEN to allow remote clients like Poke.");
  }
});
