// oauth.js — Shopify OAuth helpers (pure) + token exchange.
import { createHmac, timingSafeEqual } from "node:crypto";

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function isValidShopDomain(shop) {
  return typeof shop === "string" && SHOP_RE.test(shop);
}

export function installUrl(shop, state, { clientId, appUrl, scopes }) {
  const p = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: `${appUrl}/auth/callback`,
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
  return { accessToken: json.access_token, scopes: json.scope ?? null };
}
