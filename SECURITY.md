# Security Policy

## Reporting a vulnerability

Please report security issues privately by emailing **syedarman2003@gmail.com**.
Do not open a public GitHub issue for security reports. I'll acknowledge and
respond as soon as I can.

## Security posture

- **Read-only:** ShopTalk uses only read Shopify scopes (`read_orders`,
  `read_products`, `read_customers`, plus optionally the Shopify Payments read
  scopes for disputes/payouts); it cannot modify, create, or delete store data.
  The `run_query` tool rejects GraphQL mutations in code, and the read-only
  scopes make writes impossible regardless.
- **Credentials:** Shopify Client ID/Secret live only in environment variables and
  are never committed (`.env` is gitignored). The app exchanges them for a
  short-lived (24h) access token at runtime.
- **MCP endpoint:** `/mcp` requires a shared secret (`MCP_TOKEN`) so store data
  is not publicly readable. If `MCP_TOKEN` is unset, it **fails closed** —
  accepting local (loopback) requests only — so a deployed instance is never
  wide open by default.

## Supported version

The `main` branch is the supported version.
