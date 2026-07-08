# Cloud Stage 1 — Token Injection Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let `shopify.js` accept an injected OAuth access token on the `store` object, so a future multi-tenant `cloud/` layer can hand each tool a tenant's token instead of doing the client-credentials exchange — with zero behavior change for the single-tenant self-host path.

**Architecture:** One seam. `getAccessToken(store)` returns `store.accessToken` immediately when present (no exchange, no cache); otherwise the existing client-credentials flow. `shopifyGraphQL`'s 401 path skips the retry for injected tokens (refreshing a static token can't help) and reports a tenant-appropriate error. No other file changes; all 75 tests stay green.

**Tech Stack:** existing. No deps.

## Global Constraints
- Self-host path (env-var stores, no `accessToken`) must behave byte-identically — the existing token-cache/refresh/429/401-retry tests must all still pass unchanged.
- Injected token is used verbatim in `X-Shopify-Access-Token`; never cached, never sent to the OAuth exchange endpoint.

---

### Task 1: injected-token support (TDD)

**Files:** Modify `backend/shopify.js` (`getAccessToken`, `shopifyGraphQL`). Test: `backend/test/shopify.network.test.js` (append).

- [ ] **Step 1: tests** — append to `backend/test/shopify.network.test.js`:

```js
const injected = (key) => ({
  key, shopDomain: `${key}.myshopify.com`, apiVersion: "2026-01", accessToken: "oauth-tenant-token",
});

test("an injected accessToken is used directly — no client-credentials exchange", async (t) => {
  let oauthCalls = 0, sentToken = null;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    if (String(url).includes("/oauth/access_token")) { oauthCalls += 1; return json({ access_token: "SHOULD-NOT-USE", expires_in: 86399 }); }
    sentToken = init.headers?.["X-Shopify-Access-Token"];
    return json({ data: { ok: true } });
  });
  const data = await shopifyGraphQL(injected("t10"), `{ ok }`);
  assert.deepEqual(data, { ok: true });
  assert.equal(oauthCalls, 0);
  assert.equal(sentToken, "oauth-tenant-token");
});

test("getAccessToken returns an injected token as-is", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("no network for injected tokens"); });
  assert.equal(await getAccessToken(injected("t11")), "oauth-tenant-token");
});

test("a 401 on an injected token fails clearly without a retry loop", async (t) => {
  let gql = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/oauth/access_token")) throw new Error("must not exchange");
    gql += 1;
    return json({}, 401);
  });
  await assert.rejects(() => shopifyGraphQL(injected("t12"), `{ ok }`), /token was rejected/i);
  assert.equal(gql, 1); // no retry — refreshing a static token can't help
});
```

- [ ] **Step 2:** `cd backend && node --test test/shopify.network.test.js` → the injected tests fail (token cached/exchanged path).
- [ ] **Step 3: implement** — in `shopify.js`, at the top of `getAccessToken`:

```js
export async function getAccessToken(store) {
  // Multi-tenant: a caller (cloud/) may inject the shop's OAuth token directly.
  if (store.accessToken) return store.accessToken;
  const cached = tokenCache.get(store.key);
```

And in `shopifyGraphQL`, replace the 401/403 block:

```js
    if (res.status === 401 || res.status === 403) {
      if (store.accessToken) {
        throw new Error(
          `Shopify token was rejected for "${store.key}" (HTTP ${res.status}). ` +
            "The shop's authorization may have been revoked — reinstall may be required."
        );
      }
      tokenCache.delete(store.key);
      if (!authRetried) { authRetried = true; continue; }
      throw new Error(
        `Authentication failed for store "${store.key}" (HTTP ${res.status}). ` +
          "Check the app's scopes and that it is installed on the store."
      );
    }
```

- [ ] **Step 4:** full `node --test` → **75 + 3 = 78** pass; the existing single-tenant token tests unchanged. **Step 5:** commit `backend: shopifyGraphQL accepts an injected OAuth token (cloud stage 1)`.

## Self-Review
**Spec coverage:** injected-token acceptance + no-exchange + no-cache + injected-401 behavior (Task 1); self-host path untouched (constraint verified by the pre-existing tests staying green). ✓
**Type consistency:** injected `store` needs only `{ key, shopDomain, apiVersion, accessToken }` — a superset-compatible shape the tenant layer will build; `getAccessToken`/`shopifyGraphQL` signatures unchanged. ✓
**No placeholders.** ✓
