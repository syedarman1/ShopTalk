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
