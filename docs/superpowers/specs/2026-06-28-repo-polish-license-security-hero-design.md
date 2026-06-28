# Repo Polish (round 1): LICENSE + SECURITY + README hero — Design

**Date:** 2026-06-28
**Status:** Approved (design); pending implementation plan
**Scope:** Repo meta/docs only — no application code changes.

## Summary

Make the public ShopTalk repo read as a *shipped, maintained* project by adding
an MIT `LICENSE`, a short `SECURITY.md`, and a polished, populated hero screenshot
of the interactive demo at the top of the `README`. No application code changes.

## Goals

- Add a permissive license so the repo is legally usable (resolves the earlier
  "no LICENSE" must-fix).
- Provide a standard vulnerability-reporting path and a one-line security posture.
- Give a recruiter an immediate visual of the working product (hero image at the
  top of the README).

## Non-goals (deferred to a later round)

- GitHub Actions CI.
- Correctness fixes (multi-currency AOV, test/cancelled-order revenue, fail-closed
  `/mcp` default, `Promise.allSettled` rollup, gating `/api/stores`).
- Mocked Shopify-client tests.
- An animated GIF of the demo (the user records that later; this round ships a
  static hero).

## Deliverables

### 1. `LICENSE`
- MIT License, copyright `2026 Syed Arman`.
- Add a brief "## License" note near the bottom of `README.md`: "MIT — see [LICENSE](LICENSE)."

### 2. `SECURITY.md`
Short and standard:
- **Reporting:** email `syedarman2003@gmail.com` to report a vulnerability; ask not to open public issues for security reports.
- **Posture (one-liner each):** read-only Shopify scopes only; credentials live only in environment variables (never committed; `.env` is gitignored); the `/mcp` endpoint is gated by a shared secret (`MCP_TOKEN`).
- **Supported version:** `main`.

### 3. README hero image
- A static screenshot of the **current interactive demo in a populated state** (a chat exchange visible + a result rendered + the Shopify-green branding + the "Demo · sample data" badge).
- Saved to `docs/shoptalk-demo.png`.
- Embedded at the **top of `README.md`** (just under the H1), e.g. `![ShopTalk demo](docs/shoptalk-demo.png)`.

#### How the populated screenshot is captured (honest method)
Headless Chrome cannot tap a suggestion chip, so a fresh screenshot would show only
the idle state. To capture a *populated* state of the **current** components without
shipping any code change:
1. Make a **throwaway local edit** to `frontend/lib/useDemo.js` that auto-runs one
   sample question on mount (so the chat + result render).
2. Build/serve and capture the screenshot with headless Chrome to `docs/shoptalk-demo.png`.
3. **Revert the throwaway edit** with `git checkout -- frontend/lib/useDemo.js` —
   it is never committed.

Only `docs/shoptalk-demo.png` (and the README/LICENSE/SECURITY files) are committed.
The demo's runtime behavior is unchanged (still no auto-play).

## Files
- Create: `LICENSE`, `SECURITY.md`, `docs/shoptalk-demo.png` (binary).
- Modify: `README.md` (hero image at top; License note at bottom).

## Verification
- `LICENSE` and `SECURITY.md` exist with the specified content.
- `README.md` references `docs/shoptalk-demo.png` with a correct relative path, and the image file exists and shows the populated interactive demo.
- `git status` shows ONLY the intended files changed — confirm `frontend/lib/useDemo.js` (the throwaway edit) is reverted and NOT staged/committed, and no other app code changed.
- Frontend still builds and tests pass (sanity, since the throwaway edit was reverted): `cd frontend && npm test` unaffected.
