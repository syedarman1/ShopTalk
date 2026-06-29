// notify.js — fire-and-forget bridge from the MCP process to the web backend.
// After an MCP tool runs, we POST the event to the Express server's
// /internal/broadcast endpoint so it can reach a dashboard over SSE.
// If the dashboard/server isn't running, the tool result still returned fine —
// we just swallow the connection error.

const BROADCAST_URL =
  process.env.SHOPTALK_BROADCAST_URL ||
  `http://localhost:${process.env.PORT || 4000}/internal/broadcast`;

export async function notifyDashboard(event) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    await fetch(BROADCAST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    // Dashboard offline — that's fine, the database change is already persisted.
  }
}
