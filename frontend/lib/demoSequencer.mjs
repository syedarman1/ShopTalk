// demoSequencer.mjs — pure reducer: composeDemoState(history, current) -> dashboard state.
// No React, no timers. history is Array<{ step, ts }> (completed exchanges); current is { step, phase, ts } | null.

export const PHASES = ["user", "typing", "reply", "result"];

function chatForStep(step, key, includeReply) {
  const msgs = [{ id: `${step.id}-q-${key}`, role: "user", text: step.question }];
  if (includeReply) msgs.push({ id: `${step.id}-a-${key}`, role: "poke", text: step.reply });
  return msgs;
}

// Compose visible demo state from completed history + the in-progress current step.
// history: Array<{ step, ts }> (completed exchanges). current: { step, phase, ts } | null.
export function composeDemoState(history, current) {
  const chat = [];
  const activity = [];
  history.forEach(({ step, ts }) => {
    chat.push(...chatForStep(step, ts, true));
    activity.unshift({ id: `${step.id}-${ts}`, ...step.event, timestamp: ts });
  });
  let typing = false;
  let latest = history.length ? history[history.length - 1].step.event : null;
  if (current) {
    const { step, phase, ts } = current;
    chat.push(...chatForStep(step, ts, phase === "reply" || phase === "result"));
    typing = phase === "typing";
    if (phase === "result") {
      latest = step.event;
      activity.unshift({ id: `${step.id}-${ts}`, ...step.event, timestamp: ts });
    }
  }
  return { chat, typing, latest, activity };
}
