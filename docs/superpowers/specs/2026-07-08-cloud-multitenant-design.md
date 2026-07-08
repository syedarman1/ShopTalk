# ShopTalk Cloud — Multi-Tenant Kitchen Service (Phase 2) — Design Spec

**Date:** 2026-07-08
**Status:** Approved to design. This is a large, externally-gated build
(Shopify public-app review) — it will be built in staged plans, not one pass.

## What this is

A second service, `cloud/`, in the ShopTalk repo: **one hosted URL that serves
many merchants**, so ShopTalk can be published as a Poke Kitchen template. A
merchant taps the template → OAuth-installs ShopTalk's public app on their store
→ their encrypted token is stored server-side → they text Poke and get all
**17 tools** (reads + the confirm-gated writes).

Single-tenant `backend/` (env vars, your store, self-host) stays exactly as-is
and unchanged. `cloud/` **imports** `backend/`'s tool + Shopify + actions
modules — one source of truth, no fork.

## Why a new service (not new repo, not folded into backend/)

Different trust model: `backend/` = your keys on your box. `cloud/` = *other
people's* OAuth tokens on our server → encrypted DB, install flow, tenant
routing, Shopify protected-data obligations on us as operator. Clean boundary
now; graduate to its own repo only if it gets real external users/billing.

## Architecture

```
cloud/
  app.js         Express: OAuth install/callback, Kitchen MCP OAuth, /mcp, /healthz
  oauth.js       Shopify OAuth: install redirect, HMAC-verified callback, token exchange
  tenants.js     SQLite (better-sqlite3): shops + encrypted tokens + issued MCP creds
  crypto.js      AES-256-GCM encrypt/decrypt of shop access tokens (key from env)
  mcp-oauth.js   OAuth Authorization-Server endpoints Kitchen/Poke use to get a tenant token
  tenant-store.js  builds a per-request `store` object {shopDomain, token} for a tenant
  test/
```

Reuses from `backend/` (imported, not copied): `mcp-tools.js` (`createMcpServer`),
`shopify.js`, `actions.js`, `introspect.js`. **One refactor in `backend/`**:
`shopifyGraphQL` currently calls `getAccessToken` (client-credentials) internally;
extract so a caller can inject a token. Add `shopifyGraphQLWithToken(store,
query, vars)` where `store` carries `{ shopDomain, apiVersion, accessToken }`;
`getAccessToken` path stays the default for single-tenant. Tenant requests pass
the decrypted OAuth token directly (OAuth tokens don't use the client-credentials
exchange). This is the one intrusive change and it must keep all 75 tests green.

## Data model (`cloud/` SQLite, on a Railway volume, gitignored)

- `shops(id, shop_domain UNIQUE, access_token_enc, scopes, installed_at, uninstalled_at)`
- `mcp_credentials(id, shop_id→shops, client_id, client_secret_hash, created_at)` —
  the per-tenant creds Kitchen/Poke authenticate with; secret stored hashed.
- `oauth_states(state, shop_domain, created_at)` — CSRF nonces for install, short TTL.

## Flows

### A. Merchant installs (Shopify OAuth)
1. `GET /install?shop=foo.myshopify.com` → validate shop domain → store `state`
   → redirect to Shopify `/admin/oauth/authorize` with our public app's client_id,
   the 17-tool scope set, redirect_uri, state.
2. `GET /auth/callback` → **verify HMAC** (Shopify signs the query) → check state
   → exchange `code` for an access token → **AES-encrypt** it → upsert `shops`
   → generate this shop's MCP client_id/secret → show the merchant a success
   page with the exact `npx poke mcp add … -k …` line (or the Kitchen deep link).
3. `POST /webhooks/app/uninstalled` (HMAC-verified) → mark `uninstalled_at`,
   wipe the token. Also register `shop/redact`, `customers/redact`,
   `customers/data_request` GDPR webhooks (Shopify requires them for public apps).

### B. Kitchen / Poke connects (MCP OAuth)
Kitchen's template flow wants an OAuth-capable MCP server ("Enter the MCP server
URL along with the OAuth Client ID and Client Secret"). `mcp-oauth.js` implements
the minimal OAuth 2.0 Authorization-Server surface the MCP spec expects
(`/.well-known/oauth-authorization-server`, `/authorize`, `/token`) so Poke can
obtain a bearer that maps to one shop. v1 acceptable simplification: the API-key
path (`-k <tenant secret>`) also works for CLI adds, mirroring `backend/`.

### C. A tenant texts Poke (request handling)
`POST /mcp` → authenticate the bearer/key → resolve `shop_id` → load + decrypt
the shop's token → build the tenant `store` object → `createMcpServer()` (stateless
per request, as today) with that store bound → run the tool. Every tool works
unchanged because they already take a `store`.

## Security posture (operator-grade — this is the serious part)

- Shop tokens **encrypted at rest** (AES-256-GCM; `CLOUD_ENC_KEY` env, 32 bytes).
- Tenant isolation: a bearer maps to exactly one `shop_id`; **no tool call can
  reach another shop's token** — unit-tested with two shops.
- MCP tenant secrets stored **hashed** (sha256), compared constant-time (reuse
  the auth.js helper).
- Shopify **HMAC verification** on every OAuth callback and webhook (reject
  otherwise) — non-negotiable, tested.
- GDPR/mandatory webhooks implemented (`customers/data_request`,
  `customers/redact`, `shop/redact`) — required to pass review.
- Rate limiting on `/mcp` and `/install` (add `express-rate-limit`).
- Confirm-flow writes: staging is currently an in-process Map — **must become
  per-shop** in `cloud/` (namespace codes by shop_id) so tenants can't confirm
  each other's actions. Tested.
- A public `PRIVACY.md` + data-handling summary (review requires a privacy URL).

## Shopify side (user action, starts the review clock)

A **new public/distribution app** (separate from your personal custom app):
its own client_id/secret, the 17-tool scopes incl. `write_orders`/`write_inventory`,
redirect URLs pointing at `cloud/`, mandatory + GDPR webhooks configured. Public
apps that touch orders/customers hit Shopify's **protected customer data**
review — an application + attestation, not instant. We start this early because
it gates launch, not code.

## Testing

`cloud/` tests on `:memory:`/temp DB: HMAC verify (valid/forged), OAuth callback
happy + tampered-state rejection, token encrypt/decrypt round-trip, two-tenant
isolation (shop A's bearer can't read shop B), per-shop confirm-code namespacing,
uninstall wipes token. `backend/` refactor keeps 75/75 green. CI gains a `cloud`
job.

## Staged delivery (each its own plan)

1. **Token-injection refactor in `backend/`** (safe, isolated; 75 tests stay green).
2. **`cloud/` tenancy core** — schema, crypto, tenant-store, per-request MCP wiring, isolation tests (mocked Shopify).
3. **Shopify OAuth install + webhooks** — HMAC, callback, uninstall, GDPR endpoints.
4. **MCP OAuth for Kitchen** + success page + docs + PRIVACY.md.
5. **Deploy `cloud/` (2nd Railway service + volume + envs), register the public app, submit for review, publish the Kitchen template.**

Parallel user track (no code dependency): create the public Shopify app and
begin the protected-data review — start at step 1 so it's approved by step 5.

## Non-goals (Phase 2 v1)

Billing/subscriptions, a tenant dashboard UI, multi-store-per-merchant rollups
in the hosted version, migrating your personal instance (it stays single-tenant),
anything that changes `backend/`'s self-host story.
