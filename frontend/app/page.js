"use client";
import { useDashboardSource } from "../lib/useDashboardSource";
import Header from "../components/Header";
import ResultPanel from "../components/ResultPanel";
import ActivityLog from "../components/ActivityLog";
import ChatPanel from "../components/ChatPanel";

export default function Dashboard() {
  const { activity, status, latest, stores, chat, questions, runQuestion, mode } =
    useDashboardSource();
  const demo = mode === "demo";

  const ActivityAside = (
    <aside className="overflow-auto rounded-lg border border-border bg-card p-2">
      <h2 className="px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Live Activity
      </h2>
      <ActivityLog activity={activity} />
    </aside>
  );

  return (
    <div className="flex h-screen flex-col">
      <Header status={status} stores={stores} demo={demo} />
      {demo ? (
        <main className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[360px_1fr_320px]">
          <section className="overflow-hidden rounded-lg border border-border bg-card p-4">
            <ChatPanel chat={chat} questions={questions} runQuestion={runQuestion} />
          </section>
          <section className="overflow-auto rounded-lg border border-border bg-card p-6">
            <ResultPanel latest={latest} />
          </section>
          {ActivityAside}
        </main>
      ) : (
        <main className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[1fr_360px]">
          <section className="overflow-auto rounded-lg border border-border bg-card p-6">
            <ResultPanel latest={latest} />
          </section>
          {ActivityAside}
        </main>
      )}
    </div>
  );
}
