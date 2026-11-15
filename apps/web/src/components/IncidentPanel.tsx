import { useCallback, useEffect, useRef, useState } from "react";
import type { Incident } from "@surge/shared";
import { mediaUrl, post, request, type Dispatcher, type TakeResult } from "../lib/api";
import type { Takeover } from "../lib/takeover";
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
  takeover,
  others,
  onSelect,
}: {
  inc: Incident;
  onClose: () => void;
  transcript: TranscriptLine[];
  now: number;
  demo: boolean;
  connected: boolean;
  onDemoAction: (id: string, status: Incident["status"]) => void;
  takeover: Takeover;
  others: Incident[];
  onSelect: (id: string) => void;
}) {
  const [tab, setTab] = useState<"overview" | "timeline" | "transcript">("overview");
  const [reply, setReply] = useState("");
  const [ask, setAsk] = useState("");
  const [askState, setAskState] = useState<string | null>(null);
  const live = takeover.live?.callId === inc.call_id ? takeover.live : null;
  // Caller is on the Surge caller page right now: take over in the browser, no phone needed.
  const appOnline = !!inc.device?.online && inc.channel !== "phone" && inc.channel !== "unknown";
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
        setDispatcherId(list.find((d) => d.phone)?.id ?? list[0]?.id ?? "");
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
  const canTake =
    liveCall &&
    !live &&
    (demo || (connected && !!destination && (!!destination.phone || appOnline)));
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
        const text = inc.channel === "app_text";
        if (appOnline) takeover.prepare(inc.call_id, text);
        const response = await post<TakeResult & { web?: boolean }>(
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
        if (response.web) takeover.started(inc.call_id, text);
        else if (appOnline) takeover.cancel();
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
  }, [canTake, demo, onDemoAction, inc.call_id, inc.channel, dispatcherId, appOnline, takeover]);
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
            (inc.location.gps_address ? `Near ${inc.location.gps_address}` : null) ??
            inc.location.spoken ??
            "Location not confirmed"}
        </p>
        {inc.location.source !== "gps" && inc.location.geocode_confidence !== "high" && (
          <span className="location-confidence">
            {inc.location.lat == null
              ? "Not yet placed on map"
              : "Approximate location"}
          </span>
        )}
      </div>
      {inc.call_state.covert && (
        <section className="covert-banner" role="alert">
          <Icon name="shield" size={18} />
          <div>
            <strong>Covert call · caller cannot speak freely</strong>
            {inc.call_state.covert_cue && <p>Signal: {inc.call_state.covert_cue}</p>}
            <p>
              Do not call back. If you take over, speak quietly and ask yes/no
              questions. Someone may be listening.
            </p>
          </div>
        </section>
      )}
      <div
        className="inspector-tabs"
        role="tablist"
        aria-label="Call information"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const order = ["overview", "timeline", "transcript"] as const;
          const i = order.indexOf(tab);
          const next =
            event.key === "Home"
              ? "overview"
              : event.key === "End"
                ? "transcript"
                : order[(i + (event.key === "ArrowRight" ? 1 : 2)) % 3];
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
          id="timeline-tab"
          tabIndex={tab === "timeline" ? 0 : -1}
          aria-selected={tab === "timeline"}
          aria-controls="timeline-content"
          onClick={() => setTab("timeline")}
        >
          Timeline <span>{inc.timeline.length}</span>
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
              {inc.triage.llm && inc.triage.llm.units.length > 0 && (
                <div className="units-row">
                  <span>Suggested units</span>
                  {inc.triage.llm.units.map((u) => (
                    <b key={u} className={`unit-chip ${u}`}>
                      {u === "ems" ? "EMS" : u[0].toUpperCase() + u.slice(1)}
                    </b>
                  ))}
                  <small>{Math.round(inc.triage.llm.confidence * 100)}% confident</small>
                </div>
              )}
            </section>
            {inc.group && (
              <section className="detail-section group-section">
                <span className="section-eyebrow">
                  <Icon name="users" size={13} /> LIKELY SAME INCIDENT · {inc.group.size} CALLERS
                </span>
                <div className="group-calls">
                  {inc.group.call_ids
                    .filter((id) => id !== inc.call_id)
                    .map((id) => {
                      const o = others.find((x) => x.call_id === id);
                      return (
                        <button key={id} onClick={() => onSelect(id)}>
                          <span className={`mini-badge p${o?.final_priority ?? 4}`}>P{o?.final_priority ?? "?"}</span>
                          <span>
                            {o?.triage.llm?.summary ?? o?.incident.description ?? `Call #${id.slice(-6)}`}
                          </span>
                          <Icon name="chevron" size={13} />
                        </button>
                      );
                    })}
                </div>
              </section>
            )}
            {(inc.device || inc.location.gps) && (
              <section className="detail-section device-section">
                <span className="section-eyebrow">CALLER'S PHONE</span>
                <div className="device-grid">
                  <span className={`device-chip ${inc.device?.online ? "on" : ""}`}>
                    <Icon name={inc.channel === "app_text" ? "message" : "phone"} size={13} />
                    {inc.channel === "app_text"
                      ? inc.call_state.covert
                        ? "Silent text"
                        : "Text"
                      : inc.channel === "app_voice"
                        ? "Caller app"
                        : "Phone"}
                    {inc.device && (inc.device.online ? " · online" : " · offline")}
                  </span>
                  {inc.device?.battery != null && (
                    <span className={`device-chip ${inc.device.battery <= 0.15 && !inc.device.charging ? "warn" : ""}`}>
                      <Icon name="battery" size={13} />
                      {Math.round(inc.device.battery * 100)}%{inc.device.charging ? " · charging" : ""}
                    </span>
                  )}
                  {inc.device?.platform && <span className="device-chip">{inc.device.platform}</span>}
                </div>
                {inc.location.gps && (
                  <p className="gps-line">
                    <Icon name="target" size={14} />
                    <span>
                      <b>GPS ±{inc.location.gps.accuracy_m} m</b>
                      {inc.location.gps_address ? ` · near ${inc.location.gps_address}` : ""}
                      <small>
                        Updated {Math.max(0, Math.round((now - Date.parse(inc.location.gps.at)) / 1000))}s ago
                        {inc.location.source !== "gps" ? " · pin uses the reported address" : ""}
                      </small>
                    </span>
                  </p>
                )}
              </section>
            )}
            {inc.media.length > 0 && (
              <section className="detail-section">
                <span className="section-eyebrow">
                  <Icon name="camera" size={13} /> FROM THE CALLER · {inc.media.length}
                </span>
                <div className="media-grid">
                  {inc.media.map((m) => (
                    <a key={m.id} href={mediaUrl(m.url)} target="_blank" rel="noreferrer" className="media-item">
                      {m.kind === "photo" ? (
                        <img src={mediaUrl(m.url)} alt={m.caption ?? "Photo from the caller"} loading="lazy" />
                      ) : (
                        <video src={mediaUrl(m.url)} muted playsInline preload="metadata" />
                      )}
                      <span>{m.caption ?? (m.kind === "photo" ? "AI is describing the photo…" : "Video")}</span>
                    </a>
                  ))}
                </div>
              </section>
            )}
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
            {inc.nearby && (inc.nearby.fire_station || inc.nearby.hospital) && (
              <section className="detail-section">
                <span className="section-eyebrow">NEAREST</span>
                <div className="nearby">
                  {inc.nearby.fire_station && (
                    <span>
                      <Icon name="fire" size={14} />
                      {inc.nearby.fire_station.name} <b>{inc.nearby.fire_station.km} km</b>
                    </span>
                  )}
                  {inc.nearby.hospital && (
                    <span>
                      <Icon name="hospital" size={14} />
                      {inc.nearby.hospital.name} <b>{inc.nearby.hospital.km} km</b>
                    </span>
                  )}
                </div>
              </section>
            )}
            {!demo && appOnline && inc.status === "ai_on_call" && inc.call_state.stage !== "ended" && (
              <section className="detail-section">
                <span className="section-eyebrow">STEER THE AI</span>
                <form
                  className="dispatcher-chat ask-ai"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const question = ask.trim();
                    if (!question) return;
                    setAskState("Sending…");
                    try {
                      await post(`/incidents/${encodeURIComponent(inc.call_id)}/ask`, { question });
                      setAsk("");
                      setAskState("The AI will ask this next.");
                    } catch (err) {
                      setAskState((err as Error).message);
                    }
                  }}
                >
                  <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. Are there pets inside?" aria-label="Question for the AI to ask" maxLength={200} />
                  <button type="submit" disabled={!ask.trim()} aria-label="Ask">
                    <Icon name="send" size={15} />
                  </button>
                </form>
                {askState && <small className="muted">{askState}</small>}
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
        ) : tab === "timeline" ? (
          <div role="tabpanel" id="timeline-content" aria-labelledby="timeline-tab" className="timeline">
            {[...inc.timeline].reverse().map((t, i) => (
              <div className={`timeline-item ${t.kind}`} key={`${t.at}-${i}`}>
                <time>
                  {new Date(t.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </time>
                <span className="timeline-dot" />
                <p>{t.text}</p>
              </div>
            ))}
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
                      {line.role === "agent" ? "Surge assistant" : line.role === "dispatcher" ? "Dispatcher" : "Caller"}
                    </strong>
                    <time>
                      {new Date(line.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p>{line.text}</p>
                  {line.en && <p className="translation">EN · {line.en}</p>}
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
        {live && (
          <div className={`live-takeover ${live.state}`}>
            <div className="live-head">
              <span className="live-dot" />
              <b>
                {live.text
                  ? "Texting with the caller"
                  : live.state === "connected"
                    ? "Live with the caller"
                    : live.state === "connecting"
                      ? "Connecting audio…"
                      : live.state === "failed"
                        ? "Audio could not connect"
                        : "Call ended"}
              </b>
              {live.state === "connected" && (
                <time>
                  {Math.floor((now - live.startedAt) / 60000)}:
                  {String(Math.floor(((now - live.startedAt) / 1000) % 60)).padStart(2, "0")}
                </time>
              )}
            </div>
            {live.error && <p className="feed-note">{live.error}. Use the callback number or the caller's GPS.</p>}
            {live.text ? (
              <form
                className="dispatcher-chat"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (takeover.chat(reply)) setReply("");
                }}
              >
                <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type to the caller (yes/no questions)" aria-label="Message to caller" />
                <button type="submit" disabled={!reply.trim()} aria-label="Send">
                  <Icon name="send" size={15} />
                </button>
              </form>
            ) : null}
            <div className="live-buttons">
              {!live.text && live.state === "connected" && (
                <button onClick={takeover.toggleMute}>
                  <Icon name={live.muted ? "mute" : "mic"} size={14} /> {live.muted ? "Unmute" : "Mute"}
                </button>
              )}
              <button className="end" onClick={takeover.end}>
                End call
              </button>
            </div>
          </div>
        )}
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
            {(result as TakeResult & { web?: boolean }).web
              ? "Taking over in the browser. The caller's phone is switching to you."
              : result.transferred
              ? demo
                ? "Demo handoff complete. No real call was made."
                : "Call redirect accepted. Confirm the caller is connected on your phone."
              : `Live transfer failed. ${result.error ?? "Use the callback number below."}`}
          </div>
        )}
        {inc.call_state.stage === "ended" && (
          <div className="action-message">
            {inc.call_state.covert
              ? "Call ended. Do not call back: send units to the last known location."
              : inc.call_state.callback_promised
                ? "Non-urgent report. The AI collected the details, ended the call and told the caller someone will call back."
                : "Call ended. Use the callback number to reach the caller."}
          </div>
        )}
        {!demo &&
          inc.status === "taken" &&
          inc.call_state.stage !== "transferred" &&
          !result &&
          !live && (
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
                    <option key={d.id} value={d.id} disabled={!d.phone && !appOnline}>
                      {d.name}
                      {appOnline ? " · in browser" : !d.phone ? " · no phone" : ""}
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
        {inc.call_state.stage === "transferred" && !result && !live && inc.takeover?.mode !== "web" && (
          <div className="action-message success">
            Call redirected to {inc.taken_by ?? "a dispatcher"}. Confirm
            connection on the receiving phone.
          </div>
        )}
        <div className="callback-row">
          <Icon name="phone" size={13} />
          <span>Callback</span>
          {inc.call_state.covert ? (
            <span className="no-callback">
              Do not call back{inc.caller.phone ? ` · ${inc.caller.phone}` : ""}
            </span>
          ) : callback ? (
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
