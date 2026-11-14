import type { Incident } from "@surge/shared";
import { PriorityBadge } from "./PriorityBadge";
import { post } from "../lib/api";

const show = (v: unknown) => (v === null || v === undefined ? <span className="unknown">unknown</span> : String(v));

export function IncidentPanel({ inc, onClose }: { inc: Incident; onClose: () => void }) {
  const take = () => post(`/incidents/${inc.call_id}/take`, { dispatcher_id: "d1" });
  const setStatus = (status: "dispatched" | "closed") => post(`/incidents/${inc.call_id}/status`, { status });
  const facts: [string, unknown][] = [
    ["Type", inc.incident.type],
    ["People involved", inc.people.involved],
    ["Injured", inc.people.injured],
    ["Trapped", inc.people.trapped],
    ["Breathing", inc.patient.breathing],
    ["Conscious", inc.patient.conscious],
    ["Fire / smoke", inc.hazards.fire_or_smoke],
    ["Weapon", inc.hazards.weapon],
    ["Caller safe", inc.caller.caller_safe],
    ["Callback", inc.caller.phone],
    ["Language", inc.caller.language],
  ];
  return (
    <div className="panel">
      <div className="panel-head">
        <PriorityBadge p={inc.final_priority} />
        <button className="ghost" onClick={onClose}>✕</button>
      </div>
      <h2>{inc.triage.llm?.summary ?? inc.incident.description ?? "Collecting details…"}</h2>
      <p className="address">{inc.location.address ?? "Location unknown"}</p>
      <ul className="reasons">
        {inc.final_reasons.map((r) => (
          <li key={r.text}>{r.text} <span className="src">({r.source})</span></li>
        ))}
      </ul>
      <dl className="facts">
        {facts.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{show(v)}</dd></div>
        ))}
      </dl>
      {inc.nasa_context?.nearest_fire_km != null && (
        <p className="hazard">Nearest NASA fire detection: {inc.nasa_context.nearest_fire_km.toFixed(1)} km</p>
      )}
      <div className="actions">
        <button className="primary" onClick={take}>Take over call (T)</button>
        <button onClick={() => setStatus("dispatched")}>Mark dispatched</button>
        <button onClick={() => setStatus("closed")}>Close</button>
      </div>
    </div>
  );
}
