// server.js — MockBase web backend.
// Serves the REST API the dashboard reads from, and owns the Server-Sent
// Events stream that pushes live updates to every connected browser. The MCP
// process (mcp-server.js) writes to the same SQLite file and then pings
// POST /internal/broadcast so those mutations show up in the UI instantly.

import express from "express";
import cors from "cors";
import { getTables, getTableData } from "./db.js";
import { seedMockData } from "./seed.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp-tools.js";

const PORT = process.env.PORT || 4000;
const app = express();

app.use(cors());
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

// All table schemas + row counts.
app.get("/api/tables", (_req, res) => {
  try {
    res.json({ tables: getTables() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All rows for one table.
app.get("/api/data/:table", (req, res) => {
  try {
    const rows = getTableData(req.params.table);
    res.json({ table: req.params.table, rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// "Mock Data" button target — seeds the DB then notifies the stream.
app.post("/api/seed", (_req, res) => {
  try {
    const summary = seedMockData();
    broadcast({
      type: "seed",
      tool: "seed",
      message: summary,
    });
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Internal hook the MCP process calls after a successful tool run. Not meant
// for browsers — it simply fans the event out to all SSE clients.
app.post("/internal/broadcast", (req, res) => {
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

async function handleMcp(req, res) {
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
    console.error("[mockbase-mcp-http] error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

app.post("/mcp", handleMcp);
app.get("/mcp", handleMcp);
app.delete("/mcp", handleMcp);

app.listen(PORT, () => {
  console.log(`[mockbase] API + SSE listening on http://localhost:${PORT}`);
  console.log(`[mockbase]   GET  /api/tables`);
  console.log(`[mockbase]   GET  /api/data/:table`);
  console.log(`[mockbase]   GET  /api/events   (SSE)`);
  console.log(`[mockbase]   POST /api/seed`);
  console.log(`[mockbase]   ALL  /mcp          (MCP streamable HTTP)`);
});
