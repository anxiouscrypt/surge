import { describe, expect, it } from "vitest";
import { emptyIncident, type Incident } from "@surge/shared";
import { rulesFloor, finalPriority } from "../src/priority/rules";
import { computeMissing } from "../src/priority/missing";
import { mergeInto } from "../src/store/memory";

const make = (patch: Record<string, any> = {}): Incident => {
  const i = emptyIncident("t");
  mergeInto(i, patch);
  return i;
};

describe("rules floor", () => {
  it.each([
    ["not breathing", { patient: { breathing: false } }],
    ["unconscious", { patient: { conscious: false } }],
    ["trapped", { people: { trapped: true } }],
    ["weapon", { hazards: { weapon: true } }],
    ["violence ongoing", { hazards: { violence_ongoing: true } }],
    ["fire with people", { hazards: { fire_or_smoke: true }, people: { involved: 2 } }],
  ])("%s -> P1 with escalate", (_, patch) => {
    const r = rulesFloor(make(patch));
    expect(r.priority).toBe(1);
    expect(r.escalate).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("injury with unknown breathing/consciousness -> P2", () => {
    expect(rulesFloor(make({ people: { injured: 1 } })).priority).toBe(2);
  });

  it("near a NASA fire detection -> at least P2", () => {
    const i = make({ incident: { type: "other" } });
    i.nasa_context = { nearest_fire_km: 0.8, fire_detected_minutes_ago: 14, inside_event: null };
    expect(rulesFloor(i).priority).toBe(2);
  });

  it("unknown is not no: empty incident is P4 with a reason", () => {
    const r = rulesFloor(make());
    expect(r.priority).toBe(4);
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});

describe("final priority", () => {
  it("classifier can raise to P1", () => {
    const i = make({ incident: { type: "traffic" } });
    i.triage.rules = rulesFloor(i);
    i.triage.classifier = { priority: 1, p1_probability: 0.9 };
    expect(finalPriority(i).priority).toBe(1);
  });

  it("AI layers never lower a rules P1", () => {
    const i = make({ patient: { breathing: false } });
    i.triage.rules = rulesFloor(i);
    i.triage.llm = { priority: 3, reasons: [], units: [], summary: "", contradictions: [], confidence: 0.9 };
    i.triage.classifier = { priority: 4, p1_probability: 0.01 };
    expect(finalPriority(i).priority).toBe(1);
  });
});

describe("missing checklist", () => {
  it("asks location first", () => {
    expect(computeMissing(make())[0]).toBe("location");
  });
  it("asks breathing/consciousness for medical", () => {
    const m = computeMissing(make({ incident: { type: "medical" } }));
    expect(m).toContain("patient.breathing");
    expect(m).toContain("patient.conscious");
  });
});

describe("merge", () => {
  it("null never overwrites a known value", () => {
    const i = make({ people: { trapped: true } });
    mergeInto(i, { people: { trapped: null } });
    expect(i.people.trapped).toBe(true);
  });
});

describe("salvage", async () => {
  const { salvage } = await import("../src/routes/tools");
  it("keeps valid fields when one field is invalid", () => {
    const r = salvage({ call_id: "c", call_sid: 5, location: { address: "1 Huron St" }, incident: { type: "robbery" } });
    expect(r.data?.location?.address).toBe("1 Huron St");
    expect(r.dropped).toEqual(expect.arrayContaining(["call_sid", "incident.type"]));
  });
  it("drops unknown keys", () => {
    const r = salvage({ call_id: "c", foo: 1, people: { involved: 2 } });
    expect(r.data?.people?.involved).toBe(2);
    expect(r.dropped).toContain("foo");
  });
  it("rejects a missing call_id", () => {
    expect(salvage({ location: { address: "x" } }).data).toBeNull();
  });
});

describe("gemini triage merge", async () => {
  const { applyLlmTriage, LlmTriage } = await import("../src/ai/gemini");
  it("AI can raise a robbery in progress above the rules floor, with evidence", () => {
    const i = make({ incident: { type: "crime", description: "I am being robbed" }, hazards: { weapon: false, violence_ongoing: false } });
    i.triage.rules = rulesFloor(i);
    expect(i.triage.rules.priority).toBe(3);
    applyLlmTriage(i, LlmTriage.parse({ priority: 2, reasons: [{ text: "Robbery in progress", evidence_field: "incident.description" }], units: ["police"], summary: "Caller is being robbed now.", contradictions: [], confidence: 0.8 }));
    const f = finalPriority(i);
    expect(f.priority).toBe(2);
    expect(f.reasons.find((r) => r.source === "ai")?.evidence_field).toBe("incident.description");
  });
  it("AI never lowers a rules P1", () => {
    const i = make({ people: { trapped: true } });
    i.triage.rules = rulesFloor(i);
    applyLlmTriage(i, LlmTriage.parse({ priority: 4, reasons: [], units: [], summary: "x", contradictions: [], confidence: 0.9 }));
    expect(finalPriority(i).priority).toBe(1);
  });
  it("rejects output without evidence", () => {
    expect(LlmTriage.safeParse({ priority: 1, reasons: [{ text: "x", evidence_field: "" }], units: [], summary: "s", contradictions: [], confidence: 1 }).success).toBe(false);
  });
});

describe("covert calls", async () => {
  const { handleAgentUpdate } = await import("../src/pipeline");
  const { tools } = await import("../src/routes/tools");

  it("covert flag alone is P1, even with nothing else known", () => {
    const r = rulesFloor(make({ call_state: { covert: true, covert_cue: "whispering" } }));
    expect(r.priority).toBe(1);
    expect(r.reasons[0].evidence_field).toBe("call_state.covert");
  });

  it("never asks for a callback number or whether the caller is safe", () => {
    const m = computeMissing(make({ call_state: { covert: true } }));
    expect(m).not.toContain("caller.callback");
    expect(m).not.toContain("caller.caller_safe");
    expect(m[0]).toBe("location");
  });

  it("agent is never told to announce escalation out loud", async () => {
    const reply = await handleAgentUpdate({ call_id: "covert_1", call_state: { covert: true, covert_cue: "pizza order" } });
    expect(reply.escalate).toBe(false);
  });

  it("get_status stays neutral on a covert call", async () => {
    await handleAgentUpdate({ call_id: "covert_2", call_state: { covert: true } });
    const res = await tools.request("/get_status", { method: "POST", body: JSON.stringify({ call_id: "covert_2" }), headers: { "content-type": "application/json" } });
    const { text } = (await res.json()) as { text: string };
    expect(text).not.toMatch(/dispatcher|911|priority|help/i);
  });
});
