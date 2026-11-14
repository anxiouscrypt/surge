import { useEffect, useState } from "react";
import type { Incident, ServerEvent } from "@surge/shared";
import { WS_URL } from "./api";
import { mockIncidents } from "./mock";

/** Live incidents keyed by call_id. Falls back to mock data if the API is not reachable. */
export function useIncidents() {
  const [incidents, setIncidents] = useState<Record<string, Incident>>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket;
    let lastSeq = 0;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => {
        if (import.meta.env.DEV) setIncidents((cur) => (Object.keys(cur).length ? cur : byId(mockIncidents())));
      };
      ws.onmessage = (msg) => {
        const e = JSON.parse(msg.data) as ServerEvent;
        if (e.type === "snapshot") {
          lastSeq = e.seq;
          setIncidents(byId(e.incidents));
          return;
        }
        if (e.seq <= lastSeq) return; // out of order
        lastSeq = e.seq;
        if (e.type === "incident.upsert") setIncidents((cur) => ({ ...cur, [e.incident.call_id]: e.incident }));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return { incidents: Object.values(incidents).filter((i) => i.status !== "closed"), connected };
}

const byId = (list: Incident[]) => Object.fromEntries(list.map((i) => [i.call_id, i]));

export const waitMinutes = (i: Incident, now = Date.now()) => (now - Date.parse(i.received_at)) / 60000;

/** Priority first, then score + 1 per minute waiting. */
export function sortQueue(list: Incident[], now = Date.now()): Incident[] {
  return [...list].sort(
    (a, b) => a.final_priority - b.final_priority || b.score + waitMinutes(b, now) - (a.score + waitMinutes(a, now)),
  );
}
