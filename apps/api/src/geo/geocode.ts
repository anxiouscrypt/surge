// Nominatim geocoding, biased to the dispatch area, cached. Respect the 1 req/s usage policy.
import { config } from "../config.js";

export type Geo = { lat: number; lng: number; confidence: "high" | "medium" | "low" };
const cache = new Map<string, Geo | null>();

export async function geocode(query: string): Promise<Geo | null> {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;

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
