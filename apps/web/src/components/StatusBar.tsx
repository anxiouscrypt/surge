import type { Incident } from "@surge/shared";
import { waitMinutes } from "../lib/socket";

export function StatusBar({ incidents, connected, now }: { incidents: Incident[]; connected: boolean; now: number }) {
  const aiCalls = incidents.filter((i) => i.status === "ai_on_call").length;
  const longest = Math.max(0, ...incidents.filter((i) => i.status === "ai_on_call" || i.status === "waiting").map((i) => waitMinutes(i, now)));
  return (
    <header className="statusbar">
      <strong className="brand">SURGE</strong>
      <span>Dispatchers: <b className="busy">All on call</b></span>
      <span>AI calls: <b>{aiCalls}</b></span>
      <span>Longest wait: <b>{longest.toFixed(1)} min</b></span>
      <span className={connected ? "ok" : "off"}>{connected ? "● Live" : "○ Offline"}</span>
    </header>
  );
}
