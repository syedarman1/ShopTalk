// mcp-proxy.js — debug/glue reverse proxy that sits in front of supergateway (:8000).
//
// Why this exists: the MCP streamable-HTTP transport returns HTTP 406 unless the
// client's `Accept` header contains BOTH "application/json" AND "text/event-stream".
// Some clients (including how Poke's request arrives over the tunnel) don't send
// both — even a default "Accept: */*" is rejected — so every POST /mcp 406s.
//
// This proxy:
//   1. LOGS each incoming request (method, path, accept/content-type/user-agent)
//      so we can see exactly what the client sent.
//   2. FORCES the dual Accept header before forwarding, eliminating the 406.
//   3. Streams responses straight through, so text/event-stream replies are
//      preserved unbuffered.
//
// Run:  node mcp-proxy.js     (listens on :8080, forwards to :8000)
// Then point the Poke tunnel at http://localhost:8080/mcp instead of :8000.

import http from "node:http";

const UPSTREAM_HOST = process.env.UPSTREAM_HOST || "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT || 8000);
const LISTEN_PORT = Number(process.env.PROXY_PORT || 8080);

// The Poke tunnel prepends a per-session UUID segment (e.g. /<uuid>/mcp), but
// supergateway only routes the flat /mcp path and 404s anything else. Strip a
// leading /<uuid> so the request reaches the real route.
const UUID_PREFIX =
  /^\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?=\/|$)/;

const server = http.createServer((req, res) => {
  const stamp = new Date().toISOString();
  const fwdPath = req.url.replace(UUID_PREFIX, "") || "/";
  const rewrote = fwdPath !== req.url;
  console.error(
    `[${stamp}] ${req.method} ${req.url}${rewrote ? ` -> ${fwdPath}` : ""} ` +
      `accept=${JSON.stringify(req.headers.accept ?? null)} ` +
      `ua=${JSON.stringify(req.headers["user-agent"] ?? null)}`
  );

  const headers = {
    ...req.headers,
    host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
    // The fix: guarantee the dual Accept the streamable-HTTP transport demands.
    accept: "application/json, text/event-stream",
  };
  delete headers["accept-encoding"]; // keep SSE responses unbuffered

  const upstream = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: fwdPath,
      headers,
    },
    (up) => {
      console.error(
        `[${new Date().toISOString()}]   <- ${up.statusCode} for ${req.method} ${fwdPath}`
      );
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );

  upstream.on("error", (err) => {
    console.error(`[mcp-proxy] upstream error: ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("proxy upstream error");
  });

  req.pipe(upstream);
});

server.listen(LISTEN_PORT, () => {
  console.error(
    `[mcp-proxy] listening on http://localhost:${LISTEN_PORT}  ->  ` +
      `http://${UPSTREAM_HOST}:${UPSTREAM_PORT}  (forcing Accept: application/json, text/event-stream)`
  );
});
