// auth.js — request authorization for ShopTalk's sensitive HTTP endpoints
// (/mcp and the /api/events SSE stream). Pure and unit-tested; server.js wires
// these into the Express routes.

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** True when the request comes from the local machine (a loopback address). */
export function isLoopback(req) {
  return LOOPBACK.has(req?.socket?.remoteAddress || "");
}

/**
 * Decide whether a request may access /mcp or the SSE stream.
 *
 * When a shared secret is configured, the request must present it — as a Bearer
 * token, X-API-Key, X-ShopTalk-Token, or ?token= (covering how MCP clients like
 * Poke's `mcp add -k` send a key, including EventSource which can't set headers).
 *
 * When no secret is configured, fail closed: allow only local (loopback)
 * requests. A publicly reachable instance with no MCP_TOKEN therefore refuses
 * remote callers instead of serving store data to anyone — while local
 * development (dashboard + a local Poke tunnel) keeps working with no config.
 *
 * `expected` defaults to MCP_TOKEN at call time; tests pass it explicitly.
 */
export function mcpAuthorized(req, expected = process.env.MCP_TOKEN) {
  if (!expected) return isLoopback(req);
  const auth = req.get?.("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided =
    bearer ||
    req.get?.("x-api-key") ||
    req.get?.("x-shoptalk-token") ||
    req.query?.token;
  return provided === expected;
}
