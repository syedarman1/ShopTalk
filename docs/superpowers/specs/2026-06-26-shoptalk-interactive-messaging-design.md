# ShopTalk Demo — Interactive Smooth Messaging — Design

**Date:** 2026-06-26
**Status:** Approved (design); pending implementation plan
**Scope:** Frontend only (`frontend/`), demo mode. Backend untouched; the live dashboard's data flow untouched (it gains only purely-visual result/activity transitions).

## Summary

Replace the demo's **auto-playing** message loop with a **recruiter-driven, interactive** experience that feels like real iMessage. The recruiter taps a suggested question; their bubble sends, a "Poke is typing…" indicator appears, then Poke's reply springs in, and the dashboard cross-fades to the result. Built with **Framer Motion**.

This supersedes the auto-play behavior from the demo-mode feature (`useDemo` interval loop): there is **no auto-play** — nothing happens until the recruiter taps.

## Why

The current demo auto-fills messages on a timer, which reads as a passive movie and is less convincing than letting a recruiter *drive* it. Tap-to-send is more honest (they actually use it) and more engaging. Smooth, choreographed messaging (typing indicator, spring entrances) makes the "text your store" hook land.

## Goals

- **No auto-play.** The demo is idle until the recruiter taps a suggestion.
- Tap a suggested question → full iMessage choreography plays for that question.
- Smooth, physical motion (spring bubble entrances, typing indicator, cross-fading results) via Framer Motion.
- Faithful: every answer is canned sample data shaped exactly like the real tools.
- Air-gapped demo preserved; live dashboard behavior unchanged (only visual transitions added).
- Respect `prefers-reduced-motion`.

## Non-goals

- No free-text input — suggestions are **tap-only** (every response is faithful canned data; no unanswerable input).
- No auto-play / timed loop.
- No backend changes; no change to live-mode data flow.
- No full visual redesign beyond the messaging/motion.

## Interaction model

- The chat opens in an **inviting empty state** (e.g. "👋 Tap a question to ask Northwind Supply Co.") with an **iMessage-style compose bar** at the bottom and tappable **suggestion chips** above it (the four sample questions).
- The compose-bar text field is **decorative** (placeholder "Message", a send glyph) — it anchors the iMessage look; input happens via the chips. (Stated explicitly to avoid the unanswerable-free-text problem.)
- Tapping a chip "sends" that question and runs its choreography. Chips remain available afterward so the recruiter can ask more.
- The Result Panel shows its empty prompt until the first question's result lands.
- Tapping another chip while a choreography is mid-play **cancels** the in-flight timeline and starts the new one cleanly.

## Choreography (per tap)

Ordered phases with approximate delays (tunable):
1. `t0` — user's question bubble springs in (right-aligned, `bg-sky-500`).
2. `+~600ms` — "Poke is typing…" indicator (three bouncing dots, left-aligned) appears.
3. `+~1.2s` — typing indicator hides; Poke's reply bubble springs in (left, `bg-muted`).
4. `+~400ms` — Result Panel cross-fades to the new result **and** a Live Activity row slides in.

The chat **auto-scrolls** to the newest bubble at each phase. All timings collapse to instant when `prefers-reduced-motion` is set.

## Architecture

`useDemo` changes from an interval-driven auto-loop to an **on-demand timeline engine**:

- It exposes `runQuestion(id)` which starts a cancelable phase sequence (USER → TYPING → REPLY → RESULT) via timed transitions (`setTimeout` chain or a phase counter on a timer), tracked in React state. A new tap cancels any pending timers before starting.
- The **pure, unit-tested core** is a function `phaseState(step, phase)` → `{ chat, typing, latest, activity }` describing exactly what is visible at a given phase of a given step. The timers/cancellation live in the hook; the phase→state mapping is pure and tested with `node --test`.
- `runQuestion` accumulates **completed** exchanges (prior Q&A stay in the chat history and prior activity rows persist), with a sensible cap. The rendered `chat`/`activity`/`latest` the hook returns = the accumulated completed exchanges **plus** the current in-progress step's `phaseState(step, phase)`; the hook composes these two. `phaseState` itself is pure and concerns only the current step.
- `useDashboardSource` and the air-gap are unchanged (demo build never calls `useShopTalk`). `status`, `stores`, `questions` continue to be provided.

## Components

- `frontend/components/ChatPanel.js` — rewritten: `motion.div` bubbles with spring entrance inside `AnimatePresence`; the `TypingIndicator`; the iMessage compose bar (decorative input + send glyph) with the suggestion chips; **auto-scroll** to newest (a ref'd scroll container, scrolled on chat/typing change).
- `frontend/components/TypingIndicator.js` (new) — three dots with a staggered bounce (Framer or CSS keyframes), styled as a left/grey bubble.
- `frontend/components/ResultPanel.js` — wrap the rendered result in `AnimatePresence` keyed on the current result identity so results **cross-fade/slide** instead of snapping. (Applies in both modes — harmless polish for the live dashboard.)
- `frontend/components/ActivityLog.js` — rows animate in at the top (Framer `layout` + enter variant).

## Dependency

Add `framer-motion` to `frontend/package.json` dependencies. Demo-only choreography; the result/activity transitions also use it in live mode (acceptable — it's a standard, tree-shakeable lib).

## Accessibility

Use Framer's `useReducedMotion()` (or a CSS `prefers-reduced-motion` media query) to disable spring/entrance/typing delays — content appears immediately, no motion — for users who opt out.

## Testing

- Unit-test the pure `phaseState(step, phase)` mapping (`node --test`, `.mjs`): each phase shows the right chat messages, the typing flag at the typing phase, `latest` only after the RESULT phase, and the activity row appended at RESULT.
- Unit-test cancellation/accumulation logic to the extent it's pure (e.g. a reducer over a list of completed exchanges).
- Production build (`npm run build`) must pass.
- Visual check via headless screenshot (mid-typing and post-reply states).

## Replaces / migrates

- The auto-play interval and the `slice(-LEN)` rolling window in `useDemo` are removed.
- The existing `demoSequencer` auto-play tests are replaced by `phaseState` phase tests. `demoData.mjs` (the sample store + scripted Q&A) is reused largely as-is; each step may gain nothing new beyond what choreography needs (question, reply, event).

## Out of scope (future)
- Free-text input with fuzzy matching.
- A README GIF of the interactive demo.
