import { afterEach, describe, expect, it } from "vitest";
import { dispatcherAllowed, viaTunnel } from "../src/auth.js";
import { limiter } from "../src/limit.js";

const h = (o: Record<string, string>) => new Headers(o);
const url = (q = "") => new URL(`http://x/incidents${q}`);

describe("dashboard key", () => {
  afterEach(() => {
    delete process.env.DASHBOARD_KEY;
  });
  it("always allows the laptop itself", () => {
    expect(dispatcherAllowed(h({}), url())).toBe(true);
  });
  it("blocks the public link without a key", () => {
    expect(viaTunnel(h({ "cf-ray": "1" }))).toBe(true);
    expect(dispatcherAllowed(h({ "cf-connecting-ip": "1.2.3.4" }), url())).toBe(false);
    process.env.DASHBOARD_KEY = "secret123";
    expect(dispatcherAllowed(h({ "cf-connecting-ip": "1.2.3.4" }), url())).toBe(false);
    expect(dispatcherAllowed(h({ "cf-connecting-ip": "1.2.3.4" }), url("?key=wrong"))).toBe(false);
  });
  it("allows the public link with the right key, by header or query", () => {
    process.env.DASHBOARD_KEY = "secret123";
    expect(dispatcherAllowed(h({ "cf-ray": "1", "x-dashboard-key": "secret123" }), url())).toBe(true);
    expect(dispatcherAllowed(h({ "cf-ray": "1" }), url("?key=secret123"))).toBe(true);
  });
});

describe("rate limiter", () => {
  it("allows up to max per window, per key", () => {
    const ok = limiter(2, 60000);
    expect([ok("a"), ok("a"), ok("a"), ok("b")]).toEqual([true, true, false, true]);
  });
});

import { emptyIncident } from "@surge/shared";
import { backfill } from "../src/routes/webhooks.js";

describe("post-call backfill", () => {
  it("fills only unknown fields and never overwrites live facts", () => {
    const i = emptyIncident("w");
    i.patient.breathing = true; // confirmed live
    const filled = backfill(i, {
      breathing: { value: false },
      trapped: { value: "true" },
      people_injured: { value: 2 },
      incident_type: { value: "Medical" },
      address: { value: "15 N Huron St" },
      weapon: { value: null },
    });
    expect(i.patient.breathing).toBe(true);
    expect(i.people.trapped).toBe(true);
    expect(i.people.injured).toBe(2);
    expect(i.incident.type).toBe("medical");
    expect(i.hazards.weapon).toBeNull();
    expect(filled.sort()).toEqual(["incident.type", "location.address", "people.injured", "people.trapped"]);
  });
  it("never adds a callback number to a covert call", () => {
    const i = emptyIncident("c");
    i.call_state.covert = true;
    backfill(i, { callback_number: { value: "+17345550100" } });
    expect(i.caller.phone).toBeNull();
  });
});
