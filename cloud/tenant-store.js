// tenant-store.js — turn a stored shop row into the injected-token `store`
// object backend/shopify.js accepts (Stage 1 shape).
import { decryptToken } from "./tenants.js";

export function tenantStore(shopRow) {
  return {
    key: `shop:${shopRow.id}`,
    shopDomain: shopRow.shop_domain,
    apiVersion: process.env.SHOPIFY_API_VERSION || "2026-04",
    accessToken: decryptToken(shopRow),
  };
}
