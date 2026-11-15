// Nearest fire station and hospital for the dispatcher. Loaded once for the whole dispatch area from
// OpenStreetMap (Overpass) and cached on disk, so no caller location is ever sent to a third party.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Incident } from "@surge/shared";
import { config } from "../config.js";
import { haversineKm } from "../hazards/firms.js";

type Place = { name: string; lat: number; lng: number; kind: "fire_station" | "hospital" };
const dataDir = fileURLToPath(new URL("../../data/", import.meta.url));
const cacheFile = dataDir + "places.json";
let places: Place[] = [];

export async function loadPlaces() {
  try {
    if (existsSync(cacheFile)) {
      places = JSON.parse(readFileSync(cacheFile, "utf8"));
      if (places.length) return;
    }
    const [w, s, e, n] = config.dispatchBbox;
    const box = `${s},${w},${n},${e}`;
    const q = `[out:json][timeout:25];(nwr["amenity"="fire_station"](${box});nwr["amenity"="hospital"](${box}););out center tags;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: new URLSearchParams({ data: q }),
      headers: { "User-Agent": "Surge-hackathon/0.1" },
      signal: AbortSignal.timeout(30000),
    });
    const json = (await res.json()) as { elements: any[] };
    places = json.elements
      .map((el) => ({
        name: (el.tags?.name as string | undefined)?.replace(/\u00a0/g, " ") ?? (el.tags?.amenity === "hospital" ? "Hospital" : "Fire station"),
        lat: el.lat ?? el.center?.lat,
        lng: el.lon ?? el.center?.lon,
        kind: el.tags?.amenity,
      }))
      .filter((p) => typeof p.lat === "number" && typeof p.lng === "number");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(places));
    console.log(`loaded ${places.length} fire stations and hospitals`);
  } catch (err) {
    console.warn("could not load fire stations/hospitals:", String(err).slice(0, 120));
  }
}

function nearest(lat: number, lng: number, kind: Place["kind"]) {
  let best: { name: string; km: number } | null = null;
  for (const p of places) {
    if (p.kind !== kind) continue;
    const km = haversineKm({ lat, lng }, p);
    if (!best || km < best.km) best = { name: p.name, km: Math.round(km * 10) / 10 };
  }
  return best;
}

export function nearbyFor(lat: number, lng: number): Incident["nearby"] {
  if (!places.length) return null;
  return { fire_station: nearest(lat, lng, "fire_station"), hospital: nearest(lat, lng, "hospital") };
}
