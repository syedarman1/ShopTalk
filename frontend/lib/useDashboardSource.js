"use client";
import { useShopTalk } from "./useShopTalk";
import { useDemo } from "./useDemo";

// Mode is selected once at module load. NEXT_PUBLIC_LIVE_MODE is inlined by Next at
// build time; in a demo build it is absent, so LIVE is false and useDemo is chosen.
// useShopTalk (the only thing that opens an EventSource) is therefore never called in
// a demo build — the air-gap is behavioral (the live hook is never invoked), and the
// same hook runs every render so Rules of Hooks is satisfied.
const LIVE = process.env.NEXT_PUBLIC_LIVE_MODE === "true";

function useLiveSource() {
  const s = useShopTalk();
  return { ...s, chat: [], questions: [], runQuestion: () => {}, mode: "live" };
}

export const useDashboardSource = LIVE ? useLiveSource : useDemo;
