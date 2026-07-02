// mcp-server.js — standalone ShopTalk MCP server over stdio.
//
// Thin wrapper: the tool definitions live in mcp-tools.js (shared with the
// in-process HTTP endpoint in server.js). Here we wire them to the stdio
// transport for clients that spawn a local process instead of hitting /mcp.
//
// For hosted / cloud setups you usually don't need this file at all — server.js
// now serves the same tools over streamable HTTP at /mcp.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer } from "./mcp-tools.js";

const server = createMcpServer();

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the MCP transport — all logs must go to stderr.
  console.error("[shoptalk-mcp] server ready on stdio");
}

main().catch((err) => {
  console.error("[shoptalk-mcp] fatal:", err);
  process.exit(1);
});
