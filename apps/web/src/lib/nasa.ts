import { useCallback, useEffect, useState } from "react";
import type { FeatureCollection, Geometry, Position } from "geojson";
import { API_URL } from "./api";
import { IMAGERY_DATASET, type MapBounds } from "./nasaLinks";

export const NASA_LAYER = IMAGERY_DATASET;
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
export type FirePoint = {
  lat: number;
  lng: number;
  detectedAt: string;
  confidence?: "l" | "n" | "h";
  source?: string;
  frp?: number;
};
export type FireMeta = {
  state: "ready" | "stale" | "unconfigured" | "error" | "zoom_required";
  source: string;
  resolutionMeters: number;
  bbox: MapBounds | null;
  windowHours: number;
  fetchedAt: string | null;
  latestDetectionAt: string | null;
  warning: string | null;
};
export type FireFeed = Feed<FirePoint[]> & { meta: FireMeta | null };
type FireResponse = { fires: FirePoint[]; meta: FireMeta | null };
export type NaturalEvent = {
  id: string;
  title: string;
  date: string;
  category: string;
  geometry: Geometry;
  center: [number, number];
};
export type Feed<T> = {
  data: T;
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
  refresh?: () => void;
};
export type Layers = { fires: boolean; events: boolean; imagery: boolean };
const coordinatesValid = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length > 0 &&
  (typeof value[0] === "number"
    ? value.length >= 2 &&
      value.every((n) => typeof n === "number" && Number.isFinite(n)) &&
      Math.abs(value[0]) <= 180 &&
      Math.abs(value[1]) <= 90
    : value.every(coordinatesValid));

export function positions(geometry: Geometry): Position[] {
  if (geometry.type === "GeometryCollection")
    return geometry.geometries.flatMap(positions);
  const flat = (c: unknown): Position[] =>
    Array.isArray(c) && typeof c[0] === "number"
      ? [c as Position]
      : (c as unknown[]).flatMap(flat);
  return flat(geometry.coordinates);
}
export function parseEvents(raw: unknown): NaturalEvent[] {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("features" in raw) ||
    !Array.isArray(raw.features)
  )
    throw new Error("NASA returned an unexpected event feed.");
  const latest = new Map<string, NaturalEvent>();
  for (const feature of raw.features) {
    const p = feature?.properties;
    const g = feature?.geometry;
    if (
      !p ||
      typeof p.id !== "string" ||
      typeof p.title !== "string" ||
      p.closed != null ||
      !g ||
      ![
        "Point",
        "MultiPoint",
        "LineString",
        "MultiLineString",
        "Polygon",
        "MultiPolygon",
      ].includes(g.type) ||
      !coordinatesValid(g.coordinates)
    )
      continue;
    const geometry = g as Geometry;
    const pts = positions(geometry);
    const pt = geometry.type === "LineString" ? pts[pts.length - 1] : pts[0];
    const date =
      typeof p.date === "string"
        ? p.date
        : Array.isArray(p.geometryDates)
          ? p.geometryDates[p.geometryDates.length - 1]
          : "";
    const event: NaturalEvent = {
      id: p.id,
      title: p.title,
      date,
      category: p.categories?.[0]?.title ?? "Natural event",
      geometry,
      center: [pt[0], pt[1]],
    };
    const old = latest.get(p.id);
    if (!old || Date.parse(date) > Date.parse(old.date))
      latest.set(p.id, event);
  }
  return [...latest.values()].sort(
    (a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0),
  );
}
export function parseFires(raw: unknown): FirePoint[] {
  if (!Array.isArray(raw))
    throw new Error("Fire detections are not available from the backend yet.");
  return raw.filter(
    (p): p is FirePoint =>
      p != null &&
      Number.isFinite(p.lat) &&
      Math.abs(p.lat) <= 90 &&
      Number.isFinite(p.lng) &&
      Math.abs(p.lng) <= 180 &&
      typeof p.detectedAt === "string" &&
      Number.isFinite(Date.parse(p.detectedAt)),
  );
}
async function json(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Feed unavailable (${response.status}).`);
  return response.json() as Promise<unknown>;
}
const fetchEvents = async (signal: AbortSignal) =>
  parseEvents(
    await json(
      "https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=200",
      signal,
    ),
  );
async function fetchFireArea(
  bounds: MapBounds | null,
  signal: AbortSignal,
): Promise<FireResponse> {
  if (!bounds)
    return {
      fires: [],
      meta: {
        state: "zoom_required",
        source: "VIIRS_NOAA20_NRT",
        resolutionMeters: 375,
        bbox: null,
        windowHours: 24,
        fetchedAt: null,
        latestDetectionAt: null,
        warning: "Zoom in to a regional view to load fire detections.",
      },
    };
  const url = `${API_URL}/hazards/fires?metadata=1&bbox=${bounds.join(",")}`;
  const result = (await json(url, signal)) as
    | { fires?: unknown; meta?: FireMeta }
    | unknown[];
  // Keep compatibility with an older backend during rolling integration.
  if (Array.isArray(result)) return { fires: parseFires(result), meta: null };
  if (
    !result ||
    !result.meta ||
    !["ready", "stale", "unconfigured", "error"].includes(result.meta.state)
  )
    throw new Error("Fire-data provenance is unavailable.");
  return { fires: parseFires(result.fires), meta: result.meta };
}
async function fetchImageryDate(signal: AbortSignal): Promise<string> {
  const response = await fetch(`${GIBS}/1.0.0/WMTSCapabilities.xml`, {
    signal,
  });
  if (!response.ok) throw new Error("Imagery metadata unavailable.");
  const xml = new DOMParser().parseFromString(
    await response.text(),
    "application/xml",
  );
  const layer = [...xml.getElementsByTagNameNS("*", "Layer")].find((l) =>
    [...l.children].some(
      (n) => n.localName === "Identifier" && n.textContent === NASA_LAYER,
    ),
  );
  const date = layer?.getElementsByTagNameNS("*", "Default")[0]?.textContent;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("Imagery date unavailable.");
  return date;
}
function useFeed<T>(
  initial: T,
  fetcher: (signal: AbortSignal) => Promise<T>,
  interval: number,
): Feed<T> {
  const [revision, setRevision] = useState(0);
  const refreshNow = useCallback(
    () => setRevision((current) => current + 1),
    [],
  );
  const [feed, setFeed] = useState<Feed<T>>({
    data: initial,
    loading: true,
    error: null,
    fetchedAt: null,
  });
  useEffect(() => {
    let stopped = false;
    setFeed({ data: initial, loading: true, error: null, fetchedAt: null });
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    const refresh = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const data = await fetcher(controller.signal);
        if (!stopped)
          setFeed({ data, loading: false, error: null, fetchedAt: Date.now() });
      } catch (error) {
        if (!stopped)
          setFeed((previous) => ({
            ...previous,
            loading: false,
            error: error instanceof Error ? error.message : "Feed unavailable.",
          }));
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(refresh, interval);
      }
    };
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [fetcher, interval, initial, revision]);
  return { ...feed, refresh: refreshNow };
}
const NO_EVENTS: NaturalEvent[] = [];
const NO_FIRE_RESPONSE: FireResponse = { fires: [], meta: null };
export function useNasa(bounds: MapBounds | null) {
  const area = bounds?.join(",") ?? "";
  const fetchArea = useCallback(
    (signal: AbortSignal) =>
      fetchFireArea(
        area ? (area.split(",").map(Number) as MapBounds) : null,
        signal,
      ),
    [area],
  );
  const events = useFeed(NO_EVENTS, fetchEvents, 10 * 60000);
  const observations = useFeed(NO_FIRE_RESPONSE, fetchArea, 5 * 60000);
  const imagery = useFeed<string | null>(null, fetchImageryDate, 60 * 60000);
  const meta = observations.data.meta;
  const fires: FireFeed = {
    data: observations.data.fires,
    loading: observations.loading,
    error:
      observations.error ??
      (meta && ["error", "unconfigured", "stale"].includes(meta.state)
        ? meta.warning
        : null),
    fetchedAt: meta?.fetchedAt
      ? Date.parse(meta.fetchedAt)
      : observations.fetchedAt,
    meta,
    refresh: observations.refresh,
  };
  return { events, fires, imagery };
}
export function eventGeoJSON(events: NaturalEvent[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: events.map((event) => ({
      type: "Feature",
      geometry: event.geometry,
      properties: {
        id: event.id,
        title: event.title,
        date: event.date,
        category: event.category,
      },
    })),
  };
}
export function fireGeoJSON(
  fires: FirePoint[],
  now: number,
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: fires.map((fire) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [fire.lng, fire.lat] },
      properties: {
        detectedAt: fire.detectedAt,
        age: Math.max(0, (now - Date.parse(fire.detectedAt)) / 60000),
        confidence: fire.confidence ?? "unknown",
        source: fire.source ?? "NASA FIRMS",
      },
    })),
  };
}
export function gibsTileURL(date: string) {
  return `${GIBS}/${NASA_LAYER}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg`;
}
export function ageLabel(
  date: string | number | null,
  now = Date.now(),
): string {
  if (date === null) return "Not received";
  const time = typeof date === "number" ? date : Date.parse(date);
  if (!Number.isFinite(time)) return "Date unavailable";
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
