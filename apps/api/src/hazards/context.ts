// Apply refreshed satellite observations through the existing deterministic priority rules.
import { firms } from "./firms.js";
import { store } from "../store/memory.js";
import { rescore } from "../pipeline.js";

export function syncHazardContext() {
  for (const incident of store.open()) {
    if (incident.location.lat == null || incident.location.lng == null)
      continue;
    const next = firms.context(incident.location.lat, incident.location.lng);
    if (JSON.stringify(next) === JSON.stringify(incident.nasa_context))
      continue;
    incident.nasa_context = next;
    rescore(incident);
    store.save(incident, [
      "nasa_context",
      "triage.rules",
      "final_priority",
      "final_reasons",
      "score",
    ]);
  }
}
