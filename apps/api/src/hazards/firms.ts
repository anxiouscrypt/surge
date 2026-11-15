// NASA FIRMS observations, not fire perimeters. Keep the MAP_KEY on the server.
// Source: https://firms.modaps.eosdis.nasa.gov/api/area/
import type { Incident } from "@surge/shared";
import { config } from "../config.js";

export type Bbox = [number, number, number, number]; // west, south, east, north
export const FIRMS_SOURCE = "VIIRS_NOAA20_NRT";
const CACHE_MS = 5 * 60000;
const STALE_MS = 30 * 60000;
const CONTEXT_MAX_AGE_MS = 3 * 60 * 60000;
export type FirePoint = {
  lat: number;
  lng: number;
  detectedAt: string;
  confidence?: "l" | "n" | "h";
  source?: string;
  frp?: number;
};
export type FireFeed = {
  fires: FirePoint[];
  meta: {
    state: "ready" | "stale" | "unconfigured" | "error";
    source: string;
    resolutionMeters: number;
    bbox: Bbox;
    windowHours: number;
    fetchedAt: string | null;
    latestDetectionAt: string | null;
    warning: string | null;
    sourceUrl: string;
  };
};

export function parseBbox(value?: string): Bbox {
  const values =
    value === undefined
      ? [...config.dispatchBbox]
      : value.split(",").map(Number);
  if (
    values.length !== 4 ||
    values.some((n) => !Number.isFinite(n)) ||
    value?.split(",").some((n) => !n.trim())
  )
    throw new Error("bbox must contain west,south,east,north.");
  const [w, s, e, n] = values;
  if (w < -180 || e > 180 || s < -85 || n > 85 || w >= e || s >= n)
    throw new Error(
      "bbox must be a valid area between 85°S and 85°N, without crossing the date line.",
    );
  if (e - w > 30 || n - s > 20)
    throw new Error("Zoom in to load fire detections for a smaller area.");
  return [w, s, e, n];
}

// FIRMS is a CSV service. Invalid HTML/error responses must never become an empty all-clear.
export function parseFirmsCsv(text: string, now = Date.now()): FirePoint[] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("NASA returned malformed CSV.");
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  const header = rows.shift()?.map((v) => v.replace(/^\uFEFF/, "").trim());
  if (
    !header ||
    !["latitude", "longitude", "acq_date", "acq_time"].every((key) =>
      header.includes(key),
    )
  )
    throw new Error(
      "NASA returned an unexpected fire-data response. Check the FIRMS key and service status.",
    );
  const points = new Map<string, FirePoint>();
  let invalid = 0;
  for (const cells of rows) {
    const get = (key: string) => cells[header.indexOf(key)]?.trim() ?? "";
    const lat = Number(get("latitude")),
      lng = Number(get("longitude"));
    const day = get("acq_date"),
      time = get("acq_time").padStart(4, "0");
    const timestamp = `${day}T${time.slice(0, 2)}:${time.slice(2)}:00.000Z`;
    const ms = Date.parse(timestamp);
    if (
      !get("latitude") ||
      !get("longitude") ||
      !get("acq_time") ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !/^\d{4}$/.test(time) ||
      !Number.isFinite(ms) ||
      new Date(ms).toISOString() !== timestamp ||
      ms > now + 5 * 60000
    ) {
      invalid++;
      continue;
    }
    const confidence = get("confidence");
    const frp = Number(get("frp"));
    const point: FirePoint = {
      lat,
      lng,
      detectedAt: timestamp,
      source: FIRMS_SOURCE,
    };
    if (["l", "n", "h"].includes(confidence))
      point.confidence = confidence as "l" | "n" | "h";
    if (get("frp") && Number.isFinite(frp) && frp >= 0) point.frp = frp;
    points.set(`${lat},${lng},${timestamp}`, point);
  }
  if (invalid && !points.size)
    throw new Error(
      "NASA returned fire rows with no valid coordinates and observation times.",
    );
  return [...points.values()].sort((a, b) =>
    b.detectedAt.localeCompare(a.detectedAt),
  );
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) *
      Math.cos(toRad(b.lat)) *
      Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export class FirmsClient {
  private cache = new Map<string, { fires: FirePoint[]; fetchedAt: number }>();
  private pending = new Map<string, Promise<FireFeed>>();
  private failures = new Map<string, { at: number; message: string }>();
  private listeners = new Set<() => void>();
  constructor(
    private key: string,
    private fetcher: typeof fetch = fetch,
    private clock = () => Date.now(),
  ) {}
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private response(
    bbox: Bbox,
    state: FireFeed["meta"]["state"],
    warning: string | null,
  ): FireFeed {
    const entry = this.cache.get(bbox.join(","));
    const usable =
      entry && this.clock() - entry.fetchedAt <= STALE_MS ? entry : undefined;
    return {
      fires: usable?.fires ?? [],
      meta: {
        state,
        source: FIRMS_SOURCE,
        resolutionMeters: 375,
        bbox,
        windowHours: 24,
        fetchedAt: usable ? new Date(usable.fetchedAt).toISOString() : null,
        latestDetectionAt: usable?.fires[0]?.detectedAt ?? null,
        warning,
        sourceUrl: "https://firms.modaps.eosdis.nasa.gov/api/area/",
      },
    };
  }
  cached(bbox: Bbox): FirePoint[] {
    const entry = this.cache.get(bbox.join(","));
    return entry && this.clock() - entry.fetchedAt <= STALE_MS
      ? entry.fires
      : [];
  }
  async read(bbox: Bbox, force = false): Promise<FireFeed> {
    bbox = parseBbox(bbox.join(","));
    if (!this.key)
      return this.response(
        bbox,
        "unconfigured",
        "FIRMS_MAP_KEY is not configured on the server.",
      );
    const id = bbox.join(","),
      entry = this.cache.get(id),
      failure = this.failures.get(id);
    if (!force && entry && this.clock() - entry.fetchedAt < CACHE_MS)
      return this.response(bbox, "ready", null);
    if (!force && failure && this.clock() - failure.at < CACHE_MS)
      return this.response(
        bbox,
        entry && this.clock() - entry.fetchedAt <= STALE_MS ? "stale" : "error",
        failure.message,
      );
    const running = this.pending.get(id);
    if (running) return running;
    const task = this.fetchArea(bbox);
    this.pending.set(id, task);
    try {
      return await task;
    } finally {
      this.pending.delete(id);
    }
  }
  private async fetchArea(bbox: Bbox): Promise<FireFeed> {
    const id = bbox.join(",");
    try {
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(this.key)}/${FIRMS_SOURCE}/${id}/1`;
      const res = await this.fetcher(url, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok)
        throw new Error(`NASA FIRMS request failed (${res.status}).`);
      const fires = parseFirmsCsv(await res.text(), this.clock()).filter(
        (p) =>
          p.lng >= bbox[0] &&
          p.lng <= bbox[2] &&
          p.lat >= bbox[1] &&
          p.lat <= bbox[3],
      );
      this.cache.delete(id);
      this.cache.set(id, { fires, fetchedAt: this.clock() });
      this.failures.delete(id);
      while (this.cache.size > 24)
        this.cache.delete(this.cache.keys().next().value!);
      return this.response(bbox, "ready", null);
    } catch {
      // Do not log the fetch error or URL: the MAP_KEY is part of the request path.
      const message =
        "NASA FIRMS could not be refreshed. Check the server key, quota, or network.";
      this.failures.set(id, { at: this.clock(), message });
      while (this.failures.size > 24)
        this.failures.delete(this.failures.keys().next().value!);
      const old = this.cache.get(id);
      return this.response(
        bbox,
        old && this.clock() - old.fetchedAt <= STALE_MS ? "stale" : "error",
        message,
      );
    } finally {
      for (const listener of this.listeners) {
        try {
          listener();
        } catch {
          console.warn("NASA context refresh could not be published.");
        }
      }
    }
  }
  context(lat: number, lng: number): Incident["nasa_context"] {
    let best: { km: number; at: string } | null = null;
    const now = this.clock();
    for (const entry of this.cache.values()) {
      if (now - entry.fetchedAt > STALE_MS) continue;
      for (const point of entry.fires) {
        const age = now - Date.parse(point.detectedAt);
        if (age < 0 || age > CONTEXT_MAX_AGE_MS || point.confidence === "l")
          continue;
        const km = haversineKm({ lat, lng }, point);
        if (!best || km < best.km) best = { km, at: point.detectedAt };
      }
    }
    return {
      nearest_fire_km: best?.km ?? null,
      fire_detected_minutes_ago: best
        ? (now - Date.parse(best.at)) / 60000
        : null,
      inside_event: null,
    };
  }
}

export const firms = new FirmsClient(config.firmsKey);
export const readFires = (bbox = config.dispatchBbox) => firms.read(bbox);
export const getFires = () => firms.cached(config.dispatchBbox);
export async function refreshFires(): Promise<void> {
  await firms.read(config.dispatchBbox, true);
}
export async function nasaContextFor(
  lat: number,
  lng: number,
): Promise<Incident["nasa_context"]> {
  // Keep pin placement fast. Re-score from the event listener when the observation request completes.
  const bbox: Bbox = [
    Math.max(-180, Math.floor((lng - 0.15) * 10) / 10),
    Math.max(-85, Math.floor((lat - 0.15) * 10) / 10),
    Math.min(180, Math.ceil((lng + 0.15) * 10) / 10),
    Math.min(85, Math.ceil((lat + 0.15) * 10) / 10),
  ];
  if (bbox[0] < bbox[2] && bbox[1] < bbox[3])
    void firms.read(bbox).catch(() => {});
  return firms.context(lat, lng);
}
