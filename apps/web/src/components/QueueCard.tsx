import type { Incident } from "@surge/shared";
import { PriorityBadge } from "./PriorityBadge";
import { formatWait } from "../lib/socket";
import { Icon } from "./Icon";
import { TYPE_ICON } from "../lib/presentation";

export function QueueCard({
  inc,
  selected,
  onClick,
  now,
  flash = false,
}: {
  inc: Incident;
  selected: boolean;
  onClick: () => void;
  now: number;
  flash?: boolean;
}) {
  const collecting = !inc.incident.type && inc.final_priority === 4;
  const active =
    inc.status === "ai_on_call" && inc.call_state.stage !== "ended";
  return (
    <button
      className={`call-card priority-${inc.final_priority}${inc.call_state.covert ? " covert" : ""}${selected ? " selected" : ""}${flash ? " flash" : ""}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      <span className="card-top">
        <span className="call-number">
          #{inc.call_id.replace(/^.*_/, "").slice(-6)}
        </span>
        <span className="card-call-state">
          {active ? (
            <>
              <span className="tiny-wave">
                <i />
                <i />
                <i />
              </span>
              AI on call
            </>
          ) : inc.call_state.stage === "ended" ? (
            inc.call_state.callback_promised ? "Call back" : "Call ended"
          ) : inc.status === "taken" ? (
            inc.call_state.stage === "transferred" ? (
              "Transferred"
            ) : (
              "Claimed"
            )
          ) : inc.status === "dispatched" ? (
            "Dispatched"
          ) : (
            "Waiting"
          )}
        </span>
        <span className="wait">{formatWait(inc, now)}</span>
      </span>
      <span className="card-title">
        <span className={`incident-icon p${inc.final_priority}`}>
          <Icon name={TYPE_ICON[inc.incident.type ?? "other"]} size={17} />
        </span>
        <span>
          {inc.incident.subtype?.replaceAll("_", " ") ??
            inc.incident.type?.replaceAll("_", " ") ??
            "Locating caller"}
        </span>
        <Icon name="chevron" size={14} />
      </span>
      {inc.call_state.covert && (
        <span className="covert-chip">
          <Icon name="shield" size={12} />
          Caller can't talk · do not call back
        </span>
      )}
      {inc.call_state.callback_promised && (
        <span className="callback-chip">
          <Icon name="phone" size={12} />
          {inc.call_state.stage === "ended"
            ? "AI closed report · callback promised"
            : "Non-urgent · AI will close and promise callback"}
        </span>
      )}
      <span className="card-description">
        {inc.triage.llm?.summary ??
          inc.incident.description ??
          "Collecting emergency details…"}
      </span>
      <span
        className={`card-location${inc.location.lat == null ? " location-pending" : ""}`}
      >
        <Icon name="pin" size={13} />
        <span>
          {inc.location.address ??
            (inc.location.gps_address ? `Near ${inc.location.gps_address}` : null) ??
            inc.location.spoken ??
            "Location not confirmed"}
        </span>
        {inc.location.lat != null &&
          inc.location.source !== "gps" &&
          inc.location.geocode_confidence !== "high" && (
            <span className="approx-label">approx.</span>
          )}
      </span>
      <span className="card-bottom">
        <PriorityBadge p={inc.final_priority} collecting={collecting} />
        {inc.group && (
          <span className="card-chip group" title="Calls close together about the same kind of emergency">
            <Icon name="users" size={11} /> {inc.group.size} callers
          </span>
        )}
        {inc.location.source === "gps" && (
          <span className={`card-chip gps${inc.device?.online ? " live" : ""}`}>
            <Icon name="target" size={11} /> GPS
          </span>
        )}
        {inc.channel === "app_text" && (
          <span className="card-chip">
            <Icon name="message" size={11} /> {inc.call_state.covert ? "Silent" : "Text"}
          </span>
        )}
        {inc.media.length > 0 && (
          <span className="card-chip">
            <Icon name="camera" size={11} /> {inc.media.length}
          </span>
        )}
        {inc.device?.battery != null && inc.device.battery <= 0.15 && !inc.device.charging && (
          <span className="card-chip warn">
            <Icon name="battery" size={11} /> {Math.round(inc.device.battery * 100)}%
          </span>
        )}
        {inc.caller.language && (
          <span className="language">{inc.caller.language.toUpperCase()}</span>
        )}
      </span>
      {inc.final_reasons[0] && (
        <span className="card-reason">{inc.final_reasons[0].text}</span>
      )}
    </button>
  );
}
