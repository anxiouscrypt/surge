import { useEffect, useState } from "react";
import { Incident as IncidentSchema, type Incident } from "@surge/shared";
import { WS_URL } from "./api";
import { mockIncidents, mockTranscripts } from "./mock";

export type TranscriptLine = {
  role: "agent" | "caller";
  text: string;
  at: string;
};
export type Connection = "connecting" | "live" | "reconnecting" | "offline";
const byId = (list: Incident[]) =>
  Object.fromEntries(list.map((i) => [i.call_id, i]));

/** Demo mode is explicit and never opens a live socket or sends call actions. */
export function useIncidents(demo: boolean) {
  const [incidents, setIncidents] = useState<Record<string, Incident>>(() =>
    demo ? byId(mockIncidents()) : {},
  );
  const [transcripts, setTranscripts] = useState<
    Record<string, TranscriptLine[]>
  >(() => (demo ? mockTranscripts() : {}));
  const [connection, setConnection] = useState<Connection>("connecting");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  useEffect(() => {
    if (demo) return;
    let ws: WebSocket | undefined;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    let snapshotTimer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const connect = () => {
      if (stopped) return;
      setConnection(attempts ? "reconnecting" : "connecting");
      let lastSeq = -1;
      let receivedSnapshot = false;
      ws = new WebSocket(WS_URL);
      const socket = ws;
      snapshotTimer = setTimeout(() => socket.close(), 12000);
      socket.onclose = () => {
        clearTimeout(snapshotTimer);
        if (stopped) return;
        attempts++;
        setConnection(attempts > 2 ? "offline" : "reconnecting");
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempts, 10000));
      };
      socket.onerror = () => socket.close();
      socket.onmessage = (msg) => {
        if (stopped) return;
        try {
          const e = JSON.parse(msg.data);
          if (!Number.isSafeInteger(e.seq)) return;
          if (e.type === "snapshot") {
            if (receivedSnapshot && e.seq <= lastSeq) return;
            const parsed = IncidentSchema.array().safeParse(e.incidents);
            if (!parsed.success) return;
            lastSeq = e.seq;
            receivedSnapshot = true;
            attempts = 0;
            clearTimeout(snapshotTimer);
            setIncidents(byId(parsed.data));
            setConnection("live");
            setLastUpdate(Date.now());
            return;
          }
          if (!receivedSnapshot || e.seq <= lastSeq) return;
          if (e.type === "incident.upsert") {
            const parsed = IncidentSchema.safeParse(e.incident);
            if (!parsed.success) return;
            setIncidents((cur) => ({
              ...cur,
              [parsed.data.call_id]: parsed.data,
            }));
          } else if (
            e.type === "call.transcript" &&
            typeof e.call_id === "string" &&
            (e.role === "agent" || e.role === "caller") &&
            typeof e.text === "string" &&
            typeof e.at === "string"
          ) {
            setTranscripts((cur) => ({
              ...cur,
              [e.call_id]: [
                ...(cur[e.call_id] ?? []),
                { role: e.role, text: e.text, at: e.at },
              ].slice(-300),
            }));
          } else if (e.type === "call.ended" && typeof e.call_id === "string") {
            setIncidents((cur) => {
              const inc = cur[e.call_id];
              if (!inc || inc.call_state.stage === "transferred") return cur;
              return {
                ...cur,
                [e.call_id]: {
                  ...inc,
                  status: inc.status === "ai_on_call" ? "waiting" : inc.status,
                  call_state: { ...inc.call_state, stage: "ended" },
                },
              };
            });
          } else return;
          lastSeq = e.seq;
          setLastUpdate(Date.now());
        } catch {
          /* Retain the last validated state on malformed messages. */
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(snapshotTimer);
      ws?.close();
    };
  }, [demo]);
  const updateDemo = (id: string, status: Incident["status"]) => {
    if (!demo) return;
    setIncidents((cur) => {
      const inc = cur[id];
      return inc
        ? {
            ...cur,
            [id]: {
              ...inc,
              status,
              taken_by: status === "taken" ? "demo" : inc.taken_by,
              call_state: {
                ...inc.call_state,
                stage:
                  status === "taken" ? "transferred" : inc.call_state.stage,
              },
            },
          }
        : cur;
    });
  };
  return {
    incidents: Object.values(incidents).filter((i) => i.status !== "closed"),
    transcripts,
    connection,
    lastUpdate,
    updateDemo,
  };
}
export const waitMinutes = (i: Incident, now = Date.now()) =>
  Math.max(0, (now - Date.parse(i.received_at)) / 60000);
export function formatWait(i: Incident, now = Date.now()): string {
  const seconds = Math.floor(waitMinutes(i, now) * 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function sortQueue(list: Incident[], now = Date.now()): Incident[] {
  return [...list].sort(
    (a, b) =>
      a.final_priority - b.final_priority ||
      b.score + waitMinutes(b, now) - (a.score + waitMinutes(a, now)),
  );
}
