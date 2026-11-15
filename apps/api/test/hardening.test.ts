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
