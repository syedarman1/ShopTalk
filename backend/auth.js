// auth.js — request authorization for ShopTalk's /mcp endpoint.
// Pure and unit-tested; server.js wires it into the Express route.

import { createHash, timingSafeEqual } from "node:crypto";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** True when the request comes from the local machine (a loopback address). */
export function isLoopback(req) {
  return LOOPBACK.has(req?.socket?.remoteAddress || "");
}

// Constant-time string comparison. Hash both sides first so neither the
// content nor the length of the secret leaks through timing.
function safeEqual(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Decide whether a request may access /mcp.
 *
 * When a shared secret is configured, the request must present it in a header —
 * Bearer, X-API-Key, or X-ShopTalk-Token (covering how MCP clients like Poke's
 * `mcp add -k` send a key). Query-string tokens are deliberately NOT accepted:
 * URLs routinely land in proxy and access logs.
 *
 * When no secret is configured, fail closed: allow only local (loopback)
 * requests. A publicly reachable instance with no MCP_TOKEN therefore refuses
 * remote callers instead of serving store data to anyone — while local
 * development (a local Poke tunnel) keeps working with no config.
 *
 * `expected` defaults to MCP_TOKEN at call time; tests pass it explicitly.
 */
export function mcpAuthorized(req, expected = process.env.MCP_TOKEN) {
  if (!expected) return isLoopback(req);
  const auth = req.get?.("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided = bearer || req.get?.("x-api-key") || req.get?.("x-shoptalk-token");
  return provided != null && safeEqual(provided, expected);
}
