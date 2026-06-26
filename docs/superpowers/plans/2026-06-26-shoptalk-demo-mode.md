# ShopTalk Demo Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an offline, mock-data "demo mode" to the ShopTalk dashboard (in `frontend/`) so recruiters can open a public URL and instantly see the product working — without any backend, token, or real store data.

**Architecture:** One codebase, two modes selected by `NEXT_PUBLIC_LIVE_MODE` (demo by default). A `useDashboardSource` switch — resolved once at module load — returns either the real `useShopTalk()` (live) or a new `useDemo()` (offline mock), both exposing the same dashboard shape. In demo mode the app renders a "story" layout (mock iMessage chat + result panel + live activity) driven by a pure, unit-tested sequencer over canned sample-store data; it never opens an `EventSource`.

**Tech Stack:** Next.js 14 (App Router), React 18, Tailwind 3, lucide-react. No new deps. Pure logic in `.mjs` modules tested with Node's built-in runner (`node --test`).

## Global Constraints

- **Demo is the default.** `NEXT_PUBLIC_LIVE_MODE === "true"` → live mode; anything else → demo mode. The dangerous mode (real data) requires explicit opt-in.
- **Air-gapped demo:** in demo mode, `useShopTalk()` (the only thing that opens an `EventSource`) is **never called**. The mode is chosen at module load (`const LIVE = process.env.NEXT_PUBLIC_LIVE_MODE === "true"`), so the same hook runs every render (Rules of Hooks safe).
- **No new dependencies.** Reuse existing Tailwind theme tokens (`bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`) and existing animations (`animate-flash-in`, `animate-ping-slow`, `animate-pulse`). Tailwind default palette (e.g. `bg-sky-500`, `text-amber-400`, `text-emerald-400`) is available.
- **All demo data is fake** — no real PII (emails like `ada@example.com`). Demo event `detail` payloads match the exact shapes `ResultPanel` renders.
- **Pure logic is `.mjs`** (not `.js`) so `node --test` can import it without making the Next package `type: "module"` (which would break the CommonJS `tailwind.config.js`/`postcss.config.js`). React components import these `.mjs` files **with the explicit `.mjs` extension**.
- The dashboard shape every source returns: `{ activity, status, latest, stores, chat, questions, runQuestion, mode }`. `ResultPanel`/`ActivityLog` are unchanged consumers of `latest`/`activity`.
- Work only in `frontend/`. Do not touch the backend. Run all commands from `/Users/syedarman/Desktop/mockbase/frontend`.

---

## File Structure

**New:**
- `frontend/lib/demoData.mjs` — sample store + scripted demo sequence (pure data).
- `frontend/lib/demoSequencer.mjs` — pure reducer: played steps → `{ chat, latest, activity }`.
- `frontend/lib/sparkline.mjs` — pure helper: numeric series → SVG polyline points.
- `frontend/lib/useDemo.js` — demo source hook (auto-play + `runQuestion`).
- `frontend/lib/useDashboardSource.js` — the live-vs-demo switch.
- `frontend/components/ChatPanel.js` — mock iMessage panel + "Try ▸" chips.
- `frontend/components/Sparkline.js` — inline SVG sparkline component.
- `frontend/test/demoSequencer.test.mjs`, `frontend/test/demoData.test.mjs`, `frontend/test/sparkline.test.mjs`.

**Modified:**
- `frontend/components/ResultPanel.js` — conditional sparkline in the Sales view.
- `frontend/app/page.js` — branch to the story layout in demo mode.
- `frontend/components/Header.js` — "Demo · sample data" badge.
- `frontend/package.json` — add `"test": "node --test"`.
- `frontend/.env.example` — document `NEXT_PUBLIC_LIVE_MODE`.
- `README.md` — "Live demo" note.

---

### Task 1: Mock data + pure sequencer (with tests)

**Files:**
- Create: `frontend/lib/demoData.mjs`, `frontend/lib/demoSequencer.mjs`
- Test: `frontend/test/demoSequencer.test.mjs`, `frontend/test/demoData.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces:
  - `DEMO_STORES: Array<{key,label,shopDomain}>`, `DEMO_SCRIPT: Array<{id, question, reply, event}>` where `event` is `{ type, tool, store, message, detail }` shaped per `ResultPanel`.
  - `demoStateFor(played: Array<{step, ts}>): { chat: Array<{id,role,text}>, latest: event|null, activity: Array<event & {id,timestamp}> }` — pure.

- [ ] **Step 1: Write the failing test** — `frontend/test/demoSequencer.test.mjs`

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { demoStateFor } from "../lib/demoSequencer.mjs";
import { DEMO_SCRIPT } from "../lib/demoData.mjs";

test("demoStateFor([]) is empty", () => {
  const s = demoStateFor([]);
  assert.deepEqual(s.chat, []);
  assert.equal(s.latest, null);
  assert.deepEqual(s.activity, []);
});

test("one played step yields a user+poke chat pair, latest, and one activity row", () => {
  const step = DEMO_SCRIPT[0];
  const s = demoStateFor([{ step, ts: 1000 }]);
  assert.equal(s.chat.length, 2);
  assert.equal(s.chat[0].role, "user");
  assert.equal(s.chat[0].text, step.question);
  assert.equal(s.chat[1].role, "poke");
  assert.equal(s.chat[1].text, step.reply);
  assert.equal(s.latest, step.event);
  assert.equal(s.activity.length, 1);
  assert.equal(s.activity[0].type, step.event.type);
  assert.equal(s.activity[0].timestamp, 1000);
});

test("two played steps: latest is the last; activity is newest-first", () => {
  const a = DEMO_SCRIPT[0], b = DEMO_SCRIPT[1];
  const s = demoStateFor([{ step: a, ts: 1 }, { step: b, ts: 2 }]);
  assert.equal(s.chat.length, 4);
  assert.equal(s.latest, b.event);
  assert.equal(s.activity[0].type, b.event.type); // newest first
  assert.equal(s.activity[1].type, a.event.type);
});
```

- [ ] **Step 2: Write `frontend/test/demoData.test.mjs`**

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_SCRIPT, DEMO_STORES } from "../lib/demoData.mjs";

const RESULT_TYPES = ["stores", "sales", "orders", "order", "products", "customers"];

test("DEMO_STORES are tokenless summaries", () => {
  assert.ok(DEMO_STORES.length >= 1);
  for (const s of DEMO_STORES) {
    assert.deepEqual(Object.keys(s).sort(), ["key", "label", "shopDomain"].sort());
  }
});

test("every script step has a valid, ResultPanel-shaped event", () => {
  assert.ok(DEMO_SCRIPT.length >= 3);
  for (const step of DEMO_SCRIPT) {
    assert.ok(step.id && step.question && step.reply, "step has id/question/reply");
    assert.ok(RESULT_TYPES.includes(step.event.type), `valid type: ${step.event.type}`);
    assert.ok(step.event.message, "event has a message");
    assert.ok("detail" in step.event, "event has detail");
  }
});

test("sales step carries totalsByCurrency, orderCount, and a sparkline series", () => {
  const sales = DEMO_SCRIPT.find((s) => s.event.type === "sales");
  assert.ok(sales, "a sales step exists");
  assert.equal(typeof sales.event.detail.orderCount, "number");
  assert.ok(sales.event.detail.totalsByCurrency.USD > 0);
  assert.ok(Array.isArray(sales.event.detail.series) && sales.event.detail.series.length >= 2);
});

test("orders/products/customers details are arrays with the right fields", () => {
  const orders = DEMO_SCRIPT.find((s) => s.event.type === "orders").event.detail;
  assert.ok(Array.isArray(orders) && orders[0].name && typeof orders[0].total === "number");
  const products = DEMO_SCRIPT.find((s) => s.event.type === "products").event.detail;
  assert.ok(Array.isArray(products) && products[0].title && typeof products[0].price === "number");
  const customers = DEMO_SCRIPT.find((s) => s.event.type === "customers").event.detail;
  assert.ok(Array.isArray(customers) && customers[0].email && typeof customers[0].amountSpent === "number");
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend && node --test test/`
Expected: FAIL — `Cannot find module '../lib/demoData.mjs'` / `'../lib/demoSequencer.mjs'`.

- [ ] **Step 4: Write `frontend/lib/demoData.mjs`**

```javascript
// demoData.mjs — sample store + scripted demo sequence. Pure data, no React.
// All data is FAKE (no real PII). event.detail matches ResultPanel's field shapes
// per event.type, so the demo renders exactly like the real tools.

export const DEMO_STORE = {
  key: "northwind",
  label: "Northwind Supply Co.",
  shopDomain: "northwind-supply.myshopify.com",
};

export const DEMO_STORES = [DEMO_STORE];

export const DEMO_SCRIPT = [
  {
    id: "sales-today",
    question: "How much did I sell today?",
    reply: "You've made 2,480.00 USD across 18 orders today — average order 137.78 USD. 📈",
    event: {
      type: "sales",
      tool: "get_sales",
      store: "northwind",
      message: "northwind — today: 18 orders, 2480.00 USD",
      detail: {
        store: "northwind",
        totalsByCurrency: { USD: 2480 },
        orderCount: 18,
        series: [180, 240, 90, 320, 150, 410, 260, 300, 330],
      },
    },
  },
  {
    id: "recent-orders",
    question: "Show my last 5 orders",
    reply: "Here are your 5 most recent orders — 2 are still unfulfilled.",
    event: {
      type: "orders",
      tool: "get_orders",
      store: "northwind",
      message: "northwind — 5 recent orders",
      detail: [
        { name: "#1042", customer: "Ada Lovelace", total: 168.0, currency: "USD", fulfillmentStatus: "UNFULFILLED" },
        { name: "#1041", customer: "Grace Hopper", total: 92.5, currency: "USD", fulfillmentStatus: "FULFILLED" },
        { name: "#1040", customer: "Alan Turing", total: 240.0, currency: "USD", fulfillmentStatus: "UNFULFILLED" },
        { name: "#1039", customer: "Katherine Johnson", total: 54.0, currency: "USD", fulfillmentStatus: "FULFILLED" },
        { name: "#1038", customer: "Edsger Dijkstra", total: 119.0, currency: "USD", fulfillmentStatus: "FULFILLED" },
      ],
    },
  },
  {
    id: "top-products",
    question: "What are my products?",
    reply: "Your catalog — the Trail Hoodie is your hero product and it's low on stock (7 left).",
    event: {
      type: "products",
      tool: "search_products",
      store: "northwind",
      message: "northwind — 5 products",
      detail: [
        { title: "Trail Hoodie", price: 68.0, currency: "USD", totalInventory: 7, status: "ACTIVE" },
        { title: "Everyday Tote", price: 42.0, currency: "USD", totalInventory: 130, status: "ACTIVE" },
        { title: "Wool Beanie", price: 28.0, currency: "USD", totalInventory: 64, status: "ACTIVE" },
        { title: "Canvas Sneakers", price: 95.0, currency: "USD", totalInventory: 23, status: "ACTIVE" },
        { title: "Linen Scarf", price: 34.0, currency: "USD", totalInventory: 0, status: "DRAFT" },
      ],
    },
  },
  {
    id: "repeat-customers",
    question: "Who are my repeat customers?",
    reply: "Your top repeat customers by spend 👇",
    event: {
      type: "customers",
      tool: "search_customers",
      store: "northwind",
      message: "northwind — 4 customers",
      detail: [
        { name: "Ada Lovelace", email: "ada@example.com", orders: 12, amountSpent: 1840.0, currency: "USD" },
        { name: "Grace Hopper", email: "grace@example.com", orders: 9, amountSpent: 1320.5, currency: "USD" },
        { name: "Alan Turing", email: "alan@example.com", orders: 7, amountSpent: 980.0, currency: "USD" },
        { name: "Katherine Johnson", email: "kj@example.com", orders: 5, amountSpent: 610.0, currency: "USD" },
      ],
    },
  },
];
```

- [ ] **Step 5: Write `frontend/lib/demoSequencer.mjs`**

```javascript
// demoSequencer.mjs — pure reducer: the list of played steps -> dashboard state.
// No React, no timers. `played` is an array of { step, ts } (ts = ms epoch).

export function demoStateFor(played) {
  const chat = [];
  const activity = [];
  played.forEach(({ step, ts }, i) => {
    chat.push({ id: `${step.id}-q`, role: "user", text: step.question });
    chat.push({ id: `${step.id}-a`, role: "poke", text: step.reply });
    activity.unshift({ id: `${step.id}-${i}`, ...step.event, timestamp: ts });
  });
  const last = played[played.length - 1];
  return { chat, latest: last ? last.step.event : null, activity };
}
```

- [ ] **Step 6: Add the test script** — in `frontend/package.json`, add to `"scripts"`: `"test": "node --test"` (place it after `"lint": "next lint"`).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd frontend && node --test test/`
Expected: PASS — all tests across `demoSequencer.test.mjs` and `demoData.test.mjs`.

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/demoData.mjs frontend/lib/demoSequencer.mjs frontend/test/demoSequencer.test.mjs frontend/test/demoData.test.mjs frontend/package.json
git commit -m "Add demo-mode mock data + pure sequencer (frontend)"
```

---

### Task 2: Sparkline (pure helper + component) and ResultPanel integration

**Files:**
- Create: `frontend/lib/sparkline.mjs`, `frontend/components/Sparkline.js`
- Test: `frontend/test/sparkline.test.mjs`
- Modify: `frontend/components/ResultPanel.js`

**Interfaces:**
- Produces: `sparklinePoints(series: number[], width=120, height=28): string` (SVG points, `""` if fewer than 2 points); `<Sparkline series width height />` (renders `null` when points are empty).

- [ ] **Step 1: Write the failing test** — `frontend/test/sparkline.test.mjs`

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { sparklinePoints } from "../lib/sparkline.mjs";

test("maps a two-point series to corner-to-corner points (y inverted)", () => {
  assert.equal(sparklinePoints([0, 10], 100, 10), "0.0,10.0 100.0,0.0");
});

test("returns empty string for too-short or invalid input", () => {
  assert.equal(sparklinePoints([5], 100, 10), "");
  assert.equal(sparklinePoints([], 100, 10), "");
  assert.equal(sparklinePoints(null, 100, 10), "");
});

test("a flat series stays on the baseline (no divide-by-zero)", () => {
  assert.equal(sparklinePoints([4, 4, 4], 100, 10), "0.0,10.0 50.0,10.0 100.0,10.0");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && node --test test/sparkline.test.mjs`
Expected: FAIL — `Cannot find module '../lib/sparkline.mjs'`.

- [ ] **Step 3: Write `frontend/lib/sparkline.mjs`**

```javascript
// sparkline.mjs — pure: numeric series -> SVG polyline "points" string.
export function sparklinePoints(series, width = 120, height = 28) {
  if (!Array.isArray(series) || series.length < 2) return "";
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1; // flat series -> baseline, no divide-by-zero
  const stepX = width / (series.length - 1);
  return series
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && node --test test/sparkline.test.mjs`
Expected: PASS — 3 tests.

- [ ] **Step 5: Write `frontend/components/Sparkline.js`**

```javascript
"use client";
import { sparklinePoints } from "../lib/sparkline.mjs";

export default function Sparkline({ series, width = 160, height = 36 }) {
  const points = sparklinePoints(series, width, height);
  if (!points) return null;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="text-emerald-400/80"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
```

- [ ] **Step 6: Wire the sparkline into `ResultPanel.js`'s Sales view**

In `frontend/components/ResultPanel.js`, add the import at the top (after the lucide import):
```javascript
import Sparkline from "./Sparkline";
```
Then in the `Sales` component, immediately after the `<div className="text-sm text-muted-foreground">{orderCount} orders</div>` line, add (renders only when a series exists — live mode has none):
```javascript
      {detail.series && <Sparkline series={detail.series} />}
```

- [ ] **Step 7: Verify the frontend still builds**

Run: `cd frontend && npm run build`
Expected: build succeeds (no import/type errors). The `.mjs` import resolves; `Sparkline` returns `null` when there's no series, so live mode is unaffected.

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/sparkline.mjs frontend/components/Sparkline.js frontend/test/sparkline.test.mjs frontend/components/ResultPanel.js
git commit -m "Add sparkline (pure helper + component) to the sales result view"
```

---

### Task 3: Demo source hook + live/demo switch

**Files:**
- Create: `frontend/lib/useDemo.js`, `frontend/lib/useDashboardSource.js`

**Interfaces:**
- Consumes: `DEMO_SCRIPT`, `DEMO_STORES` (Task 1), `demoStateFor` (Task 1), `useShopTalk` (existing).
- Produces: `useDashboardSource(): { activity, status, latest, stores, chat, questions, runQuestion, mode }`. In demo builds it equals `useDemo`; in live builds a thin wrapper over `useShopTalk`. Chosen once at module load.

- [ ] **Step 1: Write `frontend/lib/useDemo.js`**

```javascript
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEMO_SCRIPT, DEMO_STORES } from "./demoData.mjs";
import { demoStateFor } from "./demoSequencer.mjs";

const STEP_MS = 3500;

export function useDemo() {
  const [played, setPlayed] = useState([]); // [{ step, ts }]
  const idxRef = useRef(0);
  const autoRef = useRef(true);
  const startedRef = useRef(false);

  const playStep = useCallback((step) => {
    // Rolling window so the chat/activity don't grow unbounded during auto-loop.
    setPlayed((prev) => [...prev, { step, ts: Date.now() }].slice(-DEMO_SCRIPT.length));
  }, []);

  useEffect(() => {
    if (startedRef.current) return; // guard React strict-mode double-invoke
    startedRef.current = true;

    const advance = () => {
      const step = DEMO_SCRIPT[idxRef.current % DEMO_SCRIPT.length];
      idxRef.current += 1;
      playStep(step);
    };
    advance(); // show the first step immediately
    const timer = setInterval(() => {
      if (autoRef.current) advance();
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [playStep]);

  const runQuestion = useCallback(
    (id) => {
      autoRef.current = false; // user took over — stop auto-advancing
      const step = DEMO_SCRIPT.find((s) => s.id === id);
      if (step) playStep(step);
    },
    [playStep]
  );

  const { chat, latest, activity } = demoStateFor(played);
  return {
    activity,
    status: "live",
    latest,
    stores: DEMO_STORES,
    chat,
    questions: DEMO_SCRIPT.map((s) => ({ id: s.id, question: s.question })),
    runQuestion,
    mode: "demo",
  };
}
```

- [ ] **Step 2: Write `frontend/lib/useDashboardSource.js`**

```javascript
"use client";
import { useShopTalk } from "./useShopTalk";
import { useDemo } from "./useDemo";

// Mode is fixed per build (NEXT_PUBLIC_* is inlined at build time), so we pick the
// hook ONCE at module load. That keeps the same hook running every render (Rules of
// Hooks), and — crucially — demo builds never call useShopTalk, so no EventSource
// is ever opened (the demo is fully air-gapped).
const LIVE = process.env.NEXT_PUBLIC_LIVE_MODE === "true";

function useLiveSource() {
  const s = useShopTalk();
  return { ...s, chat: [], questions: [], runQuestion: () => {}, mode: "live" };
}

export const useDashboardSource = LIVE ? useLiveSource : useDemo;
```

- [ ] **Step 3: Verify it builds (demo default)**

Run: `cd frontend && npm run build`
Expected: build succeeds. (Nothing renders these yet — Task 5 wires `page.js`. This step just confirms the new modules compile.)

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/useDemo.js frontend/lib/useDashboardSource.js
git commit -m "Add demo source hook + air-gapped live/demo switch"
```

---

### Task 4: Mock iMessage chat panel

**Files:**
- Create: `frontend/components/ChatPanel.js`

**Interfaces:**
- Consumes: `cn` from `../lib/utils`; props `{ chat, questions, runQuestion }` from the demo source.

- [ ] **Step 1: Write `frontend/components/ChatPanel.js`**

```javascript
"use client";
import { cn } from "../lib/utils";

export default function ChatPanel({ chat, questions, runQuestion }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-1 pb-3 text-sm text-muted-foreground">
        <span className="text-base">📱</span> iMessage · Poke
      </div>

      <div className="flex-1 space-y-2 overflow-auto px-1">
        {chat.length === 0 && (
          <p className="text-xs text-muted-foreground">Starting demo…</p>
        )}
        {chat.map((m) => (
          <div
            key={m.id}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-3 py-2 text-[13px] leading-snug animate-flash-in",
                m.role === "user"
                  ? "rounded-br-sm bg-sky-500 text-white"
                  : "rounded-bl-sm bg-muted text-foreground"
              )}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 px-1">
        <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">Try ▸</p>
        <div className="flex flex-wrap gap-2">
          {questions.map((q) => (
            <button
              key={q.id}
              onClick={() => runQuestion(q.id)}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground/90 hover:bg-muted"
            >
              {q.question}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd frontend && npm run build`
Expected: build succeeds (component compiles; not yet rendered until Task 5).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/ChatPanel.js
git commit -m "Add mock iMessage ChatPanel with sample-question chips"
```

---

### Task 5: Wire the story layout + demo badge

**Files:**
- Modify: `frontend/app/page.js`, `frontend/components/Header.js`

**Interfaces:**
- Consumes: `useDashboardSource` (Task 3), `ChatPanel` (Task 4). `Header` gains an optional `demo` boolean prop.

- [ ] **Step 1: Replace `frontend/app/page.js`**

```javascript
"use client";
import { useDashboardSource } from "../lib/useDashboardSource";
import Header from "../components/Header";
import ResultPanel from "../components/ResultPanel";
import ActivityLog from "../components/ActivityLog";
import ChatPanel from "../components/ChatPanel";

export default function Dashboard() {
  const { activity, status, latest, stores, chat, questions, runQuestion, mode } =
    useDashboardSource();
  const demo = mode === "demo";

  const ActivityAside = (
    <aside className="overflow-auto rounded-lg border border-border bg-card p-2">
      <h2 className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Live Activity
      </h2>
      <ActivityLog activity={activity} />
    </aside>
  );

  return (
    <div className="flex h-screen flex-col">
      <Header status={status} stores={stores} demo={demo} />
      {demo ? (
        <main className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[360px_1fr_320px]">
          <section className="overflow-hidden rounded-lg border border-border bg-card p-4">
            <ChatPanel chat={chat} questions={questions} runQuestion={runQuestion} />
          </section>
          <section className="overflow-auto rounded-lg border border-border bg-card p-6">
            <ResultPanel latest={latest} />
          </section>
          {ActivityAside}
        </main>
      ) : (
        <main className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[1fr_360px]">
          <section className="overflow-auto rounded-lg border border-border bg-card p-6">
            <ResultPanel latest={latest} />
          </section>
          {ActivityAside}
        </main>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the demo badge to `frontend/components/Header.js`**

Change the signature `export default function Header({ status, stores }) {` to:
```javascript
export default function Header({ status, stores, demo }) {
```
Then, inside `<div className="flex items-center gap-3">`, add the badge as the FIRST child (before the existing status pill `<div className="flex items-center gap-2 rounded-full ...">`):
```javascript
        {demo && (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400">
            Demo · sample data
          </span>
        )}
```

- [ ] **Step 3: Build, run, and screenshot the demo**

```bash
cd frontend && npm run build && (npm run start &) && sleep 3
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --screenshot=/tmp/shoptalk-demo.png --window-size=1440,900 --virtual-time-budget=6000 http://localhost:3000
```
Expected: a populated story layout — chat bubbles on the left (a "How much did I sell today?" exchange), a sales card with a sparkline in the middle, "Live Activity" rows on the right, and a "Demo · sample data" badge in the header. **Look at the screenshot** — a blank/empty-state frame means the demo source isn't driving the UI; fix before committing. Stop the server after (`kill %1` or the started node process).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/page.js frontend/components/Header.js
git commit -m "Wire demo story layout (chat + result + activity) and demo badge"
```

---

### Task 6: Env example, README, and full verification

**Files:**
- Modify: `frontend/.env.example`, `README.md`

- [ ] **Step 1: Document the mode flag in `frontend/.env.example`**

Append:
```
# Mode select. Omit or set false = DEMO mode: fully offline mock data, safe to
# deploy publicly (never connects to a backend). Set to true ONLY for a local
# dashboard wired to your real backend (then also set NEXT_PUBLIC_DASHBOARD_TOKEN).
NEXT_PUBLIC_LIVE_MODE=
```

- [ ] **Step 2: Add a "Live demo" note to `README.md`**

Under the intro, add a short line (fill in the real URL once deployed):
```markdown
**Live demo:** <your-vercel-url> — a self-contained walkthrough with **sample data**
(no real store, no backend). The real dashboard runs locally against your store.
```

- [ ] **Step 3: Full verification**

Run: `cd frontend && node --test test/ && npm run build`
Expected: all unit tests pass (Tasks 1–2) and the production build succeeds in demo mode (the default).

- [ ] **Step 4: Commit**

```bash
git add frontend/.env.example README.md
git commit -m "Document demo/live mode flag and add live-demo note"
```

---

### Task 7: Shopify-green accents (tasteful, dark base kept)

**Files:**
- Modify: `frontend/tailwind.config.js`, `frontend/app/globals.css`, `frontend/components/Sparkline.js`, `frontend/components/Header.js`, `frontend/components/ChatPanel.js`

**Goal:** make the dashboard read as a *Shopify* tool at a glance by applying Shopify green (`#008060`, logo green `#95bf47`) as an **accent** — sparkline, the live status dot, chip hover, and the subtle flash tint. Keep the clean dark base. **Chat bubbles stay iMessage-blue** so the two colors narrate "iMessage ↔ Shopify."

- [ ] **Step 1: Add Shopify colors to `frontend/tailwind.config.js`**

In the `theme.extend.colors` object, add a `shopify` entry immediately after the `accent: {...}` block:
```javascript
      shopify: { DEFAULT: "#008060", light: "#95bf47" },
```
(This yields `bg-shopify`, `text-shopify`, `border-shopify`, and the lighter `*-shopify-light` utilities.)

- [ ] **Step 2: Green the sparkline** — in `frontend/components/Sparkline.js`, change the `<svg>` className from `"text-emerald-400/80"` to `"text-shopify-light"`.

- [ ] **Step 3: Green the live status dot** — in `frontend/components/Header.js`, in the `STATUS` map change the `live` entry's `dot` from `"bg-emerald-500/80"` to `"bg-shopify-light"` (the `animate-ping-slow` overlay reuses `s.dot`, so the live ping goes green too).

- [ ] **Step 4: Green the chip hover** — in `frontend/components/ChatPanel.js`, append `hover:border-shopify/50 hover:text-shopify-light` to the chip button's className (after the existing `hover:bg-muted`), so the "Try ▸" chips pick up a Shopify-green accent on hover.

- [ ] **Step 5: Tint the entrance flash green** — in `frontend/app/globals.css`, change `--accent: 220 8% 72%;` to `--accent: 165 100% 25%;` (the HSL of `#008060`). The `animate-flash-in` keyframe uses `hsl(var(--accent) / 0.10)`, so result/activity items now flash a faint green on arrival. (`--accent` is otherwise only used at low opacity — no readability impact; components use `bg-card`/`bg-muted`, not `bg-accent`.)

- [ ] **Step 6: Build, screenshot, eyeball it**

```bash
cd frontend && npm run build && (npm run start &) && sleep 3
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --screenshot=/tmp/shoptalk-demo-green.png --window-size=1440,900 --virtual-time-budget=6000 http://localhost:3000
```
Expected: green sparkline + green live dot + green chip-hover + faint green flashes, while the **chat bubbles remain blue** and the base stays dark. **Look at the screenshot** — confirm it reads as on-brand, not garish. Stop the server after.

- [ ] **Step 7: Commit**

```bash
git add frontend/tailwind.config.js frontend/app/globals.css frontend/components/Sparkline.js frontend/components/Header.js frontend/components/ChatPanel.js
git commit -m "Add Shopify-green accents to the dashboard (dark base kept, chat stays blue)"
```

---

## Self-Review Notes

- **Spec coverage:** demo-by-default flag + air-gapped switch (Task 3, Global Constraints) ✓; mock store "Northwind Supply Co." with faithful shapes (Task 1) ✓; hybrid auto-play + clickable (Task 3 `useDemo`) ✓; story layout chat+result+activity (Task 5) ✓; polished look — iMessage bubbles (Task 4), sparkline (Task 2), `animate-flash-in` entrance + demo badge (Tasks 4–5) ✓; pure-logic unit tests (Tasks 1–2) ✓; deploy/safety env + README (Task 6) ✓; real dashboard untouched — `useShopTalk.js` unchanged, only consumed via the switch (Task 3) ✓; Shopify-green accent theming — accent-only on the dark base, chat stays iMessage-blue (Task 7) ✓.
- **Air-gap guarantee:** the mode is resolved at module load; demo builds export `useDemo` and never invoke `useShopTalk`, so no `EventSource` is created. Confirmed by the constraint and Task 3 Step 2 rationale.
- **No placeholders:** every code step is complete; tests show real assertions; the only fill-in is the deploy URL in the README, which is unknowable until deploy and clearly marked.
- **Type/shape consistency:** `demoStateFor` consumes `{step, ts}` (Task 1) exactly as `useDemo` produces it (Task 3); demo event `detail` shapes (Task 1) match `ResultPanel`'s readers (orders `name/customer/total/currency/fulfillmentStatus`, products `title/price/currency/totalInventory/status`, customers `name/email/orders/amountSpent/currency`, sales `totalsByCurrency/orderCount/series`); `sparklinePoints` signature (Task 2) matches `Sparkline` usage; the dashboard shape returned by `useDashboardSource` (Task 3) matches what `page.js` destructures (Task 5).
- **`.mjs` rationale** documented in Global Constraints (keeps `node --test` working without making the Next package `type: module`).
