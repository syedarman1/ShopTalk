"use client";

import { useState } from "react";
import { useMockbase } from "@/lib/useMockbase";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { DataTable } from "@/components/DataTable";
import { ActivityLog } from "@/components/ActivityLog";

export default function Dashboard() {
  const {
    tables,
    selectedTable,
    selectedSchema,
    selectTable,
    rows,
    loadingRows,
    activity,
    status,
    lastEventTable,
    seed,
    refresh,
  } = useMockbase();

  const [seeding, setSeeding] = useState(false);
  const handleSeed = async () => {
    setSeeding(true);
    await seed();
    setTimeout(() => setSeeding(false), 600);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        tables={tables}
        selectedTable={selectedTable}
        onSelect={selectTable}
        lastEventTable={lastEventTable}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          status={status}
          onSeed={handleSeed}
          onRefresh={refresh}
          seeding={seeding}
        />

        <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-3">
          <div className="flex min-h-0 flex-col lg:col-span-2">
            <DataTable
              table={selectedTable}
              schema={selectedSchema}
              rows={rows}
              loading={loadingRows}
            />
          </div>
          <div className="flex min-h-0 flex-col lg:col-span-1">
            <ActivityLog activity={activity} status={status} />
          </div>
        </main>
      </div>
    </div>
  );
}
