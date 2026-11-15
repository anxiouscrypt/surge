import type { Incident } from "@surge/shared";
import type { Connection } from "../lib/socket";
import { formatWait } from "../lib/socket";
import { Icon } from "./Icon";

export function StatusBar({
  incidents,
  connection,
  now,
  demo,
}: {
  incidents: Incident[];
  connection: Connection;
  now: number;
  demo: boolean;
}) {
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
        <div>
          <Icon name="clock" size={14} />
          <b>{oldest ? formatWait(oldest, now) : "0:00"}</b>
          <span>Longest wait</span>
        </div>
      </div>
      <div className="header-end">
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
