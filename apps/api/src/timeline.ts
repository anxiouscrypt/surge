// Turns field changes into short timeline lines a dispatcher can scan ("Not breathing", "Address confirmed: 41 Elm St").
import type { Incident } from "@surge/shared";

const yesNo = (v: boolean | null, yes: string, no: string) => (v === true ? yes : v === false ? no : null);

const LINES: Record<string, (i: Incident) => string | null> = {
  "location.address": (i) => (i.location.address ? `Address: ${i.location.address}` : null),
  "location.read_back_confirmed": (i) => (i.location.read_back_confirmed ? "Caller confirmed the address" : null),
  "location.landmark": (i) => (i.location.landmark ? `Landmark: ${i.location.landmark}` : null),
  "location.unit_or_floor": (i) => (i.location.unit_or_floor ? `Unit/floor: ${i.location.unit_or_floor}` : null),
  "incident.type": (i) => (i.incident.type ? `Type: ${i.incident.type.replace("_", " ")}` : null),
  "incident.description": (i) => i.incident.description,
  "people.injured": (i) => (i.people.injured === null ? null : i.people.injured === 0 ? "Nobody hurt" : `${i.people.injured} hurt`),
  "people.involved": (i) => (i.people.involved === null ? null : `${i.people.involved} involved`),
  "people.trapped": (i) => yesNo(i.people.trapped, "Someone trapped", "Nobody trapped"),
  "people.vulnerable": (i) => (i.people.vulnerable.length ? `Vulnerable: ${i.people.vulnerable.join(", ")}` : null),
  "patient.conscious": (i) => yesNo(i.patient.conscious, "Patient awake", "Patient unconscious"),
  "patient.breathing": (i) => yesNo(i.patient.breathing, "Patient breathing", "Patient NOT breathing"),
  "patient.severe_bleeding": (i) => yesNo(i.patient.severe_bleeding, "Severe bleeding", "No severe bleeding"),
  "hazards.fire_or_smoke": (i) => yesNo(i.hazards.fire_or_smoke, "Fire or smoke", "No fire or smoke"),
  "hazards.weapon": (i) => yesNo(i.hazards.weapon, "Weapon present", "No weapon seen"),
  "hazards.violence_ongoing": (i) => yesNo(i.hazards.violence_ongoing, "Violence happening now", "Violence is over"),
  "hazards.gas_leak": (i) => yesNo(i.hazards.gas_leak, "Gas leak", null as never),
  "hazards.downed_power_lines": (i) => yesNo(i.hazards.downed_power_lines, "Power lines down", null as never),
  "hazards.flood_water": (i) => yesNo(i.hazards.flood_water, "Flood water", null as never),
  "caller.caller_safe": (i) => yesNo(i.caller.caller_safe, "Caller is safe", "Caller is NOT safe"),
  "caller.phone": (i) => (i.caller.phone ? `Callback number: ${i.caller.phone}` : null),
  "caller.language": (i) => (i.caller.language && i.caller.language !== "en" ? `Caller speaks ${i.caller.language.toUpperCase()}` : null),
  "call_state.covert": (i) => (i.call_state.covert ? `Covert call${i.call_state.covert_cue ? `: ${i.call_state.covert_cue}` : ""}` : null),
  "call_state.needs_instructions": (i) => (i.call_state.needs_instructions ? "Caller asked what to do" : null),
  "call_state.caller_requested_human": (i) => (i.call_state.caller_requested_human ? "Caller asked for a person" : null),
};

/** Timeline lines for the fields that just changed. */
export function describeChanges(i: Incident, changed: string[]): string[] {
  return [...new Set(changed)].map((c) => LINES[c]?.(i) ?? null).filter((x): x is string => !!x);
}
