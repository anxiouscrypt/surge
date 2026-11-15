// The backend owns the checklist (docs/05 section 2). Returns essential fields still unknown, in ask order.
import type { Incident } from "@surge/shared";

export function computeMissing(i: Incident): string[] {
  const m: string[] = [];
  // Covert call: no callback (a ringing phone can endanger the caller) and do not ask if they are safe; they are not.
  const covert = i.call_state.covert;
  // A precise GPS fix from the caller's phone counts as a location: no need to ask.
  const gps = i.location.source === "gps" && (i.location.gps?.accuracy_m ?? Infinity) <= 100;
  if (!gps && !i.location.address && !i.location.landmark) m.push("location");
  else if (!gps && !i.location.read_back_confirmed) m.push("location.read_back_confirmed");
  // No caller ID (e.g. a web test call): ask for a number. Caller ID known: confirm it.
  if (!covert && !i.caller.phone) m.push("caller.phone");
  else if (!covert && !i.caller.callback_confirmed) m.push("caller.callback");
  if (!i.incident.type) m.push("incident.type");
  // Anyone hurt decides whether this can be a non-urgent report, so ask it for every real incident.
  if (i.incident.type && i.incident.type !== "other" && i.people.injured === null) m.push("people.injured");

  const hurt = i.incident.type === "medical" || (i.people.injured ?? 0) > 0;
  if (hurt) {
    if (i.patient.conscious === null) m.push("patient.conscious");
    if (i.patient.breathing === null) m.push("patient.breathing");
  }
  switch (i.incident.type) {
    case "fire":
    case "traffic":
    case "water_rescue":
      if (i.people.trapped === null) m.push("people.trapped");
      break;
    case "crime":
      if (i.hazards.violence_ongoing === null) m.push("hazards.violence_ongoing");
      if (i.hazards.weapon === null) m.push("hazards.weapon");
      break;
  }
  if (i.people.involved === null) m.push("people.involved");
  if (!covert && i.caller.caller_safe === null) m.push("caller.caller_safe");
  return m;
}

/**
 * May the AI close this call and promise a callback? Only for non-urgent reports with everything collected
 * and a confirmed callback number. Never for P1/P2 (stay on the line until a dispatcher takes over),
 * never for covert calls (a callback can ring in front of the attacker).
 */
export function mayEndCall(i: Incident): boolean {
  return (
    i.call_state.missing.length === 0 &&
    i.final_priority >= 3 &&
    !i.call_state.covert &&
    !i.call_state.needs_instructions &&
    i.caller.caller_safe !== false &&
    !!i.caller.phone &&
    i.caller.callback_confirmed
  );
}

/** Triage complete when location, type, the P1 checks and caller safety are known. */
export function isTriageComplete(missing: string[]): boolean {
  return !missing.some((f) => f !== "people.involved" && f !== "caller.callback" && f !== "caller.phone");
}
