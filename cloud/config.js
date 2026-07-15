// config.js — app credentials + URLs from env. The Client Secret and encryption
// key are env-only, never committed.
export const config = {
  clientId: process.env.SHOPIFY_CLOUD_CLIENT_ID || "",
  clientSecret: process.env.SHOPIFY_CLOUD_CLIENT_SECRET || "",
  appUrl: (process.env.SHOPIFY_CLOUD_APP_URL || "http://localhost:4700").replace(/\/+$/, ""),
  scopes: process.env.SHOPIFY_CLOUD_SCOPES ||
    "read_orders,read_products,read_customers,read_inventory,read_locations,write_orders,write_inventory",
};
