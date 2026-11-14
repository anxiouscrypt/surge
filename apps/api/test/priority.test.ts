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
