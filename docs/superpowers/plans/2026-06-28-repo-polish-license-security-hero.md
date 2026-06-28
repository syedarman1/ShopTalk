# Repo Polish (round 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public ShopTalk repo read as shipped/maintained by adding an MIT LICENSE, a SECURITY.md, and a populated hero screenshot of the interactive demo at the top of the README.

**Architecture:** Repo meta/docs only — two new text files, one committed screenshot, and README edits. The hero screenshot is captured from the *current* interactive demo via a throwaway local edit that is reverted (never committed), so no application behavior changes.

**Tech Stack:** Markdown, MIT license text, headless Chrome for the screenshot, Next.js 14 frontend (only built/served transiently for the capture).

## Global Constraints

- **No committed application-code changes.** The only committed files are `LICENSE`, `SECURITY.md`, `docs/shoptalk-demo.png`, and `README.md`. The throwaway edit to `frontend/lib/useDemo.js` MUST be reverted and never committed.
- Copyright holder: `Syed Arman`; year `2026`. Security contact: `syedarman2003@gmail.com`.
- Work on branch `shoptalk-release` (current). Run commands from `/Users/syedarman/Desktop/mockbase` unless noted.
- Plain commit messages — NO `Co-Authored-By` trailer or self-attribution.

## File Structure
- Create: `LICENSE` (MIT), `SECURITY.md`, `docs/shoptalk-demo.png` (binary screenshot).
- Modify: `README.md` (hero image near the top; License section at the bottom).
- Touch transiently (reverted): `frontend/lib/useDemo.js`.

---

### Task 1: LICENSE + SECURITY.md + README license note

**Files:**
- Create: `LICENSE`, `SECURITY.md`
- Modify: `README.md`

- [ ] **Step 1: Create `LICENSE`** (standard MIT text):

```
MIT License

Copyright (c) 2026 Syed Arman

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Create `SECURITY.md`**:

```markdown
# Security Policy

## Reporting a vulnerability

Please report security issues privately by emailing **syedarman2003@gmail.com**.
Do not open a public GitHub issue for security reports. I'll acknowledge and
respond as soon as I can.

## Security posture

- **Read-only:** ShopTalk requests only read Shopify scopes (`read_orders`,
  `read_products`, `read_customers`); it cannot modify, create, or delete store data.
- **Credentials:** Shopify Client ID/Secret live only in environment variables and
  are never committed (`.env` is gitignored). The app exchanges them for a
  short-lived (24h) access token at runtime.
- **MCP endpoint:** `/mcp` (and the dashboard's `/api/events` stream) are gated by a
  shared secret (`MCP_TOKEN`) so store data is not publicly readable.

## Supported version

The `main` branch is the supported version.
```

- [ ] **Step 3: Add a License note to `README.md`**

Read `README.md`, then append at the very end:
```markdown

## License

MIT — see [LICENSE](LICENSE).
```

- [ ] **Step 4: Verify**

Run: `ls LICENSE SECURITY.md && tail -3 README.md`
Expected: both files listed; README ends with the License note.

- [ ] **Step 5: Commit**

```bash
git add LICENSE SECURITY.md README.md
git commit -m "Add MIT LICENSE, SECURITY.md, and README license note"
```

---

### Task 2: README hero image (populated interactive demo)

**Files:**
- Create: `docs/shoptalk-demo.png`
- Modify: `README.md`
- Touch transiently (reverted, NOT committed): `frontend/lib/useDemo.js`

- [ ] **Step 1: Add a throwaway auto-run to `frontend/lib/useDemo.js`** (for capture only)

`useDemo.js` already imports `useEffect` and defines `runQuestion`. Immediately AFTER the existing cleanup effect line `useEffect(() => clearTimers, [clearTimers]);`, add this temporary effect:
```javascript
  // TEMP (hero screenshot only — revert before commit): auto-run one question.
  useEffect(() => {
    const t = setTimeout(() => runQuestion("sales-today"), 300);
    return () => clearTimeout(t);
  }, [runQuestion]);
```

- [ ] **Step 2: Build, serve on a fresh port, and screenshot the populated demo**

```bash
cd frontend && npm run build && PORT=3104 npm run start &
SP=$!
sleep 4
mkdir -p /Users/syedarman/Desktop/mockbase/docs
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --screenshot=/Users/syedarman/Desktop/mockbase/docs/shoptalk-demo.png --window-size=1440,900 \
  --virtual-time-budget=6000 http://localhost:3104
kill "$SP" 2>/dev/null
ls -la /Users/syedarman/Desktop/mockbase/docs/shoptalk-demo.png
```
The `--virtual-time-budget=6000` lets the choreography (typing→reply→result, ~2.2s) complete before the capture.

- [ ] **Step 3: Look at the screenshot and confirm it's populated**

Read `/Users/syedarman/Desktop/mockbase/docs/shoptalk-demo.png`. Confirm: a chat exchange is visible (the "How much did I sell today?" question + Poke's reply), the Result Panel shows the sales card (with the green sparkline), the Live Activity has a row, and the "Demo · sample data" badge + green branding are present. If it looks idle/empty (capture fired too early), increase `sleep`/`--virtual-time-budget` and re-capture.

- [ ] **Step 4: Revert the throwaway edit (critical)**

```bash
cd /Users/syedarman/Desktop/mockbase
git checkout -- frontend/lib/useDemo.js
git diff --stat frontend/lib/useDemo.js
```
Expected: no diff for `useDemo.js` (fully reverted — the auto-run is gone, runtime is back to no-auto-play).

- [ ] **Step 5: Embed the hero image at the top of `README.md`**

Read `README.md`. Immediately after the H1 line `# ShopTalk`, insert a blank line and:
```markdown
![ShopTalk — text your Shopify store, demo with sample data](docs/shoptalk-demo.png)
```

- [ ] **Step 6: Verify nothing unintended changed**

```bash
cd /Users/syedarman/Desktop/mockbase
git status --short
```
Expected: only `docs/shoptalk-demo.png` (new) and `README.md` (modified) are pending — `frontend/lib/useDemo.js` must NOT appear. Sanity: `cd frontend && npm test` still passes (15/15), confirming the revert left the app intact.

- [ ] **Step 7: Commit**

```bash
git add docs/shoptalk-demo.png README.md
git commit -m "Add populated interactive-demo hero image to README"
```

---

## Self-Review Notes
- **Spec coverage:** LICENSE (MIT, 2026 Syed Arman) + README note — Task 1 ✓; SECURITY.md (report email, read-only/env/MCP_TOKEN posture, main supported) — Task 1 ✓; populated hero captured via throwaway-revert method + embedded at top — Task 2 ✓. Non-goals (CI, correctness fixes, mocked tests, animated GIF) correctly excluded.
- **No committed app-code change:** Task 2 Steps 4 & 6 explicitly revert `useDemo.js` and assert it's absent from `git status` before the commit.
- **No placeholders:** full LICENSE + SECURITY content and exact commands/paths are given; the only intentional placeholder in the repo (`<your-vercel-url>` in the existing README) is untouched and out of scope.
- **Paths consistent:** `docs/shoptalk-demo.png` is referenced identically in the capture, the README embed, and the verification.
