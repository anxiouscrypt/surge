// Layer 1: rules floor (docs/05 section 5). Deterministic, instant, can only set a minimum.
import type { Incident, Priority, Reason } from "@surge/shared";

export type RulesResult = { priority: Priority; reasons: Reason[]; escalate: boolean };

const rule = (text: string, evidence_field?: string): Reason => ({ text, source: "rule", evidence_field });

export function rulesFloor(i: Incident): RulesResult {
  const p1: Reason[] = [];
  const p2: Reason[] = [];

  // P1: immediate life threat
  if (i.call_state.covert) p1.push(rule("Caller cannot speak freely (covert call)", "call_state.covert"));
  if (i.patient.breathing === false) p1.push(rule("Person not breathing", "patient.breathing"));
  if (i.patient.conscious === false) p1.push(rule("Person unconscious", "patient.conscious"));
  if (i.people.trapped === true) p1.push(rule("Someone trapped", "people.trapped"));
  if (i.hazards.weapon === true) p1.push(rule("Weapon reported", "hazards.weapon"));
  if (i.hazards.violence_ongoing === true) p1.push(rule("Violence in progress", "hazards.violence_ongoing"));
  const peopleAtFire = (i.people.involved ?? 0) > 0 || (i.people.injured ?? 0) > 0;
  if (i.hazards.fire_or_smoke === true && peopleAtFire) p1.push(rule("Fire or smoke with people involved", "hazards.fire_or_smoke"));

  // P2: urgent
  if (i.hazards.fire_or_smoke === true && !peopleAtFire) p2.push(rule("Fire or smoke reported", "hazards.fire_or_smoke"));
  const injured = (i.people.injured ?? 0) > 0;
  if (injured && i.patient.breathing === null && i.patient.conscious === null)
    p2.push(rule("Injury reported, breathing and consciousness unknown", "people.injured"));
  else if (injured) p2.push(rule("Injury reported", "people.injured"));
  if (i.patient.severe_bleeding === true) p2.push(rule("Severe bleeding", "patient.severe_bleeding"));
  if (i.hazards.downed_power_lines === true) p2.push(rule("Downed power lines", "hazards.downed_power_lines"));
  if (i.hazards.gas_leak === true) p2.push(rule("Possible gas leak", "hazards.gas_leak"));
  if (i.caller.caller_safe === false) p2.push(rule("Caller is not safe", "caller.caller_safe"));

  const nasa = i.nasa_context;
  if (nasa?.nearest_fire_km != null && nasa.nearest_fire_km <= 1) {
    const ago = nasa.fire_detected_minutes_ago != null ? ` ${Math.round(nasa.fire_detected_minutes_ago)} min ago` : "";
    p2.push({ text: `${nasa.nearest_fire_km.toFixed(1)} km from a NASA fire detection${ago}`, source: "nasa" });
  }
  if (nasa?.inside_event) p2.push({ text: `Inside active event: ${nasa.inside_event.title}`, source: "nasa" });

  if (p1.length) return { priority: 1, reasons: [...p1, ...p2], escalate: true };
  if (p2.length) return { priority: 2, reasons: p2, escalate: false };
  if (i.incident.type && i.incident.type !== "other") return { priority: 3, reasons: [rule(`Reported ${i.incident.type.replace("_", " ")}`, "incident.type")], escalate: false };
  return { priority: 4, reasons: [rule("No emergency details yet", "incident.type")], escalate: false };
}

/** Score within a priority (higher = sooner). Waiting time (+1/min) is added live by the dashboard. */
export function baseScore(i: Incident): number {
  let s = 0;
  s += 10 * i.people.vulnerable.length;
  s += 2 * Math.min(i.people.involved ?? 0, 5);
  if (i.nasa_context?.nearest_fire_km != null && i.nasa_context.nearest_fire_km <= 5) s += 5;
  if (i.call_state.needs_instructions) s += 3;
  return s;
}

/** Most urgent wins. Classifier may only raise to P1; it never lowers. */
export function finalPriority(i: Incident): { priority: Priority; reasons: Reason[] } {
  const { rules, llm, classifier } = i.triage;
  let priority: Priority = rules?.priority ?? 4;
  const reasons: Reason[] = [...(rules?.reasons ?? [])];

  if (llm) {
    if (llm.priority < priority) priority = llm.priority;
    reasons.push(...llm.reasons);
  }
  if (classifier?.priority === 1 && priority !== 1) {
    priority = 1;
    reasons.push({ text: "Model flagged as possible life threat", source: "model" });
  }
  const seen = new Set<string>();
  return { priority, reasons: reasons.filter((r) => !seen.has(r.text) && !!seen.add(r.text)) };
}
