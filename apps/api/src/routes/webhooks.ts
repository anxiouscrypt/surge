// ElevenLabs post-call webhook: marks the call ended, fills facts the agent missed from the
// platform's post-call Data Collection (never overwriting what the caller confirmed live),
// then runs a final Gemini triage.
import { Hono } from "hono";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { Incident } from "@surge/shared";
import { emit, nextSeq, note, store } from "../store/memory.js";
import { triageAtCallEnd } from "../ai/gemini.js";
import { rescore } from "../pipeline.js";

export const webhooks = new Hono();
let client: ElevenLabsClient | null = null;

webhooks.post("/elevenlabs/post-call", async (c) => {
  const raw = await c.req.text();
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET?.trim();
  let body: any;
  if (secret) {
    try {
      client ??= new ElevenLabsClient();
      body = await client.webhooks.constructEvent(raw, c.req.header("elevenlabs-signature") ?? "", secret);
    } catch {
      return c.json({ error: "invalid signature" }, 401);
    }
  } else {
    // No secret configured: accept, but never trust it to change facts.
    body = JSON.parse(raw || "{}");
  }

  const call_id: string | undefined = body?.data?.conversation_id;
  const inc = call_id ? store.get(call_id) : undefined;
  if (inc) {
    const changed: string[] = [];
    if (inc.call_state.stage !== "transferred" && inc.call_state.stage !== "ended") {
      inc.call_state.stage = "ended";
      changed.push("call_state.stage");
    }
    if (secret) {
      const filled = backfill(inc, body?.data?.analysis?.data_collection_results ?? {});
      if (filled.length) {
        note(inc, "system", `Filled from post-call analysis: ${filled.join(", ")}`);
        changed.push(...filled);
        rescore(inc);
      }
    }
    store.save(inc, changed);
  }
  if (call_id) {
    emit({ type: "call.ended", call_id, seq: nextSeq() });
    if (inc) triageAtCallEnd(call_id);
  }
  return c.json({ ok: true });
});

type Result = Record<string, { value?: unknown } | undefined>;
const bool = (v: unknown) => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : null);
const int = (v: unknown) => (Number.isInteger(Number(v)) && v !== "" && v !== null ? Number(v) : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const TYPES = ["fire", "medical", "crime", "traffic", "hazard", "water_rescue", "other"] as const;

/** Fill only fields that are still unknown. Returns the field paths it filled. */
export function backfill(inc: Incident, r: Result): string[] {
  const filled: string[] = [];
  const set = <T>(path: string, current: T | null, value: T | null, apply: (v: T) => void) => {
    if (current === null && value !== null) {
      apply(value);
      filled.push(path);
    }
  };
  const v = (k: string) => r[k]?.value;
  set("location.address", inc.location.address, str(v("address")), (x) => (inc.location.address = x));
  const t = str(v("incident_type"))?.toLowerCase();
  set("incident.type", inc.incident.type, TYPES.find((x) => x === t) ?? null, (x) => (inc.incident.type = x));
  set("people.involved", inc.people.involved, int(v("people_involved")), (x) => (inc.people.involved = x));
  set("people.injured", inc.people.injured, int(v("people_injured")), (x) => (inc.people.injured = x));
  set("people.trapped", inc.people.trapped, bool(v("trapped")), (x) => (inc.people.trapped = x));
  set("patient.breathing", inc.patient.breathing, bool(v("breathing")), (x) => (inc.patient.breathing = x));
  set("patient.conscious", inc.patient.conscious, bool(v("conscious")), (x) => (inc.patient.conscious = x));
  set("hazards.fire_or_smoke", inc.hazards.fire_or_smoke, bool(v("fire_or_smoke")), (x) => (inc.hazards.fire_or_smoke = x));
  set("hazards.weapon", inc.hazards.weapon, bool(v("weapon")), (x) => (inc.hazards.weapon = x));
  set("hazards.violence_ongoing", inc.hazards.violence_ongoing, bool(v("violence_ongoing")), (x) => (inc.hazards.violence_ongoing = x));
  set("caller.caller_safe", inc.caller.caller_safe, bool(v("caller_safe")), (x) => (inc.caller.caller_safe = x));
  if (!inc.call_state.covert) set("caller.phone", inc.caller.phone, str(v("callback_number")), (x) => (inc.caller.phone = x));
  set("caller.language", inc.caller.language, str(v("language")), (x) => (inc.caller.language = x));
  return filled;
}
