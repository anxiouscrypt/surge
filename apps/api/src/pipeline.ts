// One update through the pipeline (docs/05 section 1).
import type { AgentUpdate, Incident, ToolReply } from "@surge/shared";
import { rulesFloor, baseScore, finalPriority } from "./priority/rules.js";
import { computeMissing, isTriageComplete, mayEndCall } from "./priority/missing.js";
import { geocode } from "./geo/geocode.js";
import { nearbyFor } from "./geo/places.js";
import { computeGroups } from "./geo/group.js";
import { haversineKm } from "./hazards/firms.js";
import { describeChanges } from "./timeline.js";
import { nasaContextFor } from "./hazards/firms.js";
import { geminiEnabled, scheduleLlmTriage, triageAndWait } from "./ai/gemini.js";
import { store, mergeInto, emit, nextSeq, note } from "./store/memory.js";

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

export const CLOSING =
  "Thank you. I've passed everything to a dispatcher, and someone will call you back at this number. If anything changes or gets worse, call 911 again.";

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
  if (inc.channel === "unknown") inc.channel = real(call_sid) ? "phone" : "unknown";
  for (const line of describeChanges(inc, changed)) note(inc, "fact", line);
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
  let closed = false;
  if (inc.call_state.ai_ended_call && inc.call_state.stage !== "ended") {
    // Before letting the caller go, make sure Gemini has seen the latest facts; it may raise the priority.
    if (inc.call_state.callback_promised && geminiEnabled()) {
      store.save(inc, changed);
      await triageAndWait(call_id);
    }
    if (inc.call_state.callback_promised) {
      // Final go-ahead: the AI closes a non-urgent report; it now waits in the queue for a callback.
      inc.call_state.stage = "ended";
      inc.status = "waiting";
      changed.push("call_state.stage", "status");
      closed = true;
    } else {
      inc.call_state.ai_ended_call = false; // no longer allowed (it became urgent): stay on the line
    }
  }
  store.save(inc, changed);
  if (changed.some((c) => CRITICAL.some((p) => c.startsWith(p)))) scheduleLlmTriage(inc);
  if (closed) emit({ type: "call.ended", call_id, seq: nextSeq() });

  let escalate = inc.triage.rules?.escalate === true && !escalated.has(call_id);
  if (escalate) escalated.add(call_id);
  // Never make the agent announce "highest priority" out loud when someone may be listening.
  if (inc.call_state.covert) escalate = false;
  if (closed) return { ok: true, missing: [], say: CLOSING, escalate: false, ended: true };
  if (inc.call_state.callback_promised && inc.call_state.stage !== "ended")
    return { ok: true, missing: [], say: CLOSING, escalate: false, wrap_up: true };
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
  const before = inc.final_priority;
  // Notes start once there is something to say (not every call starts at P4 in the timeline).
  if (final.priority !== before && (inc.incident.type || final.priority < 4)) {
    const why = final.reasons.find((r) => !inc.final_reasons.some((o) => o.text === r.text)) ?? final.reasons[0];
    note(inc, "priority", `Priority P${before} → P${final.priority}${why ? `: ${why.text}` : ""}`);
  }
  inc.final_priority = final.priority;
  inc.final_reasons = final.reasons;
  inc.score = baseScore(inc);
  inc.call_state.missing = computeMissing(inc);
  if (inc.call_state.stage !== "ended") inc.call_state.callback_promised = mayEndCall(inc);
  if (inc.call_state.stage === "collecting" && isTriageComplete(inc.call_state.missing)) inc.call_state.stage = "triage_complete";
}

async function locate(inc: Incident) {
  const query = [inc.location.address, inc.location.landmark].filter(Boolean).join(", ");
  const geo = await geocode(query);
  if (!geo) {
    if (inc.location.source !== "gps") note(inc, "location", `Could not find "${query}" on the map`);
    store.save(inc, ["timeline"]);
    return;
  }
  inc.location.geocode_confidence = geo.confidence;
  const gps = inc.location.gps;
  if (gps && inc.location.source === "gps") {
    // The phone's GPS is more precise. Keep it unless the caller is reporting somewhere else.
    const km = haversineKm(gps, geo);
    if (km > 0.5) {
      note(inc, "location", `Reported address is ${km.toFixed(1)} km from the caller's phone: pin moved to the address`);
      inc.location.lat = geo.lat;
      inc.location.lng = geo.lng;
      inc.location.source = "spoken";
    }
  } else {
    inc.location.lat = geo.lat;
    inc.location.lng = geo.lng;
    inc.location.source = "spoken";
    note(inc, "location", `Located on the map (${geo.confidence} confidence)`);
  }
  await placed(inc, ["location.lat", "location.lng", "location.geocode_confidence"]);
}

/** After lat/lng changes: hazards, nearest stations, re-score, re-group. */
export async function placed(inc: Incident, changed: string[]) {
  if (inc.location.lat == null || inc.location.lng == null) return;
  inc.nasa_context = await nasaContextFor(inc.location.lat, inc.location.lng);
  inc.nearby = nearbyFor(inc.location.lat, inc.location.lng);
  rescore(inc);
  store.save(inc, [...changed, "nasa_context", "nearby", "timeline"]);
  regroup();
}

export function regroup() {
  for (const i of computeGroups(store.open())) {
    if (i.group) note(i, "system", `Likely the same incident as ${i.group.size - 1} other call${i.group.size > 2 ? "s" : ""}`);
    store.save(i, ["group"]);
  }
}
