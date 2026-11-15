import { useEffect, useState } from "react";
import type { FeatureCollection, Geometry, Position } from "geojson";
import { API_URL } from "./api";

export const NASA_LAYER = "VIIRS_NOAA20_CorrectedReflectance_TrueColor";
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
export type FirePoint = { lat: number; lng: number; detectedAt: string };
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
const fetchFires = async (signal: AbortSignal) =>
  parseFires(await json(`${API_URL}/hazards/fires`, signal));
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
  const [feed, setFeed] = useState<Feed<T>>({
    data: initial,
    loading: true,
    error: null,
    fetchedAt: null,
  });
  useEffect(() => {
    let stopped = false;
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
  }, [fetcher, interval]);
  return feed;
}
const NO_EVENTS: NaturalEvent[] = [];
const NO_FIRES: FirePoint[] = [];
export function useNasa() {
  const events = useFeed(NO_EVENTS, fetchEvents, 10 * 60000);
  const fires = useFeed(NO_FIRES, fetchFires, 5 * 60000);
  const imagery = useFeed<string | null>(null, fetchImageryDate, 60 * 60000);
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
