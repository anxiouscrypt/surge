import { emptyIncident, type Incident } from "@surge/shared";

/** Mock incidents for building the UI before the backend is live. */
export function mockIncidents(): Incident[] {
  const now = Date.now();
  const a = emptyIncident("mock_1", new Date(now - 3 * 60000));
  a.location = { ...a.location, address: "Cross St & N Huron St, Ypsilanti, MI", lat: 42.2465, lng: -83.6188, geocode_confidence: "high", read_back_confirmed: true };
  a.incident = { type: "fire", subtype: "structure_fire", description: "Smoke from second floor windows", started: "just now" };
  a.people = { involved: 3, injured: 1, trapped: true, vulnerable: ["child"] };
  a.final_priority = 1;
  a.final_reasons = [{ text: "Someone trapped", source: "rule" }, { text: "Fire or smoke with people involved", source: "rule" }];
  a.triage.llm = { priority: 1, reasons: [], units: ["fire", "ems"], summary: "House fire, smoke on 2nd floor, 1 child possibly trapped.", contradictions: [], confidence: 0.86 };

  const b = emptyIncident("mock_2", new Date(now - 6 * 60000));
  b.location = { ...b.location, address: "Washtenaw Ave & Hewitt Rd, Ypsilanti, MI", lat: 42.2559, lng: -83.6553, geocode_confidence: "medium", read_back_confirmed: true };
  b.incident = { type: "traffic", subtype: null, description: "Two-car crash", started: null };
  b.people = { involved: 2, injured: 0, trapped: false, vulnerable: [] };
  b.final_priority = 3;
  b.final_reasons = [{ text: "Reported traffic", source: "rule" }];

  return [a, b];
}
