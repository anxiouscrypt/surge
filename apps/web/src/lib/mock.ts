import { emptyIncident, type Incident } from "@surge/shared";
import type { TranscriptLine } from "./socket";

export function mockIncidents(): Incident[] {
  const now = Date.now();
  const a = emptyIncident("demo_1042", new Date(now - 84 * 1000));
  a.location = {
    ...a.location,
    address: "Cross St & N Huron St, Ypsilanti",
    lat: 42.2465,
    lng: -83.6188,
    geocode_confidence: "high",
    read_back_confirmed: true,
    unit_or_floor: "Second floor",
  };
  a.incident = {
    type: "fire",
    subtype: "structure_fire",
    description: "Smoke from a house. Child may be inside.",
    started: "just now",
  };
  a.people = { involved: 3, injured: 1, trapped: true, vulnerable: ["child"] };
  a.hazards.fire_or_smoke = true;
  a.caller = {
    ...a.caller,
    phone: "+17345550142",
    language: "en",
    relation: "bystander",
    caller_safe: true,
    callback_confirmed: true,
  };
  a.final_priority = 1;
  a.score = 16;
  a.final_reasons = [
    {
      text: "Person possibly trapped",
      source: "rule",
      evidence_field: "people.trapped",
    },
    {
      text: "Fire with people involved",
      source: "rule",
      evidence_field: "hazards.fire_or_smoke",
    },
  ];
  a.triage.llm = {
    priority: 1,
    reasons: [],
    units: ["fire", "ems"],
    summary:
      "Smoke from second-floor windows. Caller reports a child may still be inside; one person injured.",
    contradictions: [],
    confidence: 0.86,
  };
  a.call_state.missing = ["patient.breathing", "patient.conscious"];
  const b = emptyIncident("demo_1043", new Date(now - 47 * 1000));
  b.location = {
    ...b.location,
    address: "Washtenaw Ave & Hewitt Rd, Ypsilanti",
    lat: 42.2559,
    lng: -83.6553,
    geocode_confidence: "medium",
    read_back_confirmed: true,
  };
  b.incident = {
    type: "traffic",
    subtype: null,
    description: "Two-car collision. One person injured.",
    started: null,
  };
  b.people = { involved: 2, injured: 1, trapped: false, vulnerable: [] };
  b.patient = { conscious: true, breathing: true, severe_bleeding: false };
  b.caller.language = "es";
  b.final_priority = 2;
  b.final_reasons = [{ text: "Injury reported", source: "rule" }];
  const c = emptyIncident("demo_1041", new Date(now - 237 * 1000));
  c.location = {
    ...c.location,
    address: "Eastern Michigan University, Ypsilanti",
    landmark: "Near the south entrance",
    lat: 42.2504,
    lng: -83.6241,
    geocode_confidence: "low",
  };
  c.incident = {
    type: "hazard",
    subtype: null,
    description: "Large branch blocking the road.",
    started: null,
  };
  c.final_priority = 3;
  c.status = "waiting";
  c.call_state.stage = "waiting_for_dispatcher";
  c.final_reasons = [
    { text: "Road hazard · no injuries reported", source: "rule" },
  ];
  const d = emptyIncident("demo_1044", new Date(now - 12 * 1000));
  d.incident.description = "Caller connected. Confirming the location.";
  d.caller.language = "ar";
  d.call_state.missing = ["location", "incident.type", "caller.caller_safe"];
  return [a, b, c, d];
}
export function mockTranscripts(): Record<string, TranscriptLine[]> {
  const now = Date.now();
  return {
    demo_1042: [
      {
        role: "agent",
        text: "I'm an automated assistant. What's the address of your emergency?",
        at: new Date(now - 84000).toISOString(),
      },
      {
        role: "caller",
        text: "Cross and Huron in Ypsilanti. There's smoke coming out of the house on the corner.",
        at: new Date(now - 70000).toISOString(),
      },
      {
        role: "agent",
        text: "Cross Street and North Huron Street in Ypsilanti. Is that right?",
        at: new Date(now - 64000).toISOString(),
      },
      {
        role: "caller",
        text: "Yes. Second floor. I think their little boy is still inside.",
        at: new Date(now - 55000).toISOString(),
      },
      {
        role: "agent",
        text: "I'm marking this as the highest priority right now. Stay on the line.",
        at: new Date(now - 47000).toISOString(),
      },
    ],
  };
}
