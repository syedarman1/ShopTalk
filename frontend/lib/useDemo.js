"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEMO_SCRIPT, DEMO_STORES } from "./demoData.mjs";
import { demoStateFor } from "./demoSequencer.mjs";

const STEP_MS = 3500;

export function useDemo() {
  const [played, setPlayed] = useState([]); // [{ step, ts }]
  const idxRef = useRef(0);
  const autoRef = useRef(true);
  const playStep = useCallback((step) => {
    // Rolling window so the chat/activity don't grow unbounded during auto-loop.
    setPlayed((prev) => [...prev, { step, ts: Date.now() }].slice(-DEMO_SCRIPT.length));
  }, []);

  useEffect(() => {
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
