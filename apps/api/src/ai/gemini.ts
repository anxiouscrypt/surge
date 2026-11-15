// Layer 2: Gemini triage (docs/05 section 5).
// Runs when a critical field changes (debounced 2 s) and once at call end. Forced JSON, temperature 0.
// If it fails or times out, the card keeps the rules priority ("AI triage pending"). Nothing blocks.
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from "@google/genai";
import { z } from "zod";
import type { Incident, Reason } from "@surge/shared";
import { config } from "../config.js";
import { store } from "../store/memory.js";
import { rescore } from "../pipeline.js";

const DEBOUNCE_MS = 2000;
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS ?? 4000);
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
// Each model has its own free-tier quota (gemini-2.5-flash: only 5 requests/min). On 429, try the next one.
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-2.5-flash";

const ai = config.geminiKey ? new GoogleGenAI({ apiKey: config.geminiKey, apiVersion: "v1beta" }) : null;
const timers = new Map<string, NodeJS.Timeout>();
const generation = new Map<string, number>();

export const geminiEnabled = () => ai !== null;

/** What Gemini must return. Mirrors docs/05 section 5, layer 2. */
export const LlmTriage = z.object({
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  reasons: z.array(z.object({ text: z.string().min(1), evidence_field: z.string().min(1) })).max(4),
  units: z.array(z.enum(["fire", "ems", "police"])),
  summary: z.string().min(1),
  contradictions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type LlmTriage = z.infer<typeof LlmTriage>;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    priority: { type: "integer", enum: [1, 2, 3, 4], description: "1 immediate life threat, 2 urgent, 3 standard, 4 low / non-emergency" },
    reasons: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "Short reason a dispatcher reads on the card, max 8 words" },
          evidence_field: { type: "string", description: "Incident field path that supports it, e.g. people.vulnerable or incident.description" },
        },
        required: ["text", "evidence_field"],
      },
    },
    units: { type: "array", items: { type: "string", enum: ["fire", "ems", "police"] } },
    summary: { type: "string", description: "One sentence, max 20 words, for the dispatcher" },
    contradictions: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["priority", "reasons", "units", "summary", "contradictions", "confidence"],
};

const SYSTEM = `You are the triage assistant for a 911 dispatch center. An automated voice agent is collecting facts from a caller while every dispatcher is busy. You read the structured incident and decide how urgently a human dispatcher should take this call.

Priorities:
1 Immediate: threat to life now. Not breathing, unconscious, trapped, weapon, violence or crime in progress against a person, fire or smoke with people inside, someone in water, overdose, severe bleeding, stroke or heart attack signs.
2 Urgent: serious but not immediately life-threatening. Injured but awake, fire with no one inside, crash with injuries, gas leak, downed power lines, caller not safe, near an active wildfire.
3 Standard: crash without injuries, property crime that is over, hazard with no one at risk.
4 Low: information only or not an emergency.

Rules:
- Use only facts in the incident JSON. null means not asked yet, never "no".
- Every reason needs evidence_field: the JSON path it comes from (e.g. "incident.description", "people.vulnerable", "hazards.weapon"). No reason without evidence.
- If facts conflict (for example the description mentions a weapon but hazards.weapon is false), list it in contradictions and use the more urgent reading.
- If an important fact is unknown and the situation could be severe, prefer the more urgent priority.
- The rules engine already gave a floor priority. You may agree or be more urgent; the system never lets you lower it.
- Covert calls: if call_state.covert is true, priority 1 and include police. Also watch for a covert call the voice agent missed: the description reads like a call to someone else (ordering food, talking to a friend), the caller can only answer yes/no, says everything is fine while facts suggest danger, or another person seems to control the call. Then use priority 1 and add a contradiction starting with "Possible covert call:" saying why. Never suggest calling the caller back on a covert call.
- units: which services to send (fire, ems, police).
- summary: one plain sentence for the dispatcher. No advice to the caller.
- confidence: how sure you are about the priority, 0 to 1.`;

function promptFor(inc: Incident): string {
  const { caller, location, incident, people, patient, hazards, nasa_context, triage } = inc;
  return JSON.stringify(
    {
      incident: { caller: { language: caller.language, relation: caller.relation, caller_safe: caller.caller_safe }, location: { address: location.address, landmark: location.landmark, unit_or_floor: location.unit_or_floor }, incident, people, patient, hazards, call_state: { needs_instructions: inc.call_state.needs_instructions, covert: inc.call_state.covert, covert_cue: inc.call_state.covert_cue } },
      nasa_context,
      rules_floor: triage.rules ? { priority: triage.rules.priority, reasons: triage.rules.reasons.map((r) => r.text) } : null,
    },
    null,
    1,
  );
}

/** Call Gemini once. Returns null on timeout, error, or invalid output. */
export async function runTriage(inc: Incident): Promise<LlmTriage | null> {
  if (!ai) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await generate(inc, abort.signal);
    if (!res) return null;
    const parsed = LlmTriage.safeParse(JSON.parse(res.text ?? "null"));
    if (!parsed.success) {
      console.warn("gemini triage invalid output", parsed.error.flatten());
      return null;
    }
    console.log(`gemini triage ${inc.call_id}: P${parsed.data.priority} via ${res.model} in ${Date.now() - started} ms`);
    return parsed.data;
  } catch (err) {
    console.warn(`gemini triage failed after ${Date.now() - started} ms:`, abort.signal.aborted ? "timeout" : short(err));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const short = (err: unknown) => {
  const m = String((err as Error)?.message ?? err);
  return m.match(/"message":\s*"([^"]{0,160})/)?.[1] ?? m.slice(0, 160);
};

/** Try the main model, then the fallback if the main one is rate limited. */
async function generate(inc: Incident, abortSignal: AbortSignal) {
  const models = [...new Set([MODEL, FALLBACK_MODEL].filter(Boolean))];
  for (const [i, model] of models.entries()) {
    try {
      const res = await callModel(model, inc, abortSignal);
      return { text: res.text, model };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 429 && i < models.length - 1) {
        console.warn(`gemini ${model} rate limited, trying ${models[i + 1]}`);
        continue;
      }
      throw err;
    }
  }
  return null;
}

function callModel(model: string, inc: Incident, abortSignal: AbortSignal) {
  return ai!.models.generateContent({
      model,
      contents: promptFor(inc),
      config: {
        systemInstruction: SYSTEM,
        temperature: 0,
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_SCHEMA,
        // 2.x: no thinking, fastest. 3.x rejects thinkingBudget, so use its own default there.
        ...(model.startsWith("gemini-2") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        abortSignal,
        // Emergency calls describe violence and injuries; do not let filters drop triage.
        safetySettings: [
          HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          HarmCategory.HARM_CATEGORY_HARASSMENT,
          HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        ].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE })),
      },
    });
}

/** Store a Gemini result on the incident. Reasons without evidence are dropped. */
export function applyLlmTriage(inc: Incident, r: LlmTriage) {
  const reasons: Reason[] = r.reasons
    .filter((x) => x.evidence_field.trim())
    .map((x) => ({ text: x.text, source: "ai", evidence_field: x.evidence_field }));
  inc.triage.llm = { priority: r.priority, reasons, units: r.units, summary: r.summary, contradictions: r.contradictions, confidence: r.confidence };
}

async function triageNow(callId: string) {
  const gen = (generation.get(callId) ?? 0) + 1;
  generation.set(callId, gen);
  const inc = store.get(callId);
  if (!inc) return;
  const result = await runTriage(structuredClone(inc));
  // A newer run started while this one was in flight: drop the stale answer.
  if (!result || generation.get(callId) !== gen) return;
  const current = store.get(callId);
  if (!current) return;
  applyLlmTriage(current, result);
  rescore(current);
  store.save(current, ["triage.llm", "final_priority"]);
}

/** Debounced: whenever a critical field changes. */
export function scheduleLlmTriage(inc: Incident) {
  if (!ai) return;
  clearTimeout(timers.get(inc.call_id));
  timers.set(
    inc.call_id,
    setTimeout(() => {
      timers.delete(inc.call_id);
      void triageNow(inc.call_id);
    }, DEBOUNCE_MS),
  );
}

/** Immediately, e.g. at call end. */
export function triageAtCallEnd(callId: string) {
  if (!ai) return;
  clearTimeout(timers.get(callId));
  timers.delete(callId);
  void triageNow(callId);
}
