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
