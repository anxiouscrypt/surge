// Plain-text summary a dispatcher pastes into their CAD (computer-aided dispatch) system.
import type { Incident } from "@surge/shared";

const yn = (v: boolean | null) => (v === null ? "unknown" : v ? "yes" : "no");

export function cadSummary(i: Incident): string {
  const loc = i.location;
  const where = loc.address ?? (loc.gps_address ? `near ${loc.gps_address}` : loc.spoken) ?? "unknown";
  const lines = [
    `SURGE P${i.final_priority} ${(i.incident.subtype ?? i.incident.type ?? "unknown").replaceAll("_", " ").toUpperCase()}`,
    `LOC: ${where}${loc.unit_or_floor ? `, ${loc.unit_or_floor}` : ""}${loc.landmark ? ` (${loc.landmark})` : ""}`,
    loc.lat != null && loc.lng != null ? `COORD: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${loc.source === "gps" && loc.gps ? ` (phone GPS ±${loc.gps.accuracy_m} m)` : ""}` : null,
    i.triage.llm?.summary ? `SUMMARY: ${i.triage.llm.summary}` : i.incident.description ? `DESC: ${i.incident.description}` : null,
    i.triage.llm?.units.length ? `UNITS: ${i.triage.llm.units.map((u) => u.toUpperCase()).join(", ")}` : null,
    `PEOPLE: involved ${i.people.involved ?? "?"}, injured ${i.people.injured ?? "?"}, trapped ${yn(i.people.trapped)}${i.people.vulnerable.length ? `, vulnerable: ${i.people.vulnerable.join(", ")}` : ""}`,
    i.incident.type === "medical" || (i.people.injured ?? 0) > 0 ? `PATIENT: conscious ${yn(i.patient.conscious)}, breathing ${yn(i.patient.breathing)}, severe bleeding ${yn(i.patient.severe_bleeding)}` : null,
    `HAZARDS: ${Object.entries(i.hazards).filter(([, v]) => v === true).map(([k]) => k.replaceAll("_", " ")).join(", ") || "none reported"}`,
    i.call_state.covert ? `*** COVERT CALL: caller cannot speak freely. DO NOT CALL BACK. ***` : `CALLBACK: ${i.caller.phone ?? "not collected"}`,
    i.caller.language && i.caller.language !== "en" ? `LANGUAGE: ${i.caller.language.toUpperCase()}` : null,
    i.group ? `LINKED: ${i.group.size} callers, likely same incident` : null,
    `WHY: ${i.final_reasons.slice(0, 3).map((r) => r.text).join("; ") || "assessment in progress"}`,
    `CALL: ${i.call_id} · received ${new Date(i.received_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
  ];
  return lines.filter(Boolean).join("\n");
}
