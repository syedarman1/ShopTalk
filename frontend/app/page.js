"use client";
import { MotionConfig } from "framer-motion";
import { useDemo } from "../lib/useDemo";
import Header from "../components/Header";
import ResultPanel from "../components/ResultPanel";
import ActivityLog from "../components/ActivityLog";
import ChatPanel from "../components/ChatPanel";

// Demo-only dashboard: a self-contained visual on mock data (see lib/demoData.mjs).
// It never connects to a backend or shows real store data — that flows only to Poke.
export default function Dashboard() {
  const { activity, latest, stores, chat, typing, questions, runQuestion } = useDemo();

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-screen flex-col">
        <Header stores={stores} demo />
        <main className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[360px_1fr_320px]">
          <section className="overflow-hidden rounded-lg border border-border bg-card p-4">
            <ChatPanel chat={chat} typing={typing} questions={questions} runQuestion={runQuestion} />
          </section>
          <section className="overflow-auto rounded-lg border border-border bg-card p-6">
            <ResultPanel latest={latest} />
          </section>
          <aside className="overflow-auto rounded-lg border border-border bg-card p-2">
            <h2 className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Live Activity
            </h2>
            <ActivityLog activity={activity} />
          </aside>
        </main>
      </div>
    </MotionConfig>
  );
}
