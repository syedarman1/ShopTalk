"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "./utils";

let activityId = 0;

// Central hook that wires the dashboard to the backend:
//  - pulls table schemas + the selected table's rows over REST
//  - holds an EventSource open to /api/events and reacts to every mutation
//  - keeps a rolling activity log of incoming MCP traffic
export function useMockbase() {
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [rows, setRows] = useState([]);
  const [activity, setActivity] = useState([]);
  const [status, setStatus] = useState("connecting"); // connecting | live | offline
  const [loadingRows, setLoadingRows] = useState(false);
  const [lastEventTable, setLastEventTable] = useState(null);

  // Keep the latest selectedTable available inside the SSE callback without
  // re-subscribing the stream every time the selection changes.
  const selectedRef = useRef(selectedTable);
  selectedRef.current = selectedTable;

  const fetchTables = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tables`);
      const json = await res.json();
      const list = json.tables || [];
      setTables(list);
      // Auto-select the first table once data exists.
      setSelectedTable((cur) => {
        if (cur && list.some((t) => t.name === cur)) return cur;
        return list[0]?.name ?? null;
      });
      return list;
    } catch {
      setStatus("offline");
      return [];
    }
  }, []);

  const fetchRows = useCallback(async (table) => {
    if (!table) {
      setRows([]);
      return;
    }
    setLoadingRows(true);
    try {
      const res = await fetch(`${API_BASE}/api/data/${table}`);
      const json = await res.json();
      setRows(json.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
  }, []);

  const pushActivity = useCallback((event) => {
    setActivity((prev) => {
      const entry = { id: ++activityId, ...event };
      // Cap the log so it can't grow unbounded.
      return [entry, ...prev].slice(0, 100);
    });
  }, []);

  // Initial load.
  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  // Refetch rows whenever the selection changes.
  useEffect(() => {
    fetchRows(selectedTable);
  }, [selectedTable, fetchRows]);

  // Live stream — with a heartbeat watchdog so the status pill is truthful.
  // The server emits a ping event every 25s; if nothing arrives for 60s the
  // connection is a zombie (sleep, dropped proxy) and we reconnect.
  useEffect(() => {
    let source = null;
    let lastSeen = Date.now();
    let disposed = false;

    const handleMessage = (e) => {
      lastSeen = Date.now();
      let event;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }

      if (event.type === "ping") return; // heartbeat only — never logged

      if (event.type === "connected") {
        setStatus("live");
        return;
      }

      // Log everything that isn't a heartbeat.
      pushActivity(event);

      // Flash the affected table in the sidebar briefly.
      if (event.table) {
        setLastEventTable(event.table);
        setTimeout(() => setLastEventTable(null), 1200);
      }

      // Mutations change schema/rows — refresh the relevant views.
      const MUTATIONS = [
        "table_created",
        "column_added",
        "row_inserted",
        "row_updated",
        "row_deleted",
        "table_dropped",
        "reset",
        "seed",
      ];
      if (MUTATIONS.includes(event.type)) {
        fetchTables();
        const current = selectedRef.current;
        // For a dropped table, fetchTables() re-points the selection and the
        // selection effect refetches rows — fetching the dead table here would
        // just 400.
        if (
          event.type !== "table_dropped" &&
          (!event.table || event.table === current || !current)
        ) {
          fetchRows(current ?? event.table);
        }
      }
    };

    const connect = () => {
      if (disposed) return;
      source?.close();
      lastSeen = Date.now();
      source = new EventSource(`${API_BASE}/api/events`);
      source.onopen = () => {
        lastSeen = Date.now();
        setStatus("live");
        // Catch up on anything that changed while we were disconnected.
        fetchTables();
        fetchRows(selectedRef.current);
      };
      source.onmessage = handleMessage;
      // EventSource retries on its own; reflect the truth meanwhile.
      source.onerror = () => setStatus("offline");
    };

    connect();

    // Zombie detection: the server pings every 25s, so 60s of silence means
    // the socket is dead even if the browser hasn't noticed (sleep, dropped
    // proxy). Force a fresh connection.
    const watchdog = setInterval(() => {
      if (Date.now() - lastSeen > 60000) {
        setStatus("offline");
        connect();
      }
    }, 10000);

    const onOnline = () => connect();
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      disposed = true;
      clearInterval(watchdog);
      source?.close();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [fetchTables, fetchRows, pushActivity]);

  const seed = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/seed`, { method: "POST" });
      // The SSE event will trigger the refresh; nothing else to do here.
    } catch {
      /* surfaced via status pill */
    }
  }, []);

  const selectTable = useCallback((name) => setSelectedTable(name), []);

  const selectedSchema = tables.find((t) => t.name === selectedTable) || null;

  return {
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
    refresh: () => {
      fetchTables();
      fetchRows(selectedRef.current);
    },
  };
}
