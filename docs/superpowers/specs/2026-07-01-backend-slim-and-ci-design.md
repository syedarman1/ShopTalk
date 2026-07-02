# Backend Slim-Down + CI — Design Spec

**Date:** 2026-07-01
**Status:** Approved (user picked "hygiene batch" and confirmed the sequence).

## Goal

Two hygiene items, one batch:

1. **Slim the backend to what Poke actually uses.** The dashboard is demo-only
   (air-gapped, mock data), so the backend's dashboard-serving layer — the SSE
   stream, its broadcast plumbing, and the store-list REST endpoint — is dead
   code that is still publicly reachable and carried the audit's remaining
   security findings (`/api/stores` unauthenticated; `/internal/broadcast`
   guarded only by a spoofable-behind-proxy IP check). Delete the layer.
2. **CI + mocked-API tests.** A GitHub Actions workflow that runs both test
   suites and the frontend build on every push/PR, a badge in the README, and
   unit tests (with a mocked `fetch`) for the riskiest untested code: the
   Shopify network layer (token exchange/cache, 401 invalidate-and-retry,
   429 backoff, GraphQL error propagation, and the all-stores partial-failure
   rollup).

## Part 1 — Slim the backend

**Delete:**
- `backend/server.js`: the SSE broadcaster (`clients` set + `broadcast()`),
  `GET /api/events`, `GET /api/stores`, `POST /internal/broadcast`, the `cors`
  middleware + import, and the now-unused `listStoreSummaries` import. Boot log
  updated to list only `/api/health` and `/mcp`.
- `backend/notify.js` (entire file — its only purpose was POSTing to
  `/internal/broadcast`).
- `backend/mcp-tools.js`: the injected `broadcast` callback — signature becomes
  `createMcpServer()` — and all 7 `await broadcast({...})` blocks (their
  `message` strings served only the dashboard). Tool return values to the MCP
  client are unchanged.
- `backend/mcp-server.js` (stdio entry): drop the `notifyDashboard` import;
  call `createMcpServer()`.
- `backend/package.json`: remove the `cors` dependency (regenerate lockfile).

**Keep (explicitly):**
- `GET /api/health` — harmless, useful for Railway health checks.
- The UUID-strip middleware and `forceAccept()` — Poke tunnel/Accept quirks.
- `backend/auth.js` unchanged (incl. `?token=` support — harmless flexibility
  for clients that pass keys via query) and its tests; `mcpAuthorized` still
  gates `/mcp`, `isLoopback` still backs the no-token loopback-only fallback.
- The stdio entrypoint itself (`npm run mcp`) — a legitimate alternate transport.

**Docs updated to match:** README (security bullet ~line 102, architecture tree
~118, `.env` comment ~153, deploy section ~176-178: drop `CORS_ORIGIN`
instruction and the SSE-specific "not serverless" rationale — keep the always-on
advice, reworded for MCP responses) and SECURITY.md (~line 16: drop the
`/api/events` mention).

**Consequence (accepted by user):** the backend can no longer feed any live
dashboard without re-adding code. Real data flows only to Poke.

## Part 2 — CI + network tests

**Workflow** `.github/workflows/ci.yml`:
- Triggers: `push` to `main`, `pull_request` to `main`.
- Job `backend`: Node 22, `npm ci` + `npm test` in `backend/`.
- Job `frontend`: Node 22, `npm ci` + `npm test` + `npm run build` in `frontend/`.
- Badge added at the top of the README:
  `![CI](https://github.com/syedarman1/ShopTalk/actions/workflows/ci.yml/badge.svg)`

**New tests** `backend/test/shopify.network.test.js` — mock `globalThis.fetch`
(via `node:test`'s `mock.method`), never touching real Shopify:
1. `getAccessToken` caches per store (two calls → one token-exchange fetch).
2. `shopifyGraphQL` on 401: drops the cached token, retries once with a fresh
   token, succeeds.
3. Persistent 401 → throws the clear "Authentication failed… check scopes /
   installed" message (not a generic error).
4. 429 then success → backs off and succeeds (accepts the real ~1s sleep in
   this one test; no mocked timers to keep it simple).
5. GraphQL-level `errors` array → thrown message includes the GraphQL message.
6. `getSalesAllStores` partial failure: two configured stores, one healthy and
   one whose token exchange 401s → result contains the healthy store in
   `perStore`, the bad store in `failures`, and `combined` reflects only the
   healthy store.

Test-isolation notes (bake into the plan): each `node --test` file runs in its
own process, so module-level caches (`tokenCache`, `tzCache`, `getStores`
memoization) are fresh per file; within the file, use distinct store keys per
test to avoid cache cross-talk; set `process.env.SHOPIFY_STORES` at the top of
the test file (before any `getStores()` call) for the rollup test; route the
fetch mock by URL (`/oauth/access_token` vs `graphql.json`) and by query body
(`ianaTimezone` vs `orders`) since `getSales` also triggers a timezone lookup
(which safely falls back to UTC on failure).

## Verification
- Both suites green locally (backend grows past 31; frontend stays 24).
- Boot smoke: `POST /mcp` initialize from loopback (no token) → 200;
  `GET /api/events`, `GET /api/stores`, `POST /internal/broadcast` → 404.
- After push: `gh run watch` confirms the CI workflow itself goes green on
  GitHub — the real acceptance test for Part 2.

## Non-goals
- No pagination work (audit #3 — separate decision).
- No auth.js changes; no frontend changes (badge/README aside).
- No mocked-timer machinery; the single 429 test may take ~1s.
