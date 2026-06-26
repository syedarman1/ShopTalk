// demoSequencer.mjs — pure reducer: the list of played steps -> dashboard state.
// No React, no timers. `played` is an array of { step, ts } (ts = ms epoch).

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
