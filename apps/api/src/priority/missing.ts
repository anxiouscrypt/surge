// The backend owns the checklist (docs/05 section 2). Returns essential fields still unknown, in ask order.
import type { Incident } from "@surge/shared";

export function computeMissing(i: Incident): string[] {
  const m: string[] = [];
  if (!i.location.address && !i.location.landmark) m.push("location");
  else if (!i.location.read_back_confirmed) m.push("location.read_back_confirmed");
  if (!i.caller.phone || !i.caller.callback_confirmed) m.push("caller.callback");
  if (!i.incident.type) m.push("incident.type");

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
  if (i.caller.caller_safe === null) m.push("caller.caller_safe");
  return m;
}

/** Triage complete when location, type, the P1 checks and caller safety are known. */
export function isTriageComplete(missing: string[]): boolean {
  return !missing.some((f) => f !== "people.involved" && f !== "caller.callback");
}
