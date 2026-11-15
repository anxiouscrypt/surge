// One update through the pipeline (docs/05 section 1).
import type { AgentUpdate, Incident, ToolReply } from "@surge/shared";
import { store, mergeInto } from "./store/memory.js";
import { rulesFloor, baseScore, finalPriority } from "./priority/rules.js";
import { computeMissing, isTriageComplete } from "./priority/missing.js";
import { geocode } from "./geo/geocode.js";
import { nasaContextFor } from "./hazards/firms.js";
import { scheduleLlmTriage } from "./ai/gemini.js";

const CRITICAL = ["incident.", "people.", "patient.", "hazards.", "location."];
const escalated = new Set<string>();
/** Twilio CallSid per conversation, used to hand the live call to a dispatcher. */
export const callSids = new Map<string, string>();

// Unresolved dynamic variables arrive empty or as "{{...}}" on non-phone calls.
const real = (v?: string | null) => (v && !v.includes("{{") && v.trim() ? v.trim() : undefined);

// A phrase like "at home" or "the address you would give for a delivery" is not an address.
// Real addresses or intersections have a number or no placeholder words ("Main and Washtenaw").
const PLACEHOLDER =
  /\b(you|your|would|delivery|the order|unknown|not sure|don'?t know|at home|my home|my house|the house|here|the address|this address|my address|my location|the location|same place)\b/i;
export const isPlaceholderAddress = (s: string) => !/[a-z]/i.test(s) || (PLACEHOLDER.test(s) && !/\d/.test(s));

export async function handleAgentUpdate(update: AgentUpdate): Promise<ToolReply> {
  const { call_id, call_sid, caller_id, ...patch } = update;
  const notSaved: string[] = [];
  const addr = patch.location?.address;
  if (addr && isPlaceholderAddress(addr)) {
    // Keep what was said, but do not count it as a location, so the agent keeps asking.
    patch.location = { ...patch.location, spoken: patch.location!.spoken ?? addr };
    delete patch.location.address;
    delete patch.location.read_back_confirmed;
    notSaved.push("location.address");
  }
  const inc = store.getOrCreate(call_id);
  if (real(call_sid)) callSids.set(call_id, real(call_sid)!);
  const changed = mergeInto(inc, patch);
  // Caller ID pre-fills the callback number; the agent still confirms it.
  if (!inc.caller.phone && real(caller_id)) {
    inc.caller.phone = real(caller_id)!;
    changed.push("caller.phone");
  }

  if (changed.some((c) => c === "location.address" || c === "location.landmark")) {
    // Do not block the agent on geocoding; re-score when it lands.
    void locate(inc);
  }

  rescore(inc);
  store.save(inc, changed);
  if (changed.some((c) => CRITICAL.some((p) => c.startsWith(p)))) scheduleLlmTriage(inc);

  let escalate = inc.triage.rules?.escalate === true && !escalated.has(call_id);
  if (escalate) escalated.add(call_id);
  // Never make the agent announce "highest priority" out loud when someone may be listening.
  if (inc.call_state.covert) escalate = false;
  if (notSaved.length)
    return {
      ok: true, missing: inc.call_state.missing, say: null, escalate, not_saved: notSaved,
      error: "location.address must be the street address, intersection or place name the caller actually said. You still need it: ask for it.",
    };
  return { ok: true, missing: inc.call_state.missing, say: null, escalate };
}

export function rescore(inc: Incident) {
  inc.triage.rules = rulesFloor(inc);
  const final = finalPriority(inc);
  inc.final_priority = final.priority;
  inc.final_reasons = final.reasons;
  inc.score = baseScore(inc);
  inc.call_state.missing = computeMissing(inc);
  if (inc.call_state.stage === "collecting" && isTriageComplete(inc.call_state.missing)) inc.call_state.stage = "triage_complete";
}

async function locate(inc: Incident) {
  const query = [inc.location.address, inc.location.landmark].filter(Boolean).join(", ");
  const geo = await geocode(query);
  if (!geo) return;
  inc.location.lat = geo.lat;
  inc.location.lng = geo.lng;
  inc.location.geocode_confidence = geo.confidence;
  inc.nasa_context = await nasaContextFor(geo.lat, geo.lng);
  rescore(inc);
  store.save(inc, ["location.lat", "location.lng", "nasa_context"]);
}
