// oauth.js — Shopify OAuth helpers (pure) + token exchange.
import { createHmac, timingSafeEqual } from "node:crypto";

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function isValidShopDomain(shop) {
  return typeof shop === "string" && SHOP_RE.test(shop);
}

export function installUrl(shop, state, { clientId, appUrl, scopes }) {
  // Strip any trailing slash so a misconfigured APP_URL can't produce a
  // "//auth/callback" that mismatches the app's registered redirect URL.
  const base = String(appUrl).replace(/\/+$/, "");
  const p = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: `${base}/auth/callback`,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${p.toString()}`;
}

function safeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// Shopify signs OAuth query strings: sort params (minus hmac/signature), join
// k=v with &, HMAC-SHA256(hex) with the app secret.
export function verifyQueryHmac(secret, query) {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;
  const msg = Object.keys(rest).sort()
    .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(",") : rest[k]}`)
    .join("&");
  const digest = createHmac("sha256", secret).update(msg).digest("hex");
  return safeEq(digest, hmac);
}

// Webhooks: base64 HMAC-SHA256 of the raw body, in X-Shopify-Hmac-Sha256.
export function verifyWebhookHmac(secret, rawBody, headerB64) {
  if (!headerB64) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest("base64");
  return safeEq(digest, headerB64);
}

export async function exchangeCodeForToken(shop, code, { clientId, clientSecret }) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!res.ok) throw new Error(`Token exchange failed for ${shop} (HTTP ${res.status}).`);
  const json = await res.json();
  if (!json.access_token) throw new Error(`No access_token returned for ${shop}.`);
  // New public apps (post 2026-04-01) receive EXPIRING offline tokens: an access
  // token plus a refresh_token + expires_in. Older/self-host tokens omit these —
  // capture whatever Shopify sends and let callers handle both shapes.
  return {
    accessToken: json.access_token,
    scopes: json.scope ?? null,
    refreshToken: json.refresh_token ?? null,
    expiresIn: json.expires_in ?? null,
  };
}

// Exchange a stored refresh token for a fresh access token
// (grant_type=refresh_token). Shopify rotates the refresh token, so persist the
// returned one; fall back to the supplied token if none comes back.
export async function refreshAccessToken(shop, refreshToken, { clientId, clientSecret }) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed for ${shop} (HTTP ${res.status}).`);
  const json = await res.json();
  if (!json.access_token) throw new Error(`No access_token returned on refresh for ${shop}.`);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresIn: json.expires_in ?? null,
  };
}
