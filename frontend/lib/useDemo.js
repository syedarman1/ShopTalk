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
