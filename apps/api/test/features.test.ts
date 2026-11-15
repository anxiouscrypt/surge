import { describe, expect, it } from "vitest";
import { emptyIncident, type Incident } from "@surge/shared";
import { computeGroups, sameIncident } from "../src/geo/group.js";
import { splitIntersection } from "../src/geo/geocode.js";
import { computeMissing } from "../src/priority/missing.js";
import { baseScore } from "../src/priority/rules.js";
import { describeChanges } from "../src/timeline.js";
import { mergeInto } from "../src/store/memory.js";

const at = (id: string, lat: number, lng: number, type: Incident["incident"]["type"] = "fire", minutesAgo = 0): Incident => {
  const i = emptyIncident(id, new Date(Date.now() - minutesAgo * 60000));
  i.location.lat = lat;
  i.location.lng = lng;
  i.incident.type = type;
  return i;
};

describe("same-incident grouping", () => {
  it("groups nearby calls about the same emergency", () => {
    const a = at("a", 42.2425, -83.6191, "fire", 3);
    const b = at("b", 42.2433, -83.6187, "fire", 1); // ~90 m away
    expect(sameIncident(a, b)).toBe(true);
    const changed = computeGroups([a, b]);
    expect(changed).toHaveLength(2);
    expect(a.group).toEqual({ id: "a", size: 2, call_ids: ["a", "b"] });
    expect(b.group?.id).toBe("a"); // earliest call names the group
  });

  it("does not group different emergencies, far calls, or calls far apart in time", () => {
    const fire = at("f", 42.2425, -83.6191, "fire");
    expect(sameIncident(fire, at("m", 42.2426, -83.6191, "medical"))).toBe(false);
    expect(sameIncident(fire, at("far", 42.26, -83.6191, "fire"))).toBe(false);
    expect(sameIncident(fire, at("old", 42.2426, -83.6191, "fire", 90))).toBe(false);
    expect(sameIncident(fire, at("unknown", 42.2426, -83.6191, null))).toBe(true); // type not asked yet
  });

  it("clears the group when a call no longer matches", () => {
    const a = at("a", 42.2425, -83.6191);
    const b = at("b", 42.2426, -83.6191);
    computeGroups([a, b]);
    b.location.lat = 42.3;
    computeGroups([a, b]);
    expect(a.group).toBeNull();
    expect(b.group).toBeNull();
  });
});

describe("intersections", () => {
  it("splits two-street locations", () => {
    expect(splitIntersection("Washtenaw Ave & Golfside Rd, Ypsilanti, MI")).toEqual(["Washtenaw Ave", "Golfside Rd"]);
    expect(splitIntersection("Main and Washtenaw")).toEqual(["Main", "Washtenaw"]);
    expect(splitIntersection("Huron at Cross")).toEqual(["Huron", "Cross"]);
  });
  it("leaves street addresses alone", () => {
    expect(splitIntersection("302 Ballard St, Ypsilanti")).toBeNull();
    expect(splitIntersection("Ypsilanti Community High School")).toBeNull();
  });
});

describe("GPS from the caller's phone", () => {
  it("counts a precise fix as the location, so the agent does not ask for it", () => {
    const i = emptyIncident("g");
    expect(computeMissing(i)[0]).toBe("location");
    i.location.source = "gps";
    i.location.gps = { lat: 42.24, lng: -83.61, accuracy_m: 9, heading: null, speed_mps: null, at: new Date().toISOString() };
    expect(computeMissing(i)).not.toContain("location");
    expect(computeMissing(i)).not.toContain("location.read_back_confirmed");
  });
  it("still asks when the fix is too rough", () => {
    const i = emptyIncident("g2");
    i.location.source = "gps";
    i.location.gps = { lat: 42.24, lng: -83.61, accuracy_m: 900, heading: null, speed_mps: null, at: new Date().toISOString() };
    expect(computeMissing(i)[0]).toBe("location");
  });
  it("moves a dying phone up the queue", () => {
    const i = emptyIncident("b");
    const base = baseScore(i);
    i.device = { battery: 0.1, charging: false, language: "en", platform: "iPhone", online: true, last_seen: null };
    expect(baseScore(i)).toBe(base + 5);
    i.device.charging = true;
    expect(baseScore(i)).toBe(base);
  });
});

describe("timeline", () => {
  it("describes new facts in dispatcher words", () => {
    const i = emptyIncident("t");
    const changed = mergeInto(i, { patient: { breathing: false }, people: { injured: 0 }, location: { address: "15 N Huron St" } });
    const lines = describeChanges(i, changed);
    expect(lines).toHaveLength(3);
    expect(lines).toEqual(expect.arrayContaining(["Address: 15 N Huron St", "Nobody hurt", "Patient NOT breathing"]));
  });
  it("starts every call with a timeline entry", () => {
    expect(emptyIncident("x").timeline[0].text).toBe("Call answered by Surge AI");
  });
});
