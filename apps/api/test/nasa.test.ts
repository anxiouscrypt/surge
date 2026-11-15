import { describe, expect, it, vi } from "vitest";
import { FirmsClient, parseBbox, parseFirmsCsv } from "../src/hazards/firms";
import { hazards } from "../src/routes/hazards";

const NOW = Date.parse("2026-11-14T20:00:00Z");
const BOX: [number, number, number, number] = [-84, 42, -83, 43];
const HEADER = "latitude,longitude,acq_date,acq_time,confidence,frp\n";
const CSV = HEADER + "42.25,-83.62,2026-11-14,1915,n,12.4\n";
const mockFetch = (fn: (...args: any[]) => Promise<Response>) =>
  vi.fn(fn) as unknown as typeof fetch;

describe("FIRMS observations", () => {
  it("reads acquisition time as UTC and preserves resolution-relevant source metadata", () => {
    expect(parseFirmsCsv(CSV, NOW)).toEqual([
      {
        lat: 42.25,
        lng: -83.62,
        detectedAt: "2026-11-14T19:15:00.000Z",
        confidence: "n",
        frp: 12.4,
        source: "VIIRS_NOAA20_NRT",
      },
    ]);
  });
  it("supports midnight and quoted CSV, and deduplicates detections", () => {
    const data =
      HEADER +
      '"42.25","-83.62",2026-11-14,0,h,0\n42.25,-83.62,2026-11-14,0000,h,0\n';
    expect(parseFirmsCsv(data, NOW)).toHaveLength(1);
    expect(parseFirmsCsv(data, NOW)[0].detectedAt).toBe(
      "2026-11-14T00:00:00.000Z",
    );
  });
  it("distinguishes a valid empty feed from an upstream error", () => {
    expect(parseFirmsCsv(HEADER, NOW)).toEqual([]);
    expect(() => parseFirmsCsv("Invalid MAP_KEY", NOW)).toThrow();
    expect(() => parseFirmsCsv("<html>rate limited</html>", NOW)).toThrow();
  });
  it("rejects impossible coordinates, dates, and future acquisition times", () => {
    for (const row of [
      "94,-83,2026-11-14,1915,n,1",
      "42,-83,2026-02-30,1915,n,1",
      "42,-83,2026-11-14,2500,n,1",
      "42,-83,2026-11-15,1915,n,1",
    ]) {
      expect(() => parseFirmsCsv(HEADER + row, NOW)).toThrow();
    }
  });
  it("validates bbox order and limits requests to regional areas", () => {
    expect(parseBbox("-84,42,-83,43")).toEqual(BOX);
    for (const bbox of [
      "",
      "-84,,43,44",
      "42,-94,43,-93",
      "-180,-85,180,85",
      "170,40,-170,41",
      "-84,43,-83,42",
    ])
      expect(() => parseBbox(bbox)).toThrow();
  });
  it("does not make an upstream request or report an empty success without a key", async () => {
    const fetcher = mockFetch(async () => new Response(CSV));
    const result = await new FirmsClient("", fetcher, () => NOW).read(BOX);
    expect(result.meta.state).toBe("unconfigured");
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.meta.fetchedAt).toBeNull();
  });
  it("coalesces concurrent requests and caches by geographic coverage", async () => {
    const fetcher = mockFetch(async () => new Response(CSV));
    const client = new FirmsClient("test-key", fetcher, () => NOW);
    const [a, b] = await Promise.all([client.read(BOX), client.read(BOX)]);
    expect(a.meta.state).toBe("ready");
    expect(b.fires).toEqual(a.fires);
    await client.read(BOX);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.read([-90, 30, -89, 31]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("retains cached observations with an explicit stale state after upstream failure", async () => {
    let now = NOW;
    let fail = false;
    const fetcher = mockFetch(async () =>
      fail ? new Response("quota", { status: 429 }) : new Response(CSV),
    );
    const client = new FirmsClient("test-key", fetcher, () => now);
    await client.read(BOX);
    now += 6 * 60000;
    fail = true;
    const stale = await client.read(BOX);
    expect(stale.meta.state).toBe("stale");
    expect(stale.fires).toHaveLength(1);
    expect(stale.meta.warning).not.toContain("test-key");
    now += 31 * 60000;
    const expired = await client.read(BOX);
    expect(expired.meta.state).toBe("error");
    expect(expired.fires).toEqual([]);
    expect(client.context(42.25, -83.62)?.nearest_fire_km).toBeNull();
  });
  it("uses only recent, non-low-confidence observations for caller proximity", async () => {
    const rows =
      HEADER +
      "42.25,-83.62,2026-11-14,1915,l,1\n42.26,-83.63,2026-11-14,1200,h,1\n42.27,-83.64,2026-11-14,1930,n,1\n";
    const client = new FirmsClient(
      "test-key",
      mockFetch(async () => new Response(rows)),
      () => NOW,
    );
    await client.read(BOX);
    const context = client.context(42.25, -83.62);
    expect(context?.nearest_fire_km).toBeGreaterThan(1);
    expect(context?.fire_detected_minutes_ago).toBe(30);
    // A point detection never becomes an invented event boundary.
    expect(context?.inside_event).toBeNull();
  });
  it("rejects invalid API regions before attempting a NASA request", async () => {
    const response = await hazards.request(
      "http://localhost/fires?bbox=invalid&metadata=1",
    );
    expect(response.status).toBe(400);
  });
});
