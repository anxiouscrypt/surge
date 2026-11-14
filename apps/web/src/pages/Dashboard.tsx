import { useCallback, useEffect, useMemo, useState } from "react";
import { MapView } from "../components/MapView";
import { QueueCard } from "../components/QueueCard";
import { IncidentPanel } from "../components/IncidentPanel";
import { StatusBar } from "../components/StatusBar";
import { sortQueue, useIncidents } from "../lib/socket";
import { post } from "../lib/api";

export default function Dashboard() {
  const { incidents, connected } = useIncidents();
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const queue = useMemo(() => sortQueue(incidents, now), [incidents, now]);
  const current = queue.find((i) => i.call_id === selected) ?? null;
  const onSelect = useCallback((id: string) => setSelected(id), []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Keyboard: J/K move, Enter open, T take over, Esc close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const idx = queue.findIndex((i) => i.call_id === selected);
      if (e.key === "j") setSelected(queue[Math.min(queue.length - 1, idx + 1)]?.call_id ?? null);
      if (e.key === "k") setSelected(queue[Math.max(0, idx - 1)]?.call_id ?? null);
      if (e.key === "Enter" && !selected && queue[0]) setSelected(queue[0].call_id);
      if (e.key === "Escape") setSelected(null);
      if (e.key === "t" && selected) void post(`/incidents/${selected}/take`, { dispatcher_id: "d1" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queue, selected]);

  return (
    <div className="app">
      <StatusBar incidents={incidents} connected={connected} now={now} />
      <main className="layout">
        <MapView incidents={queue} onSelect={onSelect} />
        <aside className="queue">
          {current ? (
            <IncidentPanel inc={current} onClose={() => setSelected(null)} />
          ) : queue.length ? (
            queue.map((inc) => (
              <QueueCard key={inc.call_id} inc={inc} now={now} selected={inc.call_id === selected} onClick={() => setSelected(inc.call_id)} />
            ))
          ) : (
            <p className="empty">No waiting calls</p>
          )}
        </aside>
      </main>
    </div>
  );
}
