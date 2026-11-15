import type { Incident } from "@surge/shared";
import type { Connection } from "../lib/socket";
import { formatWait } from "../lib/socket";
import { Icon } from "./Icon";

export function StatusBar({
  incidents,
  connection,
  now,
  demo,
  muted,
  onMute,
  onTools,
}: {
  incidents: Incident[];
  connection: Connection;
  now: number;
  demo: boolean;
  muted: boolean;
  onMute: () => void;
  onTools: () => void;
}) {
  const p1 = waitingP1(incidents);
  const closedByAi = incidents.filter((i) => i.call_state.callback_promised && i.call_state.stage === "ended").length;
  const onApp = incidents.filter((i) => i.device?.online).length;
  const waiting = incidents.filter(
    (i) => i.status === "ai_on_call" || i.status === "waiting",
  );
  const ai = waiting.filter(
    (i) => i.status === "ai_on_call" && i.call_state.stage !== "ended",
  ).length;
  const oldest = [...waiting].sort(
    (a, b) => Date.parse(a.received_at) - Date.parse(b.received_at),
  )[0];
  return (
    <header className="statusbar">
      <a
        href={demo ? "?demo=1" : "/"}
        className="brand"
        aria-label="Surge home"
      >
        <span className="brand-mark">
          <Icon name="bolt" size={22} />
        </span>
        SURGE
        <span className="brand-divider" />
        <span className="brand-subtitle">Overflow intelligence</span>
      </a>
      <div className="header-metrics">
        <div>
          <span className="metric-dot" /> <b>{String(ai).padStart(2, "0")}</b>
          <span>AI on call</span>
        </div>
        <div className={p1 ? "metric-urgent" : ""}>
          <b>{String(p1).padStart(2, "0")}</b>
          <span>P1 waiting</span>
        </div>
        <div>
          <Icon name="clock" size={14} />
          <b>{oldest ? formatWait(oldest, now) : "0:00"}</b>
          <span>Longest wait</span>
        </div>
        <div className="metric-secondary">
          <b>{String(closedByAi).padStart(2, "0")}</b>
          <span>Closed by AI</span>
        </div>
        <div className="metric-secondary">
          <Icon name="target" size={14} />
          <b>{String(onApp).padStart(2, "0")}</b>
          <span>Live GPS</span>
        </div>
      </div>
      <div className="header-end">
        <button className="header-button" onClick={onMute} aria-pressed={muted} title={muted ? "Turn P1 alerts on" : "Mute P1 alerts"}>
          <Icon name={muted ? "mute" : "volume"} size={15} />
        </button>
        <button className="header-button qr-button" onClick={onTools}>
          <Icon name="phone" size={14} /> Call from phone
        </button>
        <span
          className={`connection ${demo ? "demo" : connection}`}
          role="status"
        >
          <span className="status-dot" />
          {demo
            ? "DEMO CALLS"
            : connection === "live"
              ? "CALL FEED LIVE"
              : connection === "connecting"
                ? "CONNECTING"
                : connection === "reconnecting"
                  ? "RECONNECTING"
                  : "CALL FEED OFFLINE"}
        </span>
        <a className="mode-link" href={demo ? "/" : "?demo=1"}>
          {demo ? "Open live feed" : "View demo"}
          <Icon name="arrow" size={13} />
        </a>
      </div>
    </header>
  );
}

function waitingP1(list: Incident[]) {
  return list.filter((i) => i.final_priority === 1 && (i.status === "ai_on_call" || i.status === "waiting")).length;
}
