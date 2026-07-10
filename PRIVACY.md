# ShopTalk — Privacy Policy

_Last updated: 2026-07-10 · Draft for review — confirm the business name, contact,
and jurisdiction before publishing._

ShopTalk ("the App", "we") lets a Shopify merchant ask about and manage their own
store in plain language through an AI assistant (such as Poke). This policy
explains what data the App accesses, what it stores, and how it is handled.

## Who this covers

Merchants who install ShopTalk on their Shopify store, and the store data the App
reads on their behalf.

## What data the App accesses

At the merchant's request (each time they send a message through their connected
AI assistant), the App reads from the Shopify Admin API:

- **Orders** (including customer name, email, and order contents), refunds, and
  chargeback/dispute records
- **Products, inventory, and locations**
- **Customers** (name, email, phone, order history)
- **Shop details, payouts, and balance** (where the merchant has granted the
  relevant scopes)

With the merchant's explicit, per-action confirmation, the App can also perform
two **write** actions: cancel-and-refund an order, and adjust inventory. Neither
executes without the merchant replying with a one-time confirmation code.

## What the App stores

The App stores the **minimum** needed to connect a store:

- The store's **`.myshopify.com` domain**
- The store's Shopify **access token, encrypted at rest** (AES-256-GCM)
- Per-merchant API credentials used to authenticate the merchant's assistant

The App does **not** maintain its own copy of your customers or orders. Store
data is fetched from Shopify on demand to answer a specific request, passed to the
merchant's AI assistant to form a reply, and not persisted by the App afterward.

## How data is used

Solely to fulfill the merchant's own requests ("how much did I sell yesterday?",
"any open chargebacks?", "cancel order #1042"). We do **not** sell data, use it
for advertising, or use it to train models.

## Who data is shared with (sub-processors)

- **Shopify** — the source of the store data (per Shopify's terms).
- **The merchant's AI assistant provider** (e.g. The Interaction Company, maker of
  Poke) — the merchant chooses and connects this; store data flows through it to
  produce replies.
- **Hosting provider** (Railway) — runs the App; sees only encrypted tokens and
  in-transit request data.

We share data only as needed to operate the service, and only for stores whose
owners have installed the App.

## Retention and deletion

- The encrypted token and credentials are kept until the store **uninstalls** the
  App or requests deletion, at which point they are **erased**.
- The App honors Shopify's mandatory privacy webhooks:
  **`customers/data_request`**, **`customers/redact`**, and **`shop/redact`** —
  and the **`app/uninstalled`** webhook, which wipes the stored token.
- Because the App does not retain customer records, a `customers/redact` request
  requires no additional deletion beyond confirming none is held.

## Security

Tokens are encrypted at rest; the App's endpoints require a per-merchant secret;
credentials live only in environment variables and are never committed to source
control. No security is perfect, but access to store data is gated and minimized.

## Your rights

Merchants (and their customers, via the merchant) may request access to, or
deletion of, data associated with a store. Contact us and we will respond
promptly.

## Contact

**syedarman2003@gmail.com**

## Changes

We may update this policy; the "Last updated" date reflects the latest revision.
