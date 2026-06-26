// demoSequencer.mjs — pure reducer: the list of played steps -> dashboard state.
// No React, no timers. `played` is an array of { step, ts } (ts = ms epoch).

export function demoStateFor(played) {
  const chat = [];
  const activity = [];
  played.forEach(({ step, ts }, i) => {
    chat.push({ id: `${step.id}-q-${i}`, role: "user", text: step.question });
    chat.push({ id: `${step.id}-a-${i}`, role: "poke", text: step.reply });
    activity.unshift({ id: `${step.id}-${i}`, ...step.event, timestamp: ts });
  });
  const last = played[played.length - 1];
  return { chat, latest: last ? last.step.event : null, activity };
}
