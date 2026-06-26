# ShopTalk Demo Mode — Design

**Date:** 2026-06-26
**Status:** Approved (design); pending implementation plan
**Scope:** Frontend only (`frontend/`). The backend and the real dashboard's live behavior are untouched.

## Summary

Add a self-contained **demo mode** to the ShopTalk dashboard so a recruiter (or
anyone curious) can open a public URL and immediately *see how it works* — a
simulated "text Poke → get an answer" experience with realistic **mock data** —
without any backend, token, real store, or real customer data.

The same dashboard codebase runs in two modes:
- **Demo mode (public):** fully offline, mock data, air-gapped. This is what gets
  deployed for recruiters.
- **Live mode (private, local-only):** the existing dashboard connected to the
  real backend over SSE, showing the owner's real store. Never deployed publicly.

## Why

A recruiter who opens the deployed dashboard today sees an empty, token-gated
page ("Connecting… 0 stores" / "Text Poke a question…") — nothing happens unless
the owner texts Poke, and the event stream is (correctly) token-gated. Demo mode
turns that dead end into an instant, self-explanatory showcase. It is also a
**privacy win**: the public artifact never touches the real store, so the owner's
real customers/sales can never render on a recruiter-facing page.

Clarification baked into the design: the owner's day-to-day phone usage
(iMessage ↔ Poke ↔ MCP backend ↔ Shopify) involves **no frontend at all**. The
dashboard is an optional, separate web view. Demo mode only concerns that web view.

## Goals

- Open the public demo URL → see the product working in seconds, no setup.
- Faithfully convey the "text your store, get an answer" story (the actual hook).
- Hybrid interaction: auto-plays on load, and recruiters can click sample questions.
- Polished, product-grade visuals.
- Air-gapped: the demo bundle cannot reach a backend or leak anything.
- One codebase (DRY); the real dashboard's live behavior is unchanged.

## Non-goals

- No changes to the backend or to live-mode data flow.
- No full visual redesign of the app's language (refine the existing clean dark theme, don't replace it).
- No second/duplicate frontend project — demo lives inside the existing `frontend/`.

## Architecture

### Mode selection — demo by default (safety inversion)

A single env flag selects the mode, and **demo is the default**. Live mode
requires an explicit opt-in:

- `NEXT_PUBLIC_LIVE_MODE=true` → live mode (connect to the real backend over SSE).
- Anything else (unset/false) → demo mode (offline mock data).

This inverts the risk: the dangerous mode (real store data) only happens when the
owner *deliberately* opts in locally. An accidental public deploy shows mock data,
never the real store.

### The source switch

A thin `lib/useDashboardSource.js` hook returns either the real or the demo
source based on the flag, both exposing the **same dashboard shape** so the
result/activity components are mode-agnostic:

```
useDashboardSource() -> { activity, status, latest, stores, chat, questions, runQuestion, mode }
```

- **Live mode:** delegates to the existing `useShopTalk()` (`{ activity, status, latest, stores }`); `chat`/`questions` are empty and `runQuestion` is a no-op; `mode: "live"`.
- **Demo mode:** delegates to a new `useDemo()` which produces the same four fields from mock data PLUS `chat` (iMessage messages), `questions` (clickable samples), and `runQuestion(id)`; `mode: "demo"`. It never opens an `EventSource` — the network path is not reached.

`app/page.js` renders the **story layout** (Chat + Result + Activity) when `mode === "demo"`, and the existing two-column layout when `mode === "live"`.

## Mock data (`lib/demoData.js`)

A believable sample store — **"Northwind Supply Co."** (a lifestyle/apparel brand;
trivially renamable). All data is fake (e.g. emails like `ada@example.com`) — no
real PII. Shaped **exactly** like the real tools' outputs so the demo is faithful:

- `sales` for `today`/`7d`/`30d`: totals, order count, AOV, currency, plus a
  per-day `series` for the sparkline.
- `orders`: ~6 (name, customer, total, currency, fulfillmentStatus).
- `products`: ~6 (title, price, currency, totalInventory, status).
- `customers`: ~5 (name, email, orders, amountSpent, currency).
- `stores`: 1–2 summaries (key, label, shopDomain).

Plus a **scripted sequence**: an ordered list of sample questions, each mapping to
a chat exchange (the user "text" + Poke's plain-English reply) and the dashboard
result it produces (a broadcast-shaped event + the latest result payload).

## Experience (hybrid auto-play + clickable)

- **On load:** auto-play steps through the scripted sequence. For each step: the
  question types into the chat panel (typing indicator), Poke "replies", and the
  matching result animates into the Result Panel while a row slides into Live
  Activity.
- **Clickable:** a "Try ▸" chip row of sample questions; clicking one pauses
  auto-play and runs that step immediately.
- The sequencer logic is a **pure reducer** (`step index → { chat, latest,
  activity }`) so it is unit-testable without timers/DOM.

## Layout & visual polish (story mode, polished look)

- **Chat panel (`components/ChatPanel.js`)** — iMessage-style: blue outgoing
  bubbles (right), grey Poke bubbles (left), animated typing dots, timestamps.
- **Result Panel** — refined cards; the sales view gains a small inline **SVG
  sparkline** (`components/Sparkline.js`) from the per-day `series`; results
  fade/slide in on change.
- **Live Activity** — rows slide in at the top with tool name + store.
- **Header** — a subtle **"Demo · sample data"** badge in demo mode; refined
  typography/spacing; keep the dark theme.

## Files

**New (`frontend/`):**
- `lib/demoData.js` — sample store + scripted sequence.
- `lib/useDemo.js` — demo source hook (auto-play, `runQuestion`, returns the shape + chat/questions).
- `lib/useDashboardSource.js` — the live-vs-demo switch.
- `components/ChatPanel.js` — iMessage mock.
- `components/Sparkline.js` — inline SVG sparkline.

**Modified:**
- `app/page.js` — branch to story layout in demo mode.
- `components/Header.js` — "Demo · sample data" badge in demo mode.
- `components/ResultPanel.js` — sparkline in the sales view (rendered **only when a per-day `series` is present**, so live mode — whose `get_sales` returns no series — is unaffected) + entrance animation; otherwise reused unchanged.
- `lib/useShopTalk.js` — unchanged behavior; consumed by `useDashboardSource` in live mode.
- `.env.example` — document `NEXT_PUBLIC_LIVE_MODE` (and that omitting it = demo).

## Deploy & safety

- Public demo: deploy `frontend/` to Vercel with `NEXT_PUBLIC_LIVE_MODE` unset → demo mode. No token, no backend, no real data; the bundle never reaches a network data path.
- Live dashboard: run locally with `NEXT_PUBLIC_LIVE_MODE=true` (+ `NEXT_PUBLIC_API_BASE`, `NEXT_PUBLIC_DASHBOARD_TOKEN`). Never deployed publicly.
- README: add a "Live demo" link noting it's sample data, and clarify the real dashboard is local-only.

## Testing

- Unit-test the **demo sequencer** (pure reducer): given a step index, asserts the
  produced chat/latest/activity.
- Unit-test that `demoData` payloads match the field shapes `ResultPanel` renders
  (orders/products/customers/sales/stores), preventing demo/real drift.
- Production build (`npm run build`) must pass.
- Visual check via headless screenshot of the demo page.

## Future (out of scope here)
- A proper read-only dashboard token for a *publicly deployed live* dashboard
  (currently live mode is local-only, so not needed).
- A short README GIF of the real product.
