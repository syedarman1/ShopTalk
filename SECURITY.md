# Security Policy

## Reporting a vulnerability

Please report security issues privately by emailing **syedarman2003@gmail.com**.
Do not open a public GitHub issue for security reports. I'll acknowledge and
respond as soon as I can.

## Security posture

- **Reads by default, confirm-gated writes:** fourteen of seventeen tools are
  pure reads. The two write actions (cancel+refund an order; adjust inventory)
  never execute on first ask — a `propose_*` tool stages the change and returns
  a one-time code, and only the merchant's reply containing that code executes
  it (single-use, 15-minute expiry). The `run_query` escape hatch rejects
  GraphQL mutations in code. Write scopes (`write_orders`, `write_inventory`)
  are optional; without them the write tools fail with Shopify's access error.
- **Credentials:** Shopify Client ID/Secret live only in environment variables and
  are never committed (`.env` is gitignored). The app exchanges them for a
  short-lived (24h) access token at runtime.
- **MCP endpoint:** `/mcp` requires a shared secret (`MCP_TOKEN`) so store data
  is not publicly readable. If `MCP_TOKEN` is unset, it **fails closed** —
  accepting local (loopback) requests only — so a deployed instance is never
  wide open by default.

## Supported version

The `main` branch is the supported version.
