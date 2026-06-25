"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "./utils";

const RESULT_TYPES = ["stores", "sales", "orders", "order", "products", "customers"];

export function useShopTalk() {
  const [activity, setActivity] = useState([]);
  const [status, setStatus] = useState("connecting");
  const [latest, setLatest] = useState(null);
  const [stores, setStores] = useState([]);
  const lastSeen = useRef(Date.now());
  const idRef = useRef(0); // monotonic — unique keys even when the feed is at its cap
  const sourceRef = useRef(null);

  const fetchStores = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/stores`);
      const data = await res.json();
      setStores(data.stores ?? []);
    } catch {
      /* dashboard tolerates store list being unavailable */
    }
  }, []);

  const connect = useCallback(() => {
    lastSeen.current = Date.now();
    sourceRef.current?.close();
    const token = process.env.NEXT_PUBLIC_DASHBOARD_TOKEN;
    const url = token
      ? `${API_BASE}/api/events?token=${encodeURIComponent(token)}`
      : `${API_BASE}/api/events`;
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => {
      lastSeen.current = Date.now();
      setStatus("live");
      fetchStores();
    };
    source.onmessage = (e) => {
      lastSeen.current = Date.now();
      let event;
      try {
        event = JSON.parse(e.data);
      } catch {
        return;
      }
      if (event.type === "ping") return;
      if (event.type === "connected") {
        setStatus("live");
        return;
      }
      setActivity((prev) => [{ id: idRef.current++, ...event }, ...prev].slice(0, 100));
      if (RESULT_TYPES.includes(event.type)) setLatest(event);
    };
    source.onerror = () => setStatus("offline");
  }, [fetchStores]);

  useEffect(() => {
    connect();
    const watchdog = setInterval(() => {
      if (Date.now() - lastSeen.current > 60000) {
        setStatus("offline");
        connect();
      }
    }, 10000);
    const onOnline = () => connect();
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      clearInterval(watchdog);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      sourceRef.current?.close();
    };
  }, [connect]);

  return { activity, status, latest, stores };
}
