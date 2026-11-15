import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTakeover } from "../lib/takeover";
import { alertsMuted, chime, setAlertsMuted } from "../lib/alert";
import { DemoTools } from "../components/DemoTools";
import { MapView, type MapRequest } from "../components/MapView";
import { HOME } from "../lib/presentation";
import { QueueCard } from "../components/QueueCard";
import { IncidentPanel } from "../components/IncidentPanel";
import { StatusBar } from "../components/StatusBar";
import { NasaControls } from "../components/NasaControls";
import { Icon } from "../components/Icon";
import { sortQueue, useIncidents } from "../lib/socket";
import { ageLabel, useNasa, type Layers, type NaturalEvent } from "../lib/nasa";

import type { MapBounds } from "../lib/nasaLinks";

const NO_LINES: never[] = [];
export default function Dashboard() {
  const [demo] = useState(
    () => new URLSearchParams(window.location.search).get("demo") === "1",
  );
  const { incidents, transcripts, connection, lastUpdate, updateDemo } =
    useIncidents(demo);
  const [bounds, setBounds] = useState<MapBounds | null>([
    -84.13, 42.07, -83.54, 42.43,
  ]);
  const onBounds = useCallback(
    (next: MapBounds | null) =>
      setBounds((previous) =>
        previous?.join(",") === next?.join(",") ? previous : next,
      ),
    [],
  );
  const nasa = useNasa(bounds);
  const takeover = useTakeover();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [muted, setMuted] = useState(alertsMuted);
  const [toasts, setToasts] = useState<{ id: string; callId: string; text: string }[]>([]);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const seenPriority = useRef<Map<string, number> | null>(null);
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"waiting" | "taken">("waiting");
  const [search, setSearch] = useState("");
  const [queueOpen, setQueueOpen] = useState(true);
  const [follow, setFollow] = useState(false);
  const [layers, setLayers] = useState<Layers>({
    fires: true,
    events: true,
    imagery: false,
  });
  const [chosenDate, setChosenDate] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<NaturalEvent | null>(null);
  const [region, setRegion] = useState("Washtenaw County, MI");
  const [mapRequest, setMapRequest] = useState<MapRequest | null>(null);
  const waiting = incidents.filter(
    (i) => i.status === "ai_on_call" || i.status === "waiting",
  );
  const taken = incidents.filter(
    (i) => i.status === "taken" || i.status === "dispatched",
  );
  const source = filter === "waiting" ? waiting : taken;
  const query = search.toLowerCase().trim();
  const queue = useMemo(
    () =>
      sortQueue(
        source.filter(
          (i) =>
            !query ||
            [
              i.call_id,
              i.location.address,
              i.incident.type,
              i.incident.description,
              i.triage.llm?.summary,
              i.caller.language,
            ].some((value) => value?.toLowerCase().includes(query)),
        ),
        now,
      ),
    [incidents, filter, query, now],
  );
  const current = incidents.find((i) => i.call_id === selected) ?? null;
  // New P1 (a new call, or one that just became P1): chime, flash the card, show a toast.
  useEffect(() => {
    if (!demo && connection !== "live") return;
    const prev = seenPriority.current;
    const next = new Map(incidents.map((i) => [i.call_id, i.final_priority]));
    seenPriority.current = next;
    if (!prev) return; // first load: no alerts for calls already on screen
    const fresh = incidents.filter(
      (i) => i.final_priority === 1 && prev.get(i.call_id) !== 1 && (i.status === "ai_on_call" || i.status === "waiting"),
    );
    if (!fresh.length) return;
    chime();
    setFlash((cur) => new Set([...cur, ...fresh.map((i) => i.call_id)]));
    setToasts((cur) => [
      ...cur.slice(-2),
      ...fresh.map((i) => ({
        id: `${i.call_id}-${Date.now()}`,
        callId: i.call_id,
        text: `${p1Reason(i)}${i.location.address || i.location.gps_address ? ` · ${i.location.address ?? i.location.gps_address}` : ""}`,
      })),
    ]);
    const ids = fresh.map((i) => i.call_id);
    setTimeout(() => setFlash((cur) => new Set([...cur].filter((x) => !ids.includes(x)))), 6000);
    setTimeout(() => setToasts((cur) => cur.filter((t) => !ids.includes(t.callId))), 9000);
  }, [incidents, connection, demo]);
  const onSelect = useCallback((id: string) => {
    setSelected(id);
    setSelectedEvent(null);
  }, []);
  const yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
  const imageryDate =
    chosenDate ||
    (nasa.imagery.data
      ? nasa.imagery.data < yesterday
        ? nasa.imagery.data
        : yesterday
      : "");
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        (e.target as HTMLElement).closest(
          "input, select, textarea, [contenteditable=true]",
        )
      )
        return;
      const key = e.key.toLowerCase();
      const idx = queue.findIndex((i) => i.call_id === selected);
      if (key === "j" || key === "k") {
        e.preventDefault();
        const next =
          key === "j"
            ? Math.min(queue.length - 1, idx + 1)
            : idx < 0
              ? 0
              : Math.max(0, idx - 1);
        if (queue[next]) onSelect(queue[next].call_id);
      }
      if (
        e.key === "Enter" &&
        !selected &&
        queue[0] &&
        e.target === document.body
      )
        onSelect(queue[0].call_id);
      if (e.key === "Escape") {
        setSelected(null);
        setSelectedEvent(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queue, selected, onSelect]);
  const home = () => {
    setSelected(null);
    setSelectedEvent(null);
    setRegion("Washtenaw County, MI");
    setMapRequest({ key: Date.now(), center: HOME, zoom: 12.2 });
  };
  const showEvent = (event: NaturalEvent) => {
    setSelected(null);
    setSelectedEvent(event);
    setRegion(event.title);
    setLayers((previous) => ({ ...previous, events: true }));
    setMapRequest({ key: Date.now(), center: event.center, zoom: 8 });
  };
  const unlocated = waiting.filter(
    (i) => i.location.lat == null || i.location.lng == null,
  ).length;
  const urgent = waiting.filter((i) => i.final_priority === 1).length;
  return (
    <div
      className={`app${demo ? " demo-mode" : ""}${current ? " has-inspector" : ""}`}
    >
      <StatusBar
        incidents={incidents}
        connection={connection}
        now={now}
        demo={demo}
        muted={muted}
        onMute={() => {
          setAlertsMuted(!muted);
          setMuted(!muted);
        }}
        onTools={() => setToolsOpen(true)}
      />
      {toolsOpen && <DemoTools demo={demo} onClose={() => setToolsOpen(false)} />}
      <div className="toasts" aria-live="assertive">
        {toasts.map((t) => (
          <button
            key={t.id}
            className="toast p1"
            onClick={() => {
              onSelect(t.callId);
              setToasts((cur) => cur.filter((x) => x.id !== t.id));
            }}
          >
            <span className="toast-badge">P1</span>
            <span>
              <b>New immediate call</b>
              <small>{t.text}</small>
            </span>
          </button>
        ))}
        {takeover.live && takeover.live.callId !== selected && (
          <button className="toast live" onClick={() => onSelect(takeover.live!.callId)}>
            <span className="live-dot" />
            <span>
              <b>{takeover.live.text ? "Texting with a caller" : "On a live call"}</b>
              <small>Open the call</small>
            </span>
          </button>
        )}
      </div>
      <main className="workspace">
        <MapView
          incidents={incidents}
          selected={current?.call_id ?? null}
          onSelect={onSelect}
          events={nasa.events.data}
          fires={nasa.fires.data}
          layers={layers}
          imageryDate={imageryDate}
          request={mapRequest}
          follow={follow}
          panelOpen={!!current}
          onBounds={onBounds}
          onEvent={showEvent}
        />
        <div className="map-context">
          <span className="section-eyebrow">
            {selectedEvent ? "ACTIVE NASA EVENT" : "AREA OF OPERATIONS"}
          </span>
          <span>{region}</span>
        </div>
        <div className={`queue-shell${queueOpen ? "" : " is-collapsed"}`}>
          <section
            className="call-queue glass"
            aria-label="Overflow call queue"
          >
            <div className="queue-heading">
              <div>
                <span className="section-eyebrow">SURGE OVERFLOW</span>
                <h1>
                  Every call, in view<span className="accent-period">.</span>
                </h1>
              </div>
              <button
                className="icon-button queue-toggle"
                onClick={() => setQueueOpen(!queueOpen)}
                aria-label={
                  queueOpen ? "Collapse call queue" : "Expand call queue"
                }
                aria-expanded={queueOpen}
              >
                <Icon name={queueOpen ? "minus" : "plus"} />
              </button>
            </div>
            <div className="queue-body">
              <div className="queue-tabs" aria-label="Call status filter">
                <button
                  aria-pressed={filter === "waiting"}
                  onClick={() => setFilter("waiting")}
                >
                  Waiting <span>{waiting.length}</span>
                </button>
                <button
                  aria-pressed={filter === "taken"}
                  onClick={() => setFilter("taken")}
                >
                  Taken / dispatched <span>{taken.length}</span>
                </button>
              </div>
              <div className="queue-search">
                <Icon name="search" size={15} />
                <input
                  aria-label="Search calls"
                  placeholder="Find a caller, address, or incident"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    className="icon-button"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                  >
                    <Icon name="close" size={13} />
                  </button>
                )}
              </div>
              <div className="queue-count">
                <span>
                  {filter === "waiting" ? "PRIORITY ORDER" : "CLAIMED CALLS"}
                </span>
                <span>
                  {unlocated > 0
                    ? `${unlocated} awaiting location`
                    : "All callers located"}
                </span>
              </div>
              <div className="queue-cards">
                {queue.length ? (
                  queue.map((inc) => (
                    <QueueCard
                      key={inc.call_id}
                      inc={inc}
                      now={now}
                      selected={inc.call_id === selected}
                      flash={flash.has(inc.call_id)}
                      onClick={() => onSelect(inc.call_id)}
                    />
                  ))
                ) : (
                  <div className="empty-state">
                    <span className="empty-orbit">
                      <Icon name={search ? "search" : "phone"} size={28} />
                    </span>
                    <h2>
                      {search
                        ? "No matching calls"
                        : !demo && connection !== "live"
                          ? "Waiting for the call feed"
                          : filter === "taken"
                            ? "No calls taken yet"
                            : "No waiting callers"}
                    </h2>
                    <p>
                      {search
                        ? "Try an address, incident type, or call ID."
                        : !demo && connection !== "live"
                          ? "Calls will appear when the backend connects. You can explore sample calls in demo mode."
                          : "New overflow calls will appear here and on the map."}
                    </p>
                    {!demo && connection !== "live" && (
                      <a className="text-action" href="?demo=1">
                        Explore the demo <Icon name="arrow" size={14} />
                      </a>
                    )}
                  </div>
                )}
              </div>
              <div className="queue-footer">
                <span>
                  <span
                    className={`status-dot${urgent ? " urgent-dot" : " muted-dot"}`}
                  />
                  {urgent
                    ? `${urgent} immediate ${urgent === 1 ? "call" : "calls"}`
                    : "No immediate calls"}
                </span>
                <span>
                  <kbd>J</kbd>
                  <kbd>K</kbd> navigate
                </span>
              </div>
            </div>
          </section>
          {!demo && connection !== "live" && (
            <div className="feed-banner glass" role="status">
              <Icon name="signal" size={16} />
              <span>
                <strong>
                  {connection === "connecting"
                    ? "Connecting to call feed"
                    : "Call feed disconnected"}
                </strong>
                <small>
                  {lastUpdate
                    ? `Showing last confirmed state · ${ageLabel(lastUpdate, now)}. Reconnecting…`
                    : "Reconnecting automatically. No live calls received."}
                </small>
              </span>
            </div>
          )}
          {demo && (
            <div className="demo-banner glass">
              <span className="demo-label">DEMO</span>
              <span>
                Sample callers. NASA layers use real feeds.
                <br />
                <small>Call actions are simulated locally.</small>
              </span>
            </div>
          )}
        </div>
        {!current && (
          <NasaControls
            bounds={bounds}
            events={nasa.events}
            fires={nasa.fires}
            imagery={nasa.imagery}
            layers={layers}
            setLayers={setLayers}
            date={imageryDate}
            setDate={setChosenDate}
            onEvent={showEvent}
            selectedEvent={selectedEvent}
            onCloseEvent={() => setSelectedEvent(null)}
            now={now}
          />
        )}
        <div className="map-tools glass">
          <button onClick={home}>
            <Icon name="target" size={16} />
            Home region
          </button>
          <button
            onClick={() => {
              setSelected(null);
              setMapRequest({ key: Date.now(), fit: true });
              setRegion("Caller locations");
            }}
            disabled={!incidents.some((i) => i.location.lat != null)}
          >
            <Icon name="pin" size={16} />
            Fit callers
          </button>
          <button
            className={follow ? "is-following" : ""}
            aria-pressed={follow}
            onClick={() => setFollow(!follow)}
            title="Automatically center the map when a call becomes P1"
          >
            <Icon name="wave" size={16} />
            Follow P1
          </button>
        </div>
        {current && (
          <IncidentPanel
            key={current.call_id}
            inc={current}
            transcript={transcripts[current.call_id] ?? NO_LINES}
            now={now}
            demo={demo}
            connected={connection === "live"}
            onDemoAction={updateDemo}
            onClose={() => setSelected(null)}
            takeover={takeover}
            others={incidents}
            onSelect={onSelect}
          />
        )}
        <div className="map-legend glass" aria-label="Map legend">
          <span className="legend-title">CALL PRIORITY</span>
          <span>
            <i className="legend-dot immediate" />
            P1 Immediate
          </span>
          <span>
            <i className="legend-dot urgent" />
            P2 Urgent
          </span>
          <span>
            <i className="legend-dot standard" />
            P3 Standard
          </span>
          <span>
            <i className="legend-dot low" />
            P4 Low / unassessed
          </span>
          {layers.fires && (
            <span className="nasa-legend">
              <i className="legend-diamond" />
              Fire detection
            </span>
          )}
          {layers.events && (
            <span className="nasa-legend">
              <i className="legend-dot event" />
              NASA event
            </span>
          )}
        </div>
        {layers.imagery && (
          <div className="imagery-label glass">
            <Icon name="layers" size={14} />
            VIIRS NOAA-20 <span>{imageryDate} UTC</span>
          </div>
        )}
      </main>
      <span className="sr-only" aria-live="polite">
        {urgent} immediate calls. {waiting.length} waiting callers.
      </span>
    </div>
  );
}

/** The reason that made the call P1 (rules first, then the AI), for the alert toast. */
function p1Reason(i: import("@surge/shared").Incident) {
  const { rules, llm } = i.triage;
  if (rules?.priority === 1) return rules.reasons[0]?.text ?? "Immediate threat";
  if (llm?.priority === 1) return llm.reasons[0]?.text ?? llm.summary;
  return i.final_reasons[0]?.text ?? "Immediate threat";
}
