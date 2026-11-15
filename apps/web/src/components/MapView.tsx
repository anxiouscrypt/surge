import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type { Incident } from "@surge/shared";
import {
  eventGeoJSON,
  fireGeoJSON,
  gibsTileURL,
  ageLabel,
  type FirePoint,
  type NaturalEvent,
  type Layers,
} from "../lib/nasa";
import { PRIORITY_COLOR, HOME } from "../lib/presentation";
import { Icon } from "./Icon";

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? "";
maplibregl.setWorkerUrl(mapWorkerUrl);

export type MapRequest = {
  key: number;
  center?: [number, number];
  zoom?: number;
  fit?: boolean;
};
type Props = {
  incidents: Incident[];
  selected: string | null;
  onSelect: (id: string) => void;
  events: NaturalEvent[];
  fires: FirePoint[];
  layers: Layers;
  imageryDate: string;
  request: MapRequest | null;
  follow: boolean;
  panelOpen: boolean;
  onEvent: (event: NaturalEvent) => void;
};
const STREET_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    streets: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    },
  },
  layers: [
    {
      id: "streets",
      type: "raster",
      source: "streets",
      paint: {
        "raster-saturation": -0.8,
        "raster-brightness-min": 0.68,
        "raster-brightness-max": 0.07,
      },
    },
  ],
};

export function MapView(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const mapLoaded = useRef(false);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const priorities = useRef(new Map<string, number>());
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageryError, setImageryError] = useState(false);
  const [center, setCenter] = useState(HOME);

  useEffect(() => {
    if (!el.current) return;
    mapLoaded.current = false;
    setReady(false);
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: el.current,
        style: TOKEN
          ? {
              version: 8,
              sources: {
                satellite: {
                  type: "raster",
                  tiles: [
                    `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}?access_token=${TOKEN}`,
                  ],
                  tileSize: 256,
                  attribution:
                    '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; OpenStreetMap',
                },
              },
              layers: [
                { id: "satellite", type: "raster", source: "satellite" },
              ],
            }
          : STREET_STYLE,
        center: HOME,
        zoom: 12.2,
        attributionControl: false,
        pitchWithRotate: false,
      });
    } catch {
      setError(
        "The map could not start. Check that WebGL is available, then reload.",
      );
      return;
    }
    map.current = m;
    m.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-left",
    );
    m.addControl(
      new maplibregl.ScaleControl({ unit: "metric", maxWidth: 100 }),
      "bottom-left",
    );
    const onLoad = () => {
      mapLoaded.current = true;
      setReady(true);
      setError(null);
    };
    m.on("load", onLoad);
    m.on("moveend", () => {
      const c = m.getCenter();
      setCenter([c.lng, c.lat]);
    });
    m.on("error", (e) => {
      const sourceId = (e as typeof e & { sourceId?: string }).sourceId;
      if (sourceId === "nasa-imagery") {
        setImageryError(true);
        return;
      }
      if (!m.isStyleLoaded() && !sourceId)
        setError("Map tiles could not load. Check the network or map token.");
    });
    const observer = new ResizeObserver(() => m.resize());
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      for (const marker of markers.current.values()) marker.remove();
      markers.current.clear();
      priorities.current.clear();
      m.remove();
      map.current = null;
      mapLoaded.current = false;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !mapLoaded.current) return;
    const live = new Set<string>();
    for (const inc of props.incidents) {
      const { lat, lng } = inc.location;
      if (
        lat == null ||
        lng == null ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      )
        continue;
      live.add(inc.call_id);
      let marker = markers.current.get(inc.call_id);
      if (!marker) {
        const node = document.createElement("button");
        node.type = "button";
        node.onclick = () => latest.current.onSelect(inc.call_id);
        marker = new maplibregl.Marker({ element: node, anchor: "center" })
          .setLngLat([lng, lat])
          .addTo(m);
        markers.current.set(inc.call_id, marker);
      }
      marker.setLngLat([lng, lat]);
      const node = marker.getElement();
      node.className = `caller-pin${inc.status === "ai_on_call" && inc.call_state.stage !== "ended" ? " is-live" : ""}${inc.location.geocode_confidence !== "high" ? " is-approx" : ""}${inc.call_id === props.selected ? " is-selected" : ""}`;
      node.style.setProperty("--priority", PRIORITY_COLOR[inc.final_priority]);
      node.textContent = `P${inc.final_priority}`;
      const label = `P${inc.final_priority}: ${inc.incident.type ?? "Collecting details"}, ${inc.location.address ?? "approximate location"}${inc.location.geocode_confidence !== "high" ? ", approximate" : ""}`;
      node.setAttribute("aria-label", label);
      node.setAttribute("aria-pressed", String(inc.call_id === props.selected));
      node.title = label;
      const previous = priorities.current.get(inc.call_id);
      priorities.current.set(inc.call_id, inc.final_priority);
      if (
        props.follow &&
        inc.final_priority === 1 &&
        previous !== 1 &&
        !props.selected
      ) {
        m.flyTo({
          center: [lng, lat],
          zoom: 14,
          pitch: 0,
          duration: 1400,
          padding: mapPadding(props.panelOpen),
        });
      }
    }
    for (const [id, marker] of markers.current)
      if (!live.has(id)) {
        marker.remove();
        markers.current.delete(id);
        priorities.current.delete(id);
      }
  }, [props.incidents, props.selected, props.follow, props.panelOpen, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !mapLoaded.current) return;
    const inc = props.incidents.find((i) => i.call_id === props.selected);
    if (inc?.location.lng != null && inc.location.lat != null)
      m.flyTo({
        center: [inc.location.lng, inc.location.lat],
        zoom: Math.max(14, m.getZoom()),
        padding: mapPadding(true),
        duration: 1000,
      });
    // Follow the selected caller if a location arrives after selection.
  }, [
    props.selected,
    props.incidents.find((i) => i.call_id === props.selected)?.location.lng,
    props.incidents.find((i) => i.call_id === props.selected)?.location.lat,
    ready,
  ]);

  useEffect(() => {
    const m = map.current;
    // A retained Home/Fit request must not override the selected caller after hot reload.
    if (!m || !ready || !mapLoaded.current || !props.request || props.selected) return;
    const { center: target, zoom, fit } = props.request;
    if (fit) {
      const points = latest.current.incidents.filter(
        (i) => i.location.lng != null && i.location.lat != null,
      );
      if (points.length) {
        const bounds = new maplibregl.LngLatBounds();
        for (const i of points)
          bounds.extend([i.location.lng!, i.location.lat!]);
        m.fitBounds(bounds, {
          padding: mapPadding(latest.current.panelOpen),
          maxZoom: 14,
          duration: 1100,
        });
      }
    } else if (target)
      m.flyTo({
        center: target,
        zoom: zoom ?? 9,
        padding: mapPadding(latest.current.panelOpen),
        duration: 1600,
      });
  }, [props.request, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !mapLoaded.current) return;
    const data = eventGeoJSON(props.events);
    if (m.getSource("nasa-events"))
      (m.getSource("nasa-events") as maplibregl.GeoJSONSource).setData(data);
    else {
      m.addSource("nasa-events", {
        type: "geojson",
        data,
        attribution: '<a href="https://eonet.gsfc.nasa.gov/">NASA EONET</a>',
      });
      m.addLayer({
        id: "event-fill",
        type: "fill",
        source: "nasa-events",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#c7b7fa", "fill-opacity": 0.12 },
      });
      m.addLayer({
        id: "event-line",
        type: "line",
        source: "nasa-events",
        filter: ["!=", ["geometry-type"], "Point"],
        paint: {
          "line-color": "#c7b7fa",
          "line-width": 2,
          "line-opacity": 0.8,
        },
      });
      m.addLayer({
        id: "event-point",
        type: "circle",
        source: "nasa-events",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#b8a0ed",
          "circle-stroke-color": "#e7dcff",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.8,
        },
      });
      for (const layer of ["event-point", "event-fill", "event-line"]) {
        m.on("click", layer, (e) => {
          const id = e.features?.[0]?.properties?.id;
          const event = latest.current.events.find((item) => item.id === id);
          if (event) latest.current.onEvent(event);
        });
        m.on("mouseenter", layer, () => {
          m.getCanvas().style.cursor = "pointer";
        });
        m.on("mouseleave", layer, () => {
          m.getCanvas().style.cursor = "";
        });
      }
    }
    for (const layer of ["event-fill", "event-line", "event-point"])
      m.setLayoutProperty(
        layer,
        "visibility",
        props.layers.events ? "visible" : "none",
      );
  }, [props.events, props.layers.events, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !mapLoaded.current) return;
    const data = fireGeoJSON(props.fires, Date.now());
    if (m.getSource("nasa-fires"))
      (m.getSource("nasa-fires") as maplibregl.GeoJSONSource).setData(data);
    else {
      m.addSource("nasa-fires", {
        type: "geojson",
        data,
        attribution:
          '<a href="https://firms.modaps.eosdis.nasa.gov/">NASA FIRMS</a>',
      });
      m.addLayer({
        id: "fire-points",
        type: "circle",
        source: "nasa-fires",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2, 12, 6],
          "circle-color": [
            "step",
            ["get", "age"],
            "#ff744a",
            60,
            "#f9b769",
            180,
            "#ad8158",
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffdfaf",
          "circle-opacity": 0.9,
        },
      });
      m.on("click", "fire-points", (e) => {
        const date = e.features?.[0]?.properties?.detectedAt;
        const content = document.createElement("div");
        const heading = document.createElement("strong");
        heading.textContent = "NASA FIRMS detection";
        const detail = document.createElement("p");
        detail.textContent = `Detected ${ageLabel(date)}. Satellite observation; not a fire perimeter.`;
        content.append(heading, detail);
        new maplibregl.Popup({ offset: 12, maxWidth: "260px" })
          .setLngLat(e.lngLat)
          .setDOMContent(content)
          .addTo(m);
      });
    }
    m.setLayoutProperty(
      "fire-points",
      "visibility",
      props.layers.fires ? "visible" : "none",
    );
  }, [props.fires, props.layers.fires, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !mapLoaded.current) return;
    setImageryError(false);
    if (m.getLayer("nasa-imagery")) m.removeLayer("nasa-imagery");
    if (m.getSource("nasa-imagery")) m.removeSource("nasa-imagery");
    if (!props.layers.imagery || !props.imageryDate) return;
    m.addSource("nasa-imagery", {
      type: "raster",
      tiles: [gibsTileURL(props.imageryDate)],
      tileSize: 256,
      maxzoom: 9,
      attribution:
        '<a href="https://worldview.earthdata.nasa.gov/">NASA GIBS / VIIRS NOAA-20</a>',
    });
    const firstOverlay = m
      .getStyle()
      .layers?.find(
        (layer) =>
          ("source" in layer &&
            (layer.source === "nasa-events" ||
              layer.source === "nasa-fires")) ||
          layer.type === "symbol",
      )?.id;
    m.addLayer(
      {
        id: "nasa-imagery",
        type: "raster",
        source: "nasa-imagery",
        paint: { "raster-opacity": 0.85 },
      },
      firstOverlay,
    );
  }, [props.layers.imagery, props.imageryDate, ready]);

  return (
    <div className="map-stage">
      <div
        ref={el}
        className="map"
        role="region"
        aria-label="Emergency callers and NASA observations map"
      />
      <div className="map-vignette" />
      {error && (
        <div className="map-error" role="alert">
          <Icon name="alert" />
          <span>{error}</span>
        </div>
      )}
      {imageryError && props.layers.imagery && (
        <div className="imagery-error" role="status">
          Some satellite tiles are unavailable for this date. Try an earlier
          day.
        </div>
      )}
      <div className="coordinates">
        <span className="coordinate-cross">+</span>
        {Math.abs(center[1]).toFixed(4)}° {center[1] < 0 ? "S" : "N"}{" "}
        <span>/</span> {Math.abs(center[0]).toFixed(4)}°{" "}
        {center[0] < 0 ? "W" : "E"}
        <span className="coordinate-rule" />
        {TOKEN ? "SATELLITE BASEMAP" : "STREET BASEMAP"}
      </div>
      <div
        className={`map-navigation${props.panelOpen ? " panel-is-open" : ""}`}
      >
        <button
          className="icon-button"
          aria-label="Zoom in"
          onClick={() => map.current?.zoomIn()}
        >
          <Icon name="plus" />
        </button>
        <button
          className="icon-button"
          aria-label="Zoom out"
          onClick={() => map.current?.zoomOut()}
        >
          <Icon name="minus" />
        </button>
        <button
          className="icon-button"
          aria-label="Reset map bearing"
          onClick={() => map.current?.resetNorth()}
        >
          <span className="north">N</span>
        </button>
      </div>
    </div>
  );
}
function mapPadding(panelOpen: boolean) {
  const width = window.innerWidth;
  if (width < 760) return { top: 90, bottom: 180, left: 45, right: 45 };
  return {
    top: 100,
    bottom: 100,
    left: width < 1100 ? 320 : 370,
    right: panelOpen && width > 1190 ? 410 : 80,
  };
}
