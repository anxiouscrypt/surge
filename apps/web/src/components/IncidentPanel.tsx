import { useCallback, useEffect, useRef, useState } from "react";
import type { Incident } from "@surge/shared";
import { post, request, type Dispatcher, type TakeResult } from "../lib/api";
import { formatWait, type TranscriptLine } from "../lib/socket";
import { PriorityBadge } from "./PriorityBadge";
import { Icon } from "./Icon";
import { TYPE_ICON } from "../lib/presentation";

const show = (v: unknown) =>
  v == null ? (
    <span className="unknown">Unknown</span>
  ) : typeof v === "boolean" ? (
    v ? (
      "Yes"
    ) : (
      "No"
    )
  ) : (
    String(v)
  );
export function IncidentPanel({
  inc,
  onClose,
  transcript,
  now,
  demo,
  connected,
  onDemoAction,
}: {
  inc: Incident;
  onClose: () => void;
  transcript: TranscriptLine[];
  now: number;
  demo: boolean;
  connected: boolean;
  onDemoAction: (id: string, status: Incident["status"]) => void;
}) {
  const [tab, setTab] = useState<"overview" | "transcript">("overview");
  const [dispatchers, setDispatchers] = useState<Dispatcher[]>([]);
  const [dispatcherId, setDispatcherId] = useState("");
  const [dispatcherError, setDispatcherError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    if (demo) {
      setDispatcherId("demo");
      return () => {
        mounted.current = false;
      };
    }
    const controller = new AbortController();
    request<Dispatcher[]>("/dispatchers", { signal: controller.signal })
      .then((list) => {
        if (!mounted.current) return;
        if (!Array.isArray(list))
          throw new Error("Dispatcher list unavailable.");
        setDispatchers(list);
        setDispatcherId(list.find((d) => d.phone)?.id ?? "");
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setDispatcherError(
            "Could not load transfer destinations. Reopen this call to retry.",
          );
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [demo]);
  useEffect(() => {
    if (tab === "transcript")
      transcriptEnd.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
  }, [transcript.length, tab]);
  const destination = dispatchers.find((d) => d.id === dispatcherId);
  const liveCall =
    inc.call_state.stage !== "ended" &&
    inc.call_state.stage !== "transferred" &&
    inc.status !== "dispatched";
  const canTake = liveCall && (demo || (connected && !!destination?.phone));
  const take = useCallback(async () => {
    if (inFlight.current || !canTake) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (demo) {
        onDemoAction(inc.call_id, "taken");
        setResult({ ok: true, transferred: true, error: null, callback: null });
      } else {
        const response = await post<TakeResult>(
          `/incidents/${encodeURIComponent(inc.call_id)}/take`,
          { dispatcher_id: dispatcherId },
        );
        if (
          typeof response.ok !== "boolean" ||
          typeof response.transferred !== "boolean"
        )
          throw new Error(
            "The server did not confirm the transfer result. Check the receiving phone before retrying.",
          );
        if (!response.ok)
          throw new Error(response.error ?? "Could not take over this call.");
        if (mounted.current) setResult(response);
      }
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "Transfer failed. Please try again.",
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [canTake, demo, onDemoAction, inc.call_id, dispatcherId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        e.key.toLowerCase() === "t" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !target.closest("input, select, textarea, [contenteditable=true]")
      ) {
        e.preventDefault();
        void take();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [take]);
  const setStatus = async (status: "dispatched" | "closed") => {
    if (inFlight.current || (!demo && !connected)) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (demo) onDemoAction(inc.call_id, status);
      else {
        const response = await post<{ ok: boolean }>(
          `/incidents/${encodeURIComponent(inc.call_id)}/status`,
          { status },
        );
        if (!response.ok)
          throw new Error("The call status could not be updated.");
      }
      if (status === "closed") onClose();
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "Could not update call.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const callback = (result?.callback ?? inc.caller.phone)?.replace(
    /[^+\d]/g,
    "",
  );
  const facts: [string, unknown][] = [
    ["People involved", inc.people.involved],
    ["Injured", inc.people.injured],
    ["Anyone trapped", inc.people.trapped],
    ["Breathing", inc.patient.breathing],
    ["Conscious", inc.patient.conscious],
    ["Severe bleeding", inc.patient.severe_bleeding],
    ["Fire / smoke", inc.hazards.fire_or_smoke],
    ["Weapon", inc.hazards.weapon],
    ["Caller safe", inc.caller.caller_safe],
    ["Language", inc.caller.language?.toUpperCase()],
  ];
  return (
    <aside className="incident-panel glass" aria-label="Selected call details">
      <div className="inspector-head">
        <span className="section-eyebrow">
          CALL DETAILS <span>#{inc.call_id.replace(/^.*_/, "").slice(-6)}</span>
        </span>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close call details"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="inspector-summary">
        <div className="inspector-priority">
          <PriorityBadge
            p={inc.final_priority}
            collecting={!inc.incident.type && inc.final_priority === 4}
          />
          <span className="wait">
            <Icon name="clock" size={13} /> {formatWait(inc, now)}
          </span>
        </div>
        <h2>
          <Icon name={TYPE_ICON[inc.incident.type ?? "other"]} size={22} />
          {inc.incident.subtype?.replaceAll("_", " ") ??
            inc.incident.type?.replaceAll("_", " ") ??
            "Collecting details"}
        </h2>
        <p>
          <Icon name="pin" size={14} />
          {inc.location.address ??
            inc.location.spoken ??
            "Location not confirmed"}
        </p>
        {inc.location.geocode_confidence !== "high" && (
          <span className="location-confidence">
            {inc.location.lat == null
              ? "Not yet placed on map"
              : "Approximate location"}
          </span>
        )}
      </div>
      <div
        className="inspector-tabs"
        role="tablist"
        aria-label="Call information"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? "overview"
              : event.key === "End"
                ? "transcript"
                : tab === "overview"
                  ? "transcript"
                  : "overview";
          setTab(next);
          document.getElementById(`${next}-tab`)?.focus();
        }}
      >
        <button
          role="tab"
          id="overview-tab"
          tabIndex={tab === "overview" ? 0 : -1}
          aria-selected={tab === "overview"}
          aria-controls="overview-content"
          onClick={() => setTab("overview")}
        >
          Overview
        </button>
        <button
          role="tab"
          id="transcript-tab"
          tabIndex={tab === "transcript" ? 0 : -1}
          aria-selected={tab === "transcript"}
          aria-controls="transcript-content"
          onClick={() => setTab("transcript")}
        >
          Transcript <span>{transcript.length}</span>
        </button>
      </div>
      <div className="inspector-scroll">
        {tab === "overview" ? (
          <div
            role="tabpanel"
            id="overview-content"
            aria-labelledby="overview-tab"
          >
            <section className="detail-section">
              <span className="section-eyebrow">
                {inc.triage.llm ? "AI SUMMARY" : "COLLECTED DESCRIPTION"}
              </span>
              <p className="incident-description">
                {inc.triage.llm?.summary ??
                  inc.incident.description ??
                  "The assistant is collecting details. Unknown fields will appear as information arrives."}
              </p>
              {!inc.triage.llm && (
                <small className="muted">
                  AI triage has not been received.
                </small>
              )}
            </section>
            <section className="detail-section">
              <span className="section-eyebrow">WHY THIS PRIORITY</span>
              <ul className="priority-reasons">
                {inc.final_reasons.length ? (
                  inc.final_reasons.map((r) => (
                    <li key={`${r.source}:${r.text}`}>
                      <span
                        className={`reason-indicator p${inc.final_priority}`}
                      />
                      <span>
                        {r.text}
                        {r.evidence_field && (
                          <small>{r.evidence_field.replaceAll("_", " ")}</small>
                        )}
                      </span>
                      <span className="source-tag">{r.source}</span>
                    </li>
                  ))
                ) : (
                  <li className="muted">Assessment in progress</li>
                )}
              </ul>
            </section>
            {inc.triage.llm?.contradictions.length ? (
              <section className="contradictions">
                <Icon name="alert" size={16} />
                <div>
                  <strong>Needs clarification</strong>
                  {inc.triage.llm.contradictions.map((text) => (
                    <p key={text}>{text}</p>
                  ))}
                </div>
              </section>
            ) : null}
            <section className="detail-section">
              <span className="section-eyebrow">REPORTED FACTS</span>
              <dl className="facts">
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{show(value)}</dd>
                  </div>
                ))}
              </dl>
              {inc.people.vulnerable.length > 0 && (
                <p className="vulnerable">
                  Vulnerable people: {inc.people.vulnerable.join(", ")}
                </p>
              )}
            </section>
            {(inc.nasa_context?.nearest_fire_km != null ||
              inc.nasa_context?.inside_event) && (
              <section className="detail-section nasa-context">
                <span className="section-eyebrow">NASA CONTEXT</span>
                {inc.nasa_context.nearest_fire_km != null && (
                  <p>
                    <Icon name="fire" size={16} />
                    {inc.nasa_context.nearest_fire_km.toFixed(1)} km from a
                    satellite fire detection
                    {inc.nasa_context.fire_detected_minutes_ago != null
                      ? ` (${Math.round(inc.nasa_context.fire_detected_minutes_ago)}m before location check)`
                      : ""}
                  </p>
                )}
                {inc.nasa_context.inside_event && (
                  <p>{inc.nasa_context.inside_event.title}</p>
                )}
              </section>
            )}
            {inc.call_state.missing.length > 0 && (
              <section className="detail-section">
                <span className="section-eyebrow">STILL BEING COLLECTED</span>
                <div className="missing-fields">
                  {inc.call_state.missing.map((field) => (
                    <span key={field}>
                      {field.replaceAll(".", " · ").replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div
            role="tabpanel"
            id="transcript-content"
            aria-labelledby="transcript-tab"
            className="transcript"
          >
            <div className="transcript-notice">
              {demo
                ? "Sample transcript · demo call"
                : "Live lines appear as the backend sends them."}
            </div>
            {transcript.length ? (
              transcript.map((line, index) => (
                <div
                  className={`transcript-line ${line.role}`}
                  key={`${line.at}-${index}`}
                >
                  <div>
                    <strong>
                      {line.role === "agent" ? "Surge assistant" : "Caller"}
                    </strong>
                    <time>
                      {new Date(line.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p>{line.text}</p>
                </div>
              ))
            ) : (
              <p className="transcript-empty">
                No transcript lines received yet. The caller’s collected facts
                are available in Overview.
              </p>
            )}
            <div ref={transcriptEnd} />
          </div>
        )}
      </div>
      <footer className="inspector-actions">
        {error && (
          <div className="action-message error" role="alert">
            {error}
          </div>
        )}
        {result && (
          <div
            className={`action-message ${result.transferred ? "success" : "error"}`}
            role="status"
          >
            {result.transferred
              ? demo
                ? "Demo handoff complete. No real call was made."
                : "Call redirect accepted. Confirm the caller is connected on your phone."
              : `Live transfer failed. ${result.error ?? "Use the callback number below."}`}
          </div>
        )}
        {inc.call_state.stage === "ended" && (
          <div className="action-message">
            Call ended. Use the callback number to reach the caller.
          </div>
        )}
        {!demo &&
          inc.status === "taken" &&
          inc.call_state.stage !== "transferred" &&
          !result && (
            <div className="action-message error">
              Call claimed; transfer is not confirmed. Retry or use callback.
            </div>
          )}
        {liveCall && (
          <>
            <label className="transfer-destination">
              Transfer to{" "}
              {demo ? (
                <span>Demo dispatcher</span>
              ) : (
                <select
                  aria-label="Transfer destination"
                  value={dispatcherId}
                  onChange={(e) => setDispatcherId(e.target.value)}
                  disabled={busy}
                >
                  <option value="">Select dispatcher</option>
                  {dispatchers.map((d) => (
                    <option key={d.id} value={d.id} disabled={!d.phone}>
                      {d.name}
                      {!d.phone ? " · no phone" : ""}
                    </option>
                  ))}
                </select>
              )}
            </label>
            {dispatcherError && <p className="feed-note">{dispatcherError}</p>}
            <button
              className="take-button"
              onClick={() => void take()}
              disabled={!canTake || busy}
            >
              <Icon name="phone" size={17} />
              {busy
                ? "Working…"
                : inc.status === "taken"
                  ? "Retry live transfer"
                  : "Take over call"}
              <kbd>T</kbd>
            </button>
            {!demo && !connected && (
              <p className="feed-note">
                Reconnect to the call feed before taking action.
              </p>
            )}
          </>
        )}
        {inc.call_state.stage === "transferred" && !result && (
          <div className="action-message success">
            Call redirected to {inc.taken_by ?? "a dispatcher"}. Confirm
            connection on the receiving phone.
          </div>
        )}
        <div className="callback-row">
          <Icon name="phone" size={13} />
          <span>Callback</span>
          {callback ? (
            demo ? (
              <span>{inc.caller.phone} · demo</span>
            ) : (
              <a href={`tel:${callback}`}>{inc.caller.phone}</a>
            )
          ) : (
            <span className="unknown">Not collected</span>
          )}
        </div>
        <div className="secondary-actions">
          <button
            disabled={
              busy || (!demo && !connected) || inc.status === "dispatched"
            }
            onClick={() => void setStatus("dispatched")}
          >
            <Icon name="check" size={14} />
            Mark dispatched
          </button>
          <button
            disabled={busy || (!demo && !connected)}
            onClick={() => void setStatus("closed")}
          >
            Close incident
          </button>
        </div>
      </footer>
    </aside>
  );
}
