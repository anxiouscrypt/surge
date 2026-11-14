import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import type { Incident } from "@surge/shared";
import { PRIORITY_COLOR } from "./PriorityBadge";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN ?? "";
const HOME: [number, number] = [-83.74, 42.25]; // Washtenaw County

export function MapView({ incidents, onSelect }: { incidents: Incident[]; onSelect: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map>();
  const markers = useRef(new Map<string, mapboxgl.Marker>());
  const flown = useRef(new Set<string>());

  useEffect(() => {
    if (!el.current || !mapboxgl.accessToken) return;
    map.current = new mapboxgl.Map({ container: el.current, style: "mapbox://styles/mapbox/satellite-streets-v12", center: HOME, zoom: 10 });
    // TODO: NASA layers — FIRMS fire points, EONET event outlines, GIBS imagery toggle.
    return () => map.current?.remove();
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const live = new Set<string>();
    for (const inc of incidents) {
      const { lat, lng } = inc.location;
      if (lat == null || lng == null) continue;
      live.add(inc.call_id);
      let mk = markers.current.get(inc.call_id);
      if (!mk) {
        const dot = document.createElement("div");
        dot.className = "pin";
        dot.onclick = () => onSelect(inc.call_id);
        mk = new mapboxgl.Marker({ element: dot }).setLngLat([lng, lat]).addTo(m);
        markers.current.set(inc.call_id, mk);
      }
      mk.setLngLat([lng, lat]);
      const node = mk.getElement();
      node.style.background = PRIORITY_COLOR[inc.final_priority];
      node.classList.toggle("pulse", inc.status === "ai_on_call");
      node.classList.toggle("approx", inc.location.geocode_confidence === "low");
      if (inc.final_priority === 1 && !flown.current.has(inc.call_id)) {
        flown.current.add(inc.call_id);
        m.flyTo({ center: [lng, lat], zoom: 16, pitch: 60, duration: 2500 });
      }
    }
    for (const [id, mk] of markers.current) if (!live.has(id)) { mk.remove(); markers.current.delete(id); }
  }, [incidents, onSelect]);

  if (!mapboxgl.accessToken) return <div className="map map-missing">Set VITE_MAPBOX_TOKEN in .env to show the map</div>;
  return <div ref={el} className="map" />;
}
