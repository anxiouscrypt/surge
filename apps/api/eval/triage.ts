// Live check of Gemini triage on golden cases (docs/05 section 9). Needs GEMINI_API_KEY.
// Usage: pnpm --filter @surge/api eval:triage
import { emptyIncident, type Incident } from "@surge/shared";
import { mergeInto } from "../src/store/memory.js";
import { rulesFloor, finalPriority } from "../src/priority/rules.js";
import { applyLlmTriage, geminiEnabled, runTriage } from "../src/ai/gemini.js";

type Case = { name: string; patch: Record<string, any>; expect: 1 | 2 | 3 | 4 };
const cases: Case[] = [
  { name: "not breathing", expect: 1, patch: { incident: { type: "medical", description: "My dad collapsed and isn't breathing" }, patient: { breathing: false } } },
  { name: "calm caller, severe: chest pain and sweating", expect: 1, patch: { incident: { type: "medical", description: "My husband has crushing chest pain and is sweating a lot, he's 64" }, patient: { conscious: true } } },
  { name: "robbery in progress", expect: 2, patch: { incident: { type: "crime", description: "I am being robbed right now" }, hazards: { weapon: false, violence_ongoing: false } } },
  { name: "covert call the agent missed: pizza order to 911", expect: 1, patch: { incident: { type: "other", description: "Caller asked to order a large pepperoni pizza to 41 Elm St and only answers yes or no" }, location: { address: "41 Elm St, Ypsilanti" } } },
  { name: "covert call flagged by agent", expect: 1, patch: { call_state: { covert: true, covert_cue: "whispering, man shouting in background" } } },
  { name: "house fire, child inside", expect: 1, patch: { incident: { type: "fire", description: "Smoke from the second floor, my neighbor's kid is still inside" }, hazards: { fire_or_smoke: true }, people: { vulnerable: ["child"] } } },
  { name: "contradiction: says no weapon, describes a gun", expect: 1, patch: { incident: { type: "crime", description: "A man is waving a gun in the parking lot" }, hazards: { weapon: false } } },
  { name: "fender bender, no injuries", expect: 3, patch: { incident: { type: "traffic", description: "Two cars bumped at the light, everyone is fine" }, people: { injured: 0, trapped: false } } },
  { name: "panicked caller, minor: locked out", expect: 4, patch: { incident: { type: "other", description: "I'm locked out of my car and freaking out" }, caller: { caller_safe: true } } },
  { name: "downed power line", expect: 2, patch: { incident: { type: "hazard", description: "A power line is down across the road, sparking" }, hazards: { downed_power_lines: true } } },
];

if (!geminiEnabled()) {
  console.error("Set GEMINI_API_KEY in .env first.");
  process.exit(1);
}

let agree = 0, p1Hit = 0, p1Total = 0;
const GAP_MS = Number(process.env.EVAL_GAP_MS ?? 3000); // stay under free-tier requests/minute
for (const [i, c] of cases.entries()) {
  if (i) await new Promise((r) => setTimeout(r, GAP_MS));
  const inc: Incident = emptyIncident(`eval_${c.name}`);
  mergeInto(inc, c.patch);
  inc.triage.rules = rulesFloor(inc);
  const t0 = Date.now();
  const llm = await runTriage(inc);
  const ms = Date.now() - t0;
  if (llm) applyLlmTriage(inc, llm);
  const final = finalPriority(inc).priority;
  if (final === c.expect) agree++;
  if (c.expect === 1) { p1Total++; if (final === 1) p1Hit++; }
  console.log(`${final === c.expect ? "✓" : "✗"} ${c.name}: rules P${inc.triage.rules.priority}, AI ${llm ? "P" + llm.priority : "—"}, final P${final}, expected P${c.expect} (${ms} ms)`);
  if (llm) console.log(`    ${llm.summary}${llm.contradictions.length ? `  ⚠ ${llm.contradictions.join("; ")}` : ""}`);
}
console.log(`\nAgreement ${agree}/${cases.length}. P1 recall ${p1Hit}/${p1Total}.`);
