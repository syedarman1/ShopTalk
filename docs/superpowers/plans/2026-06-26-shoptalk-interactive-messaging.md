# ShopTalk Interactive Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the demo's auto-playing messages with a recruiter-driven, interactive iMessage experience (tap a suggestion → typing indicator → reply → result cross-fade), built with Framer Motion.

**Architecture:** `useDemo` becomes an on-demand, cancelable timeline engine (no interval/auto-play). A pure `composeDemoState(history, current)` maps completed exchanges + the in-progress step's phase to the visible `{chat, typing, latest, activity}` and is unit-tested. ChatPanel/ResultPanel/ActivityLog gain Framer Motion (spring bubbles, typing dots, cross-fades). The air-gap and live-mode data flow are unchanged.

**Tech Stack:** Next.js 14 (App Router), React 18, Tailwind 3, lucide-react, **framer-motion (new)**. Pure logic in `.mjs`, tested with `node --test`.

## Global Constraints

- **No auto-play.** Nothing happens until the recruiter taps a suggestion chip. `useDemo` has no interval/timer-loop; only `runQuestion(id)` starts a (cancelable) phase sequence.
- **Phases (in order):** `"user"` → `"typing"` → `"reply"` → `"result"`. `phaseState`/`composeDemoState` is **pure** (no React/timers) and unit-tested.
- The dashboard-source shape gains a `typing` boolean: `{ activity, status, latest, stores, chat, typing, questions, runQuestion, mode }`. Both sources (demo + live) must return this exact shape (live: `typing:false`).
- **Air-gap preserved:** demo builds never call `useShopTalk`; `useDashboardSource` selection stays a module-load constant.
- **Tap-only:** suggestion chips send questions; the compose-bar text field is **decorative** (no free-text input).
- All demo data stays fake (no PII). `bg-sky-500` user bubbles stay blue (iMessage). Reuse existing Tailwind tokens + the `shopify`/`shopify-light` colors.
- **Reduced motion:** wrap the app in `<MotionConfig reducedMotion="user">` (Framer respects the OS setting globally) AND `useDemo` uses `useReducedMotion()` to skip the typing delay (jump straight to `result`).
- Pure logic lives in `.mjs`; React components import `.mjs` WITH the explicit extension. Run frontend tests with `npm test` (Node 22.5.1; the script globs `test/**/*.mjs`).
- Work only in `frontend/`. Run commands from `/Users/syedarman/Desktop/mockbase/frontend`.

## File Structure

**New:**
- `frontend/components/TypingIndicator.js` — three bouncing dots in a Poke-style bubble.
- `frontend/test/demoPhases.test.mjs` — tests for `composeDemoState`.

**Modified:**
- `frontend/lib/demoSequencer.mjs` — add `PHASES` + `composeDemoState`; remove the old `demoStateFor` (Task 3).
- `frontend/lib/useDemo.js` — rewrite to the on-demand timeline engine; add `typing`.
- `frontend/lib/useDashboardSource.js` — add `typing:false` to the live wrapper.
- `frontend/components/ChatPanel.js` — Framer bubbles + typing indicator + compose bar + auto-scroll + empty state.
- `frontend/components/ResultPanel.js` — `AnimatePresence` cross-fade on result change.
- `frontend/components/ActivityLog.js` — row enter animation.
- `frontend/app/page.js` — pass `typing` to ChatPanel; wrap in `<MotionConfig>`.
- `frontend/package.json` — add `framer-motion`.

**Deleted:**
- `frontend/test/demoSequencer.test.mjs` — obsolete once `demoStateFor` is removed (Task 3).

---

### Task 1: Pure phase reducer `composeDemoState`

**Files:**
- Modify: `frontend/lib/demoSequencer.mjs` (additive — keep `demoStateFor` for now)
- Test: `frontend/test/demoPhases.test.mjs` (new)

**Interfaces:**
- Produces: `PHASES = ["user","typing","reply","result"]`; `composeDemoState(history, current)` where `history: Array<{step, ts}>` (completed) and `current: {step, phase, ts} | null`, returning `{ chat: Array<{id,role,text}>, typing: boolean, latest: event|null, activity: Array<event & {id,timestamp}> }`.

- [ ] **Step 1: Write the failing test** — `frontend/test/demoPhases.test.mjs`

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeDemoState } from "../lib/demoSequencer.mjs";
import { DEMO_SCRIPT } from "../lib/demoData.mjs";

const A = DEMO_SCRIPT[0], B = DEMO_SCRIPT[1];

test("empty: nothing shown", () => {
  const s = composeDemoState([], null);
  assert.deepEqual(s.chat, []);
  assert.equal(s.typing, false);
  assert.equal(s.latest, null);
  assert.deepEqual(s.activity, []);
});

test("phase 'user': only the question bubble, no typing, no result yet", () => {
  const s = composeDemoState([], { step: A, phase: "user", ts: 1 });
  assert.equal(s.chat.length, 1);
  assert.equal(s.chat[0].role, "user");
  assert.equal(s.typing, false);
  assert.equal(s.latest, null);
  assert.equal(s.activity.length, 0);
});

test("phase 'typing': question + typing flag, no reply/result", () => {
  const s = composeDemoState([], { step: A, phase: "typing", ts: 1 });
  assert.equal(s.chat.length, 1);
  assert.equal(s.typing, true);
  assert.equal(s.latest, null);
});

test("phase 'reply': question + reply, typing off, result not landed", () => {
  const s = composeDemoState([], { step: A, phase: "reply", ts: 1 });
  assert.equal(s.chat.length, 2);
  assert.equal(s.chat[1].role, "poke");
  assert.equal(s.typing, false);
  assert.equal(s.latest, null);
  assert.equal(s.activity.length, 0);
});

test("phase 'result': reply shown, latest set, activity row added", () => {
  const s = composeDemoState([], { step: A, phase: "result", ts: 5 });
  assert.equal(s.chat.length, 2);
  assert.equal(s.latest, A.event);
  assert.equal(s.activity.length, 1);
  assert.equal(s.activity[0].timestamp, 5);
});

test("history + current: prior exchange persists; newest activity first; unique keys", () => {
  const s = composeDemoState([{ step: A, ts: 1 }], { step: B, phase: "result", ts: 2 });
  assert.equal(s.chat.length, 4);
  assert.equal(s.latest, B.event);
  assert.equal(s.activity[0].type, B.event.type);
  assert.equal(s.activity[1].type, A.event.type);
  const ids = s.chat.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("while current is mid-flight, latest stays the last completed step's event", () => {
  const s = composeDemoState([{ step: A, ts: 1 }], { step: B, phase: "typing", ts: 2 });
  assert.equal(s.latest, A.event);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npm test`
Expected: the new `demoPhases` tests FAIL (`composeDemoState` is not exported). Existing tests still pass.

- [ ] **Step 3: Add `PHASES` + `composeDemoState` to `frontend/lib/demoSequencer.mjs`**

Append to the file (keep the existing `demoStateFor` for now):

```javascript

export const PHASES = ["user", "typing", "reply", "result"];

function chatForStep(step, i, includeReply) {
  const msgs = [{ id: `${step.id}-q-${i}`, role: "user", text: step.question }];
  if (includeReply) msgs.push({ id: `${step.id}-a-${i}`, role: "poke", text: step.reply });
  return msgs;
}

// Compose visible demo state from completed history + the in-progress current step.
// history: Array<{ step, ts }> (completed exchanges). current: { step, phase, ts } | null.
export function composeDemoState(history, current) {
  const chat = [];
  const activity = [];
  history.forEach(({ step, ts }, i) => {
    chat.push(...chatForStep(step, i, true));
    activity.unshift({ id: `${step.id}-${i}`, ...step.event, timestamp: ts });
  });
  let typing = false;
  let latest = history.length ? history[history.length - 1].step.event : null;
  if (current) {
    const i = history.length;
    const { step, phase, ts } = current;
    chat.push(...chatForStep(step, i, phase === "reply" || phase === "result"));
    typing = phase === "typing";
    if (phase === "result") {
      latest = step.event;
      activity.unshift({ id: `${step.id}-${i}`, ...step.event, timestamp: ts });
    }
  }
  return { chat, typing, latest, activity };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS — the 7 `demoPhases` tests plus all pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/demoSequencer.mjs frontend/test/demoPhases.test.mjs
git commit -m "Add pure composeDemoState phase reducer for interactive demo"
```

---

### Task 2: Add framer-motion dependency

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Add the dependency** — in `frontend/package.json`, add to `"dependencies"` (alphabetical, before `lucide-react`):

```json
    "framer-motion": "^11.11.0",
```

- [ ] **Step 2: Install**

Run: `cd frontend && npm install`
Expected: `framer-motion` added; lockfile updated; no errors.

- [ ] **Step 3: Verify the build still passes**

Run: `cd frontend && npm run build`
Expected: build succeeds (dep present, nothing imports it yet).

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "Add framer-motion dependency"
```

---

### Task 3: On-demand timeline engine (`useDemo` rewrite) + source shape + cleanup

**Files:**
- Modify: `frontend/lib/useDemo.js` (full rewrite), `frontend/lib/useDashboardSource.js`, `frontend/lib/demoSequencer.mjs` (remove `demoStateFor`)
- Delete: `frontend/test/demoSequencer.test.mjs`

**Interfaces:**
- Consumes: `composeDemoState`, `DEMO_SCRIPT`, `DEMO_STORES` (Task 1 / existing); `useReducedMotion` (framer).
- Produces: `useDemo()` returning `{ activity, status:"live", latest, stores, chat, typing, questions, runQuestion, mode:"demo" }`. `runQuestion(id)` starts a cancelable phase sequence; no auto-play.

- [ ] **Step 1: Replace `frontend/lib/useDemo.js`**

```javascript
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { DEMO_SCRIPT, DEMO_STORES } from "./demoData.mjs";
import { composeDemoState } from "./demoSequencer.mjs";

// ms after the question bubble that each phase fires.
const PHASE_DELAYS = { typing: 600, reply: 1800, result: 2200 };

export function useDemo() {
  const [history, setHistory] = useState([]); // [{ step, ts }] completed exchanges
  const [current, setCurrent] = useState(null); // { step, phase, ts } | null
  const currentRef = useRef(null); // mirror of `current` for reads inside runQuestion
  const timersRef = useRef([]);
  const reduce = useReducedMotion();

  const setPhase = useCallback((next) => {
    currentRef.current = next;
    setCurrent(next);
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  const runQuestion = useCallback(
    (id) => {
      const step = DEMO_SCRIPT.find((s) => s.id === id);
      if (!step) return;
      clearTimers();
      const ts = Date.now();
      // Commit any prior in-progress exchange to history before starting the new one.
      const prev = currentRef.current;
      if (prev) {
        setHistory((h) => [...h, { step: prev.step, ts: prev.ts }].slice(-DEMO_SCRIPT.length));
      }
      if (reduce) {
        setPhase({ step, phase: "result", ts }); // no typing delay for reduced motion
        return;
      }
      setPhase({ step, phase: "user", ts });
      timersRef.current = [
        setTimeout(() => setPhase({ step, phase: "typing", ts }), PHASE_DELAYS.typing),
        setTimeout(() => setPhase({ step, phase: "reply", ts }), PHASE_DELAYS.reply),
        setTimeout(() => setPhase({ step, phase: "result", ts }), PHASE_DELAYS.result),
      ];
    },
    [clearTimers, reduce, setPhase]
  );

  useEffect(() => clearTimers, [clearTimers]); // clear timers on unmount

  const { chat, typing, latest, activity } = composeDemoState(history, current);
  return {
    activity,
    status: "live",
    latest,
    stores: DEMO_STORES,
    chat,
    typing,
    questions: DEMO_SCRIPT.map((s) => ({ id: s.id, question: s.question })),
    runQuestion,
    mode: "demo",
  };
}
```

- [ ] **Step 2: Add `typing:false` to the live wrapper** — in `frontend/lib/useDashboardSource.js`, change the `useLiveSource` return line from:

```javascript
  return { ...s, chat: [], questions: [], runQuestion: () => {}, mode: "live" };
```
to:
```javascript
  return { ...s, chat: [], typing: false, questions: [], runQuestion: () => {}, mode: "live" };
```

- [ ] **Step 3: Remove the obsolete `demoStateFor`** — in `frontend/lib/demoSequencer.mjs`, delete the `demoStateFor` function (the original export at the top). Keep `chatForStep`, `PHASES`, and `composeDemoState`. Then delete the obsolete test file:

```bash
rm frontend/test/demoSequencer.test.mjs
```

- [ ] **Step 4: Verify tests + build**

Run: `cd frontend && npm test && npm run build`
Expected: tests pass (`demoPhases`, `sparkline`, `demoData`; no `demoStateFor` references remain) and the production build succeeds in demo mode.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/useDemo.js frontend/lib/useDashboardSource.js frontend/lib/demoSequencer.mjs
git rm frontend/test/demoSequencer.test.mjs
git commit -m "Rewrite useDemo as on-demand timeline engine; add typing; drop demoStateFor"
```

---

### Task 4: TypingIndicator + ChatPanel rewrite + page wiring

**Files:**
- Create: `frontend/components/TypingIndicator.js`
- Modify: `frontend/components/ChatPanel.js` (full rewrite), `frontend/app/page.js`

**Interfaces:**
- Consumes: `cn`; `motion`, `AnimatePresence`, `MotionConfig` (framer); `typing` from the source.
- Produces: `<ChatPanel chat typing questions runQuestion />`.

- [ ] **Step 1: Write `frontend/components/TypingIndicator.js`**

```javascript
"use client";
import { motion } from "framer-motion";

export default function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-muted px-3 py-2.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground"
            animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `frontend/components/ChatPanel.js`**

```javascript
"use client";
import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../lib/utils";
import TypingIndicator from "./TypingIndicator";

export default function ChatPanel({ chat, typing, questions, runQuestion }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, typing]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-1 pb-3 text-sm text-muted-foreground">
        <span className="text-base">📱</span> iMessage · Poke
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-auto px-1">
        {chat.length === 0 && !typing && (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            👋 Tap a question below to ask Northwind Supply Co.
          </div>
        )}
        <AnimatePresence initial={false}>
          {chat.map((m) => (
            <motion.div
              key={m.id}
              layout
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
              className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-2 text-[13px] leading-snug",
                  m.role === "user"
                    ? "rounded-br-sm bg-sky-500 text-white"
                    : "rounded-bl-sm bg-muted text-foreground"
                )}
              >
                {m.text}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {typing && <TypingIndicator />}
      </div>

      <div className="mt-3 px-1">
        <div className="mb-2 flex flex-wrap gap-2">
          {questions.map((q) => (
            <button
              key={q.id}
              onClick={() => runQuestion(q.id)}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground/90 hover:bg-muted hover:border-shopify/50 hover:text-shopify-light"
            >
              {q.question}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2">
          <span className="flex-1 text-sm text-muted-foreground">Message…</span>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-xs text-white">↑</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire `typing` + MotionConfig in `frontend/app/page.js`**

Add the import:
```javascript
import { MotionConfig } from "framer-motion";
```
Add `typing` to the destructure:
```javascript
  const { activity, status, latest, stores, chat, typing, questions, runQuestion, mode } =
    useDashboardSource();
```
Pass `typing` to ChatPanel (demo branch):
```javascript
            <ChatPanel chat={chat} typing={typing} questions={questions} runQuestion={runQuestion} />
```
Wrap the whole returned tree in `<MotionConfig reducedMotion="user">`: change `return (` so the outermost element is `<MotionConfig reducedMotion="user">` containing the existing `<div className="flex h-screen flex-col">…</div>`, and close it with `</MotionConfig>`.

- [ ] **Step 4: Build, then screenshot the idle state (fresh port)**

```bash
cd frontend && npm run build && PORT=3102 npm run start &
SP=$!
sleep 4
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --screenshot=/tmp/shoptalk-interactive-idle.png --window-size=1440,900 --virtual-time-budget=4000 http://localhost:3102
kill "$SP" 2>/dev/null
```
- [ ] **Step 5: Read `/tmp/shoptalk-interactive-idle.png` and LOOK at it.** Confirm: the chat shows the **empty invite** ("👋 Tap a question…"), the **suggestion chips**, and the **decorative compose bar** ("Message…" + ↑); the Result Panel shows its empty prompt; the header badge/dot are intact. (Headless can't tap, so the typing→reply choreography is NOT in this shot — it's covered by Task 1's unit tests + manual click. A blank page or a crash IS a failure.)

- [ ] **Step 6: Commit**

```bash
git add frontend/components/TypingIndicator.js frontend/components/ChatPanel.js frontend/app/page.js
git commit -m "Interactive ChatPanel: motion bubbles, typing indicator, compose bar, auto-scroll"
```

---

### Task 5: Result/Activity transitions + full verification

**Files:**
- Modify: `frontend/components/ResultPanel.js`, `frontend/components/ActivityLog.js`

**Interfaces:**
- Consumes: `motion`, `AnimatePresence` (framer). No prop/shape changes — purely visual.

- [ ] **Step 1: Wrap the result in a cross-fade — `frontend/components/ResultPanel.js`**

Add at the top (after the existing lucide import):
```javascript
import { motion, AnimatePresence } from "framer-motion";
```
Rename the current default-export function `ResultPanel` to a plain helper `function renderResult(latest) { ... }` — i.e. keep its entire body identical (the `if (!latest) return <Empty/>` and all the `latest.type` branches) but change its declaration from `export default function ResultPanel({ latest })` to `function renderResult(latest)` and replace its first line `if (!latest) return <Empty />;\n  const d = latest.detail;` — keep using `latest`/`d` exactly as before. Then add the new default export that wraps it:

```javascript
export default function ResultPanel({ latest }) {
  const key = latest ? `${latest.tool}:${latest.message}` : "empty";
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={key}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25 }}
        className="h-full"
      >
        {renderResult(latest)}
      </motion.div>
    </AnimatePresence>
  );
}
```
(Net: the body that used to be in `ResultPanel({latest})` now lives in `renderResult(latest)` unchanged; the new `ResultPanel` wraps it with a keyed cross-fade so changing results animate instead of snapping.)

- [ ] **Step 2: Animate activity rows — `frontend/components/ActivityLog.js`**

Add at the top (after the lucide import):
```javascript
import { motion, AnimatePresence } from "framer-motion";
```
Wrap the list items in `AnimatePresence` and make each row a `motion.li`. Replace the `<ul>...</ul>` block with:
```javascript
    <ul className="space-y-0.5">
      <AnimatePresence initial={false}>
        {activity.map((event) => {
          const meta = META[event.type] ?? { icon: Radio, color: "text-muted-foreground" };
          const Icon = meta.icon;
          return (
            <motion.li
              key={event.id}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/40"
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.color)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {event.tool && (
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{event.tool}</code>
                  )}
                  {event.store && <span className="text-xs text-muted-foreground">→ {event.store}</span>}
                </div>
                <p className="mt-0.5 truncate text-[13px] text-foreground/90">{event.message}</p>
              </div>
              <time className="font-mono text-[10px] text-muted-foreground">{formatTime(event.timestamp)}</time>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
```
(The `formatTime` local helper at the bottom of the file stays unchanged.)

- [ ] **Step 3: Full verification**

Run: `cd frontend && npm test && npm run build`
Expected: all unit tests pass and the production build succeeds in demo mode.

- [ ] **Step 4: Screenshot (fresh port) and look**

```bash
cd frontend && PORT=3103 npm run start &
SP=$!
sleep 4
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --screenshot=/tmp/shoptalk-interactive-final.png --window-size=1440,900 --virtual-time-budget=4000 http://localhost:3103
kill "$SP" 2>/dev/null
```
Read `/tmp/shoptalk-interactive-final.png` and confirm the idle interactive layout renders cleanly (empty invite + chips + compose bar; result panel empty prompt; live activity empty). Choreography (typing→reply→cross-fade) is covered by unit tests + manual click in a real browser.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ResultPanel.js frontend/components/ActivityLog.js
git commit -m "Animate result cross-fade and activity row entrances (framer-motion)"
```

---

## Self-Review Notes

- **Spec coverage:** no auto-play (Task 3 — `useDemo` has no interval) ✓; tap-to-send chips + decorative compose bar (Task 4) ✓; phases user→typing→reply→result as a pure tested reducer (Task 1) ✓; choreography timings + cancelation + commit-to-history (Task 3 `runQuestion`/`PHASE_DELAYS`) ✓; spring bubbles + typing indicator + auto-scroll (Task 4) ✓; result cross-fade + activity entrance (Task 5) ✓; framer-motion dep (Task 2) ✓; reduced motion via `MotionConfig reducedMotion="user"` + `useReducedMotion` skip (Tasks 3–4, constraints) ✓; air-gap unchanged (`useDashboardSource` module-load select untouched; live gets `typing:false`) ✓; live data flow unchanged (only visual transitions added) ✓.
- **No placeholders:** every code step is complete; the one prose edit (Task 5 Step 1 `renderResult` extraction) names the exact transformation with the wrapper code given in full.
- **Shape consistency:** `composeDemoState` returns `{chat,typing,latest,activity}` (Task 1); `useDemo` spreads those + `runQuestion/questions/stores/status/mode` and `useLiveSource` adds `typing:false` (Task 3) → both match what `page.js` destructures and passes (Task 4). `current:{step,phase,ts}` produced by `useDemo` matches `composeDemoState`'s expected `current`. Phase strings (`user/typing/reply/result`) match between `PHASE_DELAYS`/`runQuestion` (Task 3) and `composeDemoState` (Task 1).
- **Verification honesty:** headless screenshots show the idle interactive state only (no tap); the choreography is asserted by `demoPhases.test.mjs` and confirmed by manual click — stated in Tasks 4–5 so reviewers don't expect a typing screenshot.
- **Migration:** `demoStateFor` + `demoSequencer.test.mjs` removed in Task 3 once `useDemo` no longer uses them; `demoData.mjs` reused unchanged.
