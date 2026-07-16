# ShopTalk — Full Context & Handoff

_A self-contained brief for a fresh agent (Codex) picking up this project._

## 1. What ShopTalk is
ShopTalk lets a Shopify merchant **run their store by texting it** — in plain language, from the native **Messages app (iMessage) on their iPhone, through Poke** (an AI assistant by The Interaction Company that operates over iMessage).

ShopTalk itself is an **MCP (Model Context Protocol) server that bridges Poke ↔ the Shopify Admin API**. It has **no UI of its own** — the interface IS iMessage/Poke. It is NOT a generic "AI agent" and has no dashboard.

Capabilities (~17 MCP tools): read orders, sales, customers, inventory, locations, and chargebacks/disputes; plus **confirm-gated writes** (cancel+refund an order, adjust inventory) that only execute after the merchant replies with a one-time code.

## 2. The goal
Ship ShopTalk as a **product other merchants use and pay for**, distributed via **Poke Kitchen** (Poke's "Recipes" system, which has a Recipe Creator Program that pays revenue on MCP usage). See the open product question in §5.

## 3. Architecture
Monorepo: `github.com/syedarman1/ShopTalk` (local `/Users/syedarman/Desktop/01_Projects/shoptalk`; work branch `shoptalk-release` → pushed to `main` on remote `shoptalk-origin`). Node 22 ESM throughout.

- **`backend/`** — the original single-tenant MCP server. express, better-sqlite3, @modelcontextprotocol/sdk. Shopify auth via client-credentials grant OR an injected token. ~17 tools in `mcp-tools.js`. 79 tests.
- **`cloud/`** — the multi-tenant MCP service (the product). Deployed on **Railway: `https://shoptalk-production-8fcc.up.railway.app`**. Reuses backend/'s tool layer verbatim. 35 tests (`node --test`).

### How multi-tenancy works
Each merchant gets a Poke connection key `stc_<id>:<secret>`. Poke sends it as `Authorization: Bearer stc_...:...` on every `/mcp` request. `resolveTenant()` maps the key → the merchant's shop row (holding their Shopify token, encrypted AES-256-GCM). The request runs inside `runInTenant()` (AsyncLocalStorage, `backend/context.js`), so backend/'s tools transparently query the right store with the right token.

### cloud/ routes
- `GET /` → redirect to `/connect`
- `GET/POST /connect` — BYO-token onboarding (§4)
- `GET /install` → `GET /auth/callback` — Shopify OAuth onboarding (§4)
- `GET /home` — post-onboarding UI; reveals the one-time Poke key
- `GET /privacy` — renders `PRIVACY.md`
- `GET /healthz` — config-readiness probe
- `ALL /mcp` — the MCP endpoint (per-tenant Bearer auth)
- `POST /webhooks` (+ `/webhooks/*`) — Shopify compliance webhooks (HMAC-verified)

## 4. Two onboarding paths — BOTH ARE BUILT
1. **OAuth (`/install`)** — click connect → Shopify authorize → `/auth/callback` exchanges the code for a token → stored encrypted → issues the Poke key → redirect to `/home`. Includes **expiring-token refresh** (Shopify's Apr 2026 rule: capture `refresh_token` + expiry, refresh near expiry). **Frictionless (one click) BUT blocked on real merchant stores** by Shopify's "This app is under review" gate until the app clears **Protected Customer Data (PCD) approval**.
2. **BYO-token (`/connect`)** — merchant creates a **custom app** in their own Shopify admin (Settings → Apps → Develop apps → add the 7 scopes → install → copy the `shpat_` Admin API token), then pastes store domain + token into `/connect`. Validated via `GET /admin/api/{v}/shop.json`, stored encrypted, issues the Poke key. **No Shopify review — works today — BUT high friction: every user must create their own custom app.**

## 5. ⚠️ THE UNRESOLVED PRODUCT QUESTION (where we're stuck)
For a **downloadable product**, BYO-token's onboarding is a dealbreaker — you can't ask every merchant to create a custom app + copy a token. The **frictionless "Connect your store" experience requires OAuth**, and OAuth on real merchant stores **requires Shopify's PCD approval** (the "under review" gate). There is no one-click connect without that approval.

Decision:
- **Finish OAuth + Shopify PCD approval** → frictionless product, gated on Shopify review (days–weeks; also has the compliance-webhook conflict below).
- **Ship BYO-token now** → works today for the owner + technical early adopters; not mass-market.

**Recommendation:** for a real product, finish the **PCD approval** to unlock OAuth. The OAuth infra is already built + deployed.

### Known OAuth-path blockers
- **PCD approval** not yet submitted (all form answers were drafted; `PRIVACY.md` is hosted at `/privacy`).
- **Compliance-webhook conflict:** Shopify's config-file (app-specific) webhooks are **not supported with `use_legacy_install_flow = true`** — which is required for the authorization-code OAuth on a non-embedded app. So the 3 mandatory compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) can't be registered via `shopify.app.toml`, and the new Dev Dashboard exposes no UI for them. **Unsolved.** The endpoints exist and HMAC-verify at `/webhooks`; they're just not registered with Shopify.
- **Alternative worth evaluating:** implement **MCP-level OAuth** (Poke performs OAuth against our `/mcp` server per-user; Poke supports OAuth MCP servers). Could remove the per-user key paste, but for real Shopify stores it still ultimately needs the Shopify app approved.

## 6. Shopify app
- Public app "ShopTalk", **client_id `68337e96ba692b42c2b3b92f827fe9a0`** (dev.shopify.com, org "syedarman"). Config managed via Shopify CLI (`~/shoptalk-config/shopify.app.toml`).
- Settings: **legacy install flow = ON**, **embedded = OFF**, 7 scopes: `read_orders, read_products, read_customers, read_inventory, read_locations, write_orders, write_inventory`. `read_all_orders` NOT requested (needs separate approval; lifts the ~60-day dispute-visibility window).
- Owner's store: **cypfat-gz.myshopify.com** (has 4 real chargebacks: #2176, #2161, #2046, #1918). For personal use it's served by the single-tenant `backend/`, not the cloud app.

## 7. Env vars (Railway service — NEVER commit)
`SHOPIFY_CLOUD_CLIENT_ID` (=68337e96…), `SHOPIFY_CLOUD_CLIENT_SECRET` (secret), `CLOUD_ENC_KEY` (64-hex, encrypts tokens at rest), `SHOPIFY_CLOUD_APP_URL` (=the Railway URL), `SHOPIFY_CLOUD_SCOPES`, `CLOUD_DB` (=`/data/cloud.db` on a Railway volume).
**Railway gotcha:** shared/project variables are NOT auto-injected — they must be set on the **service** itself.

## 8. Poke Kitchen distribution (researched)
- No marketplace. Distribution = **Recipes** at `poke.com/kitchen` (New Template = MCP URL; Create Recipe = bundle it). Recipe Creator Program pays revenue (`poke.com/kitchen/payouts`).
- An MCP integration is added by URL + API key → Poke sends `Authorization: Bearer <key>`.
- **API keys are per-user** (entered at `poke.com/integrations/new`). For ShopTalk each merchant's key is their own `stc_...:...` — NEVER a shared key (each maps to exactly one store).
- Unconfirmed: whether a Recipe can prompt each installer for their own key. If not, distribution falls back to sharing the `/connect` (or `/install`) link.

## 9. Code map
`cloud/`:
- `app.js` — `createApp(db)` factory; all routes; page renderers (`connectPage`, `appHome`, `privacyHtml`, `brandMark`); `ensureFreshToken` (OAuth token refresh); `validateShopifyToken`.
- `tenants.js` — SQLite schema (shops, mcp_credentials, oauth_states); `upsertShop`, `issueMcpCredential`, `resolveTenant`, `updateShopTokens`, `decryptRefreshToken`, `markUninstalled`, `createState`/`takeState`; idempotent column migration.
- `tenant-store.js` — `tenantStore(shopRow)` → injected-token store object for backend/.
- `oauth.js` — `installUrl`, `verifyQueryHmac`, `verifyWebhookHmac`, `exchangeCodeForToken`, `refreshAccessToken`, `isValidShopDomain`.
- `crypto.js` — AES-256-GCM encrypt/decrypt (key from `CLOUD_ENC_KEY`). `config.js` — env config. `Dockerfile` — builds from repo ROOT (cloud imports ../backend). `test/` — 35 tests.

`backend/`: `mcp-tools.js` (tools), `shopify.js` (`getAccessToken`/`shopifyGraphQL`/`getShopInfo`/`runReadQuery` — `getAccessToken` returns `store.accessToken` if injected), `context.js` (ALS: `runInTenant`/`boundStore`), `actions.js` (confirm-flow: `propose_*`/`confirm_action`).

## 10. Brand
Shopify-green shopping-bag icon + typing dots (`assets/brand/app-icon.png`, 1200×1200; SVG source `assets/brand/icon-shopify.svg`). Served pages render an inline green bag logo via `brandMark()`. Chosen deliberately so it reads "for Shopify" at a glance.

## 11. Constraints (MUST follow)
- Never add `Co-Authored-By` trailers to commits.
- Never commit secrets / `.env`; never expose the Client Secret or `CLOUD_ENC_KEY` values.
- Frontend is **demo-only** (mock data) — never wire real store data to it; real data flows only to Poke.
- Commit as Syed Arman with granular commits; run `node --test` in `cloud/` and `backend/` before pushing.

## 12. Immediate next step
Resolve the §5 fork. For a real product: **finish the Shopify PCD approval** (unblocks OAuth → frictionless onboarding) and resolve the legacy-flow compliance-webhook conflict (or evaluate MCP-level OAuth). To ship now: polish `/connect` and create a Poke Kitchen recipe pointing at `https://shoptalk-production-8fcc.up.railway.app/mcp`, with the `/connect` link in the setup instructions.
