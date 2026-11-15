// Incident schema v1 (docs/05-CALL-AND-AI-PIPELINE.md section 3).
// null = "not known yet". Unknown is never the same as no.
import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

export const IncidentType = z.enum(["fire", "medical", "crime", "traffic", "hazard", "water_rescue", "other"]);
export const CallerRelation = z.enum(["self", "family", "bystander", "unknown"]);
export const GeocodeConfidence = z.enum(["high", "medium", "low", "none"]);
export const CallStage = z.enum(["collecting", "triage_complete", "waiting_for_dispatcher", "transferred", "ended"]);
export const Priority = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export const Unit = z.enum(["fire", "ems", "police"]);

const n = <T extends z.ZodTypeAny>(t: T) => t.nullable();

export const Caller = z.object({
  phone: n(z.string()),
  callback_confirmed: z.boolean(),
  language: n(z.string()),
  relation: CallerRelation,
  caller_safe: n(z.boolean()),
});

export const Location = z.object({
  spoken: n(z.string()),
  address: n(z.string()),
  unit_or_floor: n(z.string()),
  landmark: n(z.string()),
  read_back_confirmed: z.boolean(),
  // backend-only
  lat: n(z.number()),
  lng: n(z.number()),
  geocode_confidence: GeocodeConfidence,
  // Where lat/lng came from. "gps" = the caller's phone shared its location (caller page).
  source: z.enum(["none", "spoken", "gps"]),
  gps: n(z.object({ lat: z.number(), lng: z.number(), accuracy_m: z.number(), heading: n(z.number()), speed_mps: n(z.number()), at: z.string() })),
  // Reverse-geocoded address of the GPS fix (dispatcher only).
  gps_address: n(z.string()),
});

export const IncidentInfo = z.object({
  type: n(IncidentType),
  subtype: n(z.string()),
  description: n(z.string()),
  started: n(z.string()),
});

export const People = z.object({
  involved: n(z.number().int().nonnegative()),
  injured: n(z.number().int().nonnegative()),
  trapped: n(z.boolean()),
  vulnerable: z.array(z.string()),
});

export const Patient = z.object({
  conscious: n(z.boolean()),
  breathing: n(z.boolean()),
  severe_bleeding: n(z.boolean()),
});

export const Hazards = z.object({
  fire_or_smoke: n(z.boolean()),
  weapon: n(z.boolean()),
  violence_ongoing: n(z.boolean()),
  gas_leak: n(z.boolean()),
  downed_power_lines: n(z.boolean()),
  flood_water: n(z.boolean()),
});

export const CallState = z.object({
  stage: CallStage,
  missing: z.array(z.string()),
  caller_requested_human: z.boolean(),
  needs_instructions: z.boolean(),
  // Caller cannot speak freely (hostage, kidnapping, abuser in the room, coded call). Forces P1, no callback.
  covert: z.boolean(),
  covert_cue: n(z.string()),
  // Non-urgent report: the AI may close the call and promise a callback (backend-decided).
  callback_promised: z.boolean(),
  // Agent says it closed the call itself (sent right before end_call).
  ai_ended_call: z.boolean(),
  // Times the caller pressed "It's getting worse" on the caller page.
  worse: z.number().int().nonnegative().default(0),
});

export const NasaContext = z.object({
  nearest_fire_km: n(z.number()),
  fire_detected_minutes_ago: n(z.number()),
  inside_event: n(z.object({ id: z.string(), title: z.string() })),
});

export const Reason = z.object({
  text: z.string(),
  source: z.enum(["rule", "ai", "model", "nasa", "dispatcher"]),
  evidence_field: z.string().optional(),
});

export const Triage = z.object({
  rules: n(z.object({ priority: Priority, reasons: z.array(Reason), escalate: z.boolean() })),
  llm: n(
    z.object({
      priority: Priority,
      reasons: z.array(Reason),
      units: z.array(Unit),
      summary: z.string(),
      contradictions: z.array(z.string()),
      confidence: z.number().min(0).max(1),
    }),
  ),
  classifier: n(z.object({ priority: Priority, p1_probability: z.number() })),
});

export const Channel = z.enum(["phone", "app_voice", "app_text", "unknown"]);

export const Device = z.object({
  battery: n(z.number().min(0).max(1)),
  charging: n(z.boolean()),
  language: n(z.string()),
  platform: n(z.string()),
  /** Caller page is open and connected right now. */
  online: z.boolean(),
  last_seen: n(z.string()),
});

export const Media = z.object({
  id: z.string(),
  kind: z.enum(["photo", "video"]),
  url: z.string(),
  at: z.string(),
  /** AI description of the photo, for the dispatcher only. */
  caption: n(z.string()),
});

export const TimelineEntry = z.object({
  at: z.string(),
  kind: z.enum(["fact", "priority", "location", "media", "system", "dispatcher"]),
  text: z.string(),
});

export const Group = z.object({ id: z.string(), size: z.number().int(), call_ids: z.array(z.string()) });

export const Nearby = z.object({
  fire_station: n(z.object({ name: z.string(), km: z.number() })),
  hospital: n(z.object({ name: z.string(), km: z.number() })),
});

export const Takeover = z.object({
  mode: z.enum(["phone", "web"]),
  state: z.enum(["connecting", "connected", "failed", "ended"]),
  error: n(z.string()),
});

export const IncidentStatus = z.enum(["ai_on_call", "waiting", "taken", "dispatched", "closed"]);

export const Incident = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  call_id: z.string(),
  received_at: z.string(),
  status: IncidentStatus,
  caller: Caller,
  location: Location,
  incident: IncidentInfo,
  people: People,
  patient: Patient,
  hazards: Hazards,
  call_state: CallState,
  // backend-only
  nasa_context: n(NasaContext),
  triage: Triage,
  final_priority: Priority,
  final_reasons: z.array(Reason),
  score: z.number(),
  taken_by: n(z.string()),
  updated_at: z.string(),
  channel: Channel,
  device: n(Device),
  media: z.array(Media),
  timeline: z.array(TimelineEntry),
  group: n(Group),
  nearby: n(Nearby),
  takeover: n(Takeover),
});
export type Incident = z.infer<typeof Incident>;
export type Priority = z.infer<typeof Priority>;
export type Reason = z.infer<typeof Reason>;
export type TimelineEntry = z.infer<typeof TimelineEntry>;
export type Media = z.infer<typeof Media>;

// What the ElevenLabs agent may send to update_incident: partial, agent-writable fields only.
export const AgentUpdate = z
  .object({
    call_id: z.string().min(1),
    // Bound to ElevenLabs system dynamic variables; may be empty on web/test calls.
    call_sid: z.string().nullish(),
    caller_id: z.string().nullish(),
    caller: Caller.partial().optional(),
    location: Location.pick({ spoken: true, address: true, unit_or_floor: true, landmark: true, read_back_confirmed: true })
      .partial()
      .optional(),
    incident: IncidentInfo.partial().optional(),
    people: People.partial().optional(),
    patient: Patient.partial().optional(),
    hazards: Hazards.partial().optional(),
    call_state: CallState.pick({ caller_requested_human: true, needs_instructions: true, covert: true, covert_cue: true, ai_ended_call: true }).partial().optional(),
  })
  .strict();
export type AgentUpdate = z.infer<typeof AgentUpdate>;

export const ToolReply = z.object({
  ok: z.boolean(),
  missing: z.array(z.string()),
  say: n(z.string()),
  escalate: z.boolean(),
  /** Fields that were not stored, and why. The agent must fix and resend them. */
  not_saved: z.array(z.string()).optional(),
  /** Non-urgent report with everything collected: ask "anything else?", say `say`, then end the call. */
  wrap_up: z.boolean().optional(),
  /** Reply to ai_ended_call: true means the backend approved closing; say `say`, then end_call. */
  ended: z.boolean().optional(),
  error: z.string().optional(),
});
export type ToolReply = z.infer<typeof ToolReply>;

export function emptyIncident(call_id: string, now = new Date()): Incident {
  const iso = now.toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    call_id,
    received_at: iso,
    status: "ai_on_call",
    caller: { phone: null, callback_confirmed: false, language: null, relation: "unknown", caller_safe: null },
    location: {
      spoken: null, address: null, unit_or_floor: null, landmark: null, read_back_confirmed: false,
      lat: null, lng: null, geocode_confidence: "none", source: "none", gps: null, gps_address: null,
    },
    incident: { type: null, subtype: null, description: null, started: null },
    people: { involved: null, injured: null, trapped: null, vulnerable: [] },
    patient: { conscious: null, breathing: null, severe_bleeding: null },
    hazards: {
      fire_or_smoke: null, weapon: null, violence_ongoing: null,
      gas_leak: null, downed_power_lines: null, flood_water: null,
    },
    call_state: {
      stage: "collecting", missing: [], caller_requested_human: false, needs_instructions: false,
      covert: false, covert_cue: null, callback_promised: false, ai_ended_call: false, worse: 0,
    },
    nasa_context: null,
    triage: { rules: null, llm: null, classifier: null },
    final_priority: 4,
    final_reasons: [],
    score: 0,
    taken_by: null,
    updated_at: iso,
    channel: "unknown",
    device: null,
    media: [],
    timeline: [{ at: iso, kind: "system", text: "Call answered by Surge AI" }],
    group: null,
    nearby: null,
    takeover: null,
  };
}
