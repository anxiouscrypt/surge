import type { Incident } from "@surge/shared";
import { PriorityBadge } from "./PriorityBadge";
import { waitMinutes } from "../lib/socket";

export function QueueCard({ inc, selected, onClick, now }: { inc: Incident; selected: boolean; onClick: () => void; now: number }) {
  const w = waitMinutes(inc, now);
  const summary = inc.triage.llm?.summary ?? inc.incident.description ?? "Collecting details…";
  return (
    <button className={`card p${inc.final_priority} ${selected ? "selected" : ""}`} onClick={onClick}>
      <div className="card-top">
        <PriorityBadge p={inc.final_priority} />
        {inc.status === "ai_on_call" && <span className="ai-live">● AI on call</span>}
        <span className="wait">{Math.floor(w)}:{String(Math.floor((w % 1) * 60)).padStart(2, "0")}</span>
      </div>
      <div className="summary">{summary}</div>
      <div className="address">{inc.location.address ?? <span className="unknown">Location unknown</span>}</div>
      <div className="chips">
        {inc.final_reasons.slice(0, 3).map((r) => (
          <span key={r.text} className="chip">{r.text}</span>
        ))}
      </div>
    </button>
  );
}
