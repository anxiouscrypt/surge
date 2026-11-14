// NASA FIRMS + EONET context (docs/03 section 8). TODO: poll FIRMS every 5 min, EONET every 10 min, cache.
import type { Incident } from "@surge/shared";

export type FirePoint = { lat: number; lng: number; detectedAt: string };
let fires: FirePoint[] = [];

export function getFires(): FirePoint[] {
  return fires;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function nasaContextFor(lat: number, lng: number): Promise<Incident["nasa_context"]> {
  let best: { km: number; at: string } | null = null;
  for (const f of fires) {
    const km = haversineKm({ lat, lng }, f);
    if (!best || km < best.km) best = { km, at: f.detectedAt };
  }
  return {
    nearest_fire_km: best?.km ?? null,
    fire_detected_minutes_ago: best ? (Date.now() - Date.parse(best.at)) / 60000 : null,
    inside_event: null, // TODO: EONET point-in-polygon
  };
}

export async function refreshFires(): Promise<void> {
  // TODO: GET https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{w,s,e,n}/1
  fires = [];
}
