// Nominatim geocoding, biased to the dispatch area, cached. Respect the 1 req/s usage policy.
import { config } from "../config.js";
import { overpass } from "./overpass.js";

export type Geo = { lat: number; lng: number; confidence: "high" | "medium" | "low" };
const cache = new Map<string, Geo | null>();

export async function geocode(query: string): Promise<Geo | null> {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;
  // "Washtenaw Ave & Golfside Rd": Nominatim cannot find intersections; ask OpenStreetMap for the shared node.
  const streets = splitIntersection(query);
  if (streets) {
    const hit = await intersection(streets[0], streets[1]);
    if (hit) {
      cache.set(key, hit);
      return hit;
    }
    // Overpass busy: pin the first street near the area, marked approximate.
    const city = query.split(",").slice(1).join(",");
    const approx = await geocode(`${streets[0]}${city ? "," + city : ""}`);
    if (approx) {
      const geo = { ...approx, confidence: "low" as const };
      cache.set(key, geo);
      return geo;
    }
  }

  const [w, s, e, n] = config.dispatchBbox;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({ q: query, format: "jsonv2", limit: "1", addressdetails: "1", viewbox: `${w},${n},${e},${s}`, countrycodes: "us" }).toString();
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Surge-hackathon/0.1" } });
    const [hit] = (await res.json()) as any[];
    const geo: Geo | null = hit
      ? {
          lat: Number(hit.lat),
          lng: Number(hit.lon),
          confidence: hit.address?.house_number ? "high" : hit.address?.road ? "medium" : "low",
        }
      : null;
    cache.set(key, geo);
    return geo;
  } catch (err) {
    console.warn("geocode failed", err);
    return null;
  }
}

const reverseCache = new Map<string, string | null>();
/** Street address near a GPS fix, e.g. "41 Elm St, Ypsilanti". Cached per ~10 m cell. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (reverseCache.has(key)) return reverseCache.get(key)!;
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.search = new URLSearchParams({ lat: String(lat), lon: String(lng), format: "jsonv2", zoom: "18", addressdetails: "1" }).toString();
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Surge-hackathon/0.1" }, signal: AbortSignal.timeout(4000) });
    const hit = (await res.json()) as any;
    const a = hit?.address ?? {};
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    const city = a.city ?? a.town ?? a.village ?? a.hamlet ?? "";
    const out = street ? [street, city].filter(Boolean).join(", ") : hit?.display_name?.split(",").slice(0, 3).join(",") ?? null;
    reverseCache.set(key, out);
    return out;
  } catch (err) {
    console.warn("reverse geocode failed", String(err).slice(0, 120));
    return null;
  }
}

const SUFFIX = /\b(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|place|pl|parkway|pkwy|highway|hwy|way|trail|trl)\.?$/i;

/** "Washtenaw Ave & Golfside Rd, Ypsilanti" -> ["Washtenaw Ave", "Golfside Rd"]. */
export function splitIntersection(query: string): [string, string] | null {
  const head = query.split(",")[0];
  const parts = head.split(/\s*(?:&|\band\b|\bat\b|\/|@)\s*/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2 || parts.some((p) => /^\d/.test(p))) return null;
  return [parts[0], parts[1]];
}
const bareName = (p: string) => p.replace(SUFFIX, "").replace(/^(north|south|east|west|n|s|e|w)\.?\s+/i, "").trim();
async function intersection(a: string, b: string): Promise<Geo | null> {
  // 1) Overpass: the node both streets share. The public server is often busy, so retry once.
  const [w, s, e, n] = config.dispatchBbox;
  const box = `${s},${w},${n},${e}`;
  const esc = (x: string) => bareName(x).replace(/[^\w\s'-]/g, "");
  const q = `[out:json][timeout:10];way["highway"]["name"~"(^|\\s)${esc(a)}(\\s|$)",i](${box})->.a;way["highway"]["name"~"(^|\\s)${esc(b)}(\\s|$)",i](${box})->.b;node(w.a)(w.b);out 1;`;
  const json = await overpass<{ elements?: { lat: number; lon: number }[] }>(q, 6000);
  const node = json?.elements?.[0];
  if (node) return { lat: node.lat, lng: node.lon, confidence: "high" };
  return null;
}
