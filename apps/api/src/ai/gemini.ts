// Layer 2: Gemini triage (docs/05 section 5). Debounced 2 s, 3 s timeout, never blocks.
import type { Incident } from "@surge/shared";
import { config } from "../config.js";

const timers = new Map<string, NodeJS.Timeout>();

export function scheduleLlmTriage(inc: Incident) {
  if (!config.geminiKey) return;
  clearTimeout(timers.get(inc.call_id));
  timers.set(
    inc.call_id,
    setTimeout(() => {
      timers.delete(inc.call_id);
      // TODO: call Gemini with structured output (priority, reasons w/ evidence_field, units, summary,
      // contradictions, confidence), temperature 0. On success: set inc.triage.llm, rescore(inc), store.save().
    }, 2000),
  );
}
