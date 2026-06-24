"use client";
import { useShopTalk } from "../lib/useShopTalk";
import Header from "../components/Header";
import ResultPanel from "../components/ResultPanel";
import ActivityLog from "../components/ActivityLog";

export default function Dashboard() {
  const { activity, status, latest, stores } = useShopTalk();
  return (
    <div className="flex h-screen flex-col">
      <Header status={status} stores={stores} />
      <main className="grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[1fr_360px]">
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
  );
}
