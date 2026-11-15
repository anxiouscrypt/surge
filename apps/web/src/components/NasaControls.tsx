import { useState } from "react";
import {
  ageLabel,
  type Feed,
  type FireFeed,
  type NaturalEvent,
  type Layers,
} from "../lib/nasa";
import { Icon } from "./Icon";
import {
  eventBounds,
  worldviewURL,
  snapshotURL,
  type MapBounds,
} from "../lib/nasaLinks";

type Props = {
  events: Feed<NaturalEvent[]>;
  fires: FireFeed;
  bounds: MapBounds | null;
  imagery: Feed<string | null>;
  layers: Layers;
  setLayers: (layers: Layers) => void;
  date: string;
  setDate: (date: string) => void;
  onEvent: (event: NaturalEvent) => void;
  selectedEvent: NaturalEvent | null;
  onCloseEvent: () => void;
  now: number;
};
export function NasaControls(p: Props) {
  const [expanded, setExpanded] = useState(false);
  const [browse, setBrowse] = useState(false);
  const toggled = Object.values(p.layers).filter(Boolean).length;
  const toggle = (key: keyof Layers) =>
    p.setLayers({ ...p.layers, [key]: !p.layers[key] });
  const observed = p.fires.data.reduce<string | null>(
    (latest, fire) =>
      !latest || fire.detectedAt > latest ? fire.detectedAt : latest,
    null,
  );
  return (
    <div className="nasa-controls">
      <button
        className={`layers-button glass${expanded ? " expanded" : ""}`}
        aria-label="NASA Earth observation layers"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="nasa-layers"
      >
        <span className="nasa-orbit">
          <Icon name="globe" size={21} />
        </span>
        <span>
          <strong>Earth observations</strong>
          <small>NASA · {toggled} layers enabled</small>
        </span>
        <Icon name="layers" size={17} />
      </button>
      {expanded && (
        <section
          className="layers-panel glass"
          id="nasa-layers"
          aria-label="NASA map layers"
        >
          <div className="section-eyebrow">
            MAP LAYERS <span>NASA OPEN DATA</span>
          </div>
          <label className="layer-row">
            <span className="layer-symbol fire-symbol">
              <Icon name="fire" />
            </span>
            <span>
              <strong>Fire detections</strong>
              <small>
                {p.fires.loading
                  ? "Checking the visible area…"
                  : p.fires.meta?.state === "unconfigured"
                    ? "Server FIRMS key not configured"
                    : p.fires.meta?.state === "zoom_required"
                      ? "Zoom in to load detections"
                      : p.fires.error
                        ? p.fires.data.length
                          ? "Feed unavailable · cached detections"
                          : "Fire-data feed unavailable"
                        : p.fires.data.length
                          ? `${p.fires.data.length} detections · latest ${ageLabel(observed, p.now)}`
                          : "No detections returned for this area"}
              </small>
            </span>
            <input
              type="checkbox"
              checked={p.layers.fires}
              onChange={() => toggle("fires")}
            />
          </label>
          <label className="layer-row">
            <span className="layer-symbol event-symbol">
              <Icon name="globe" />
            </span>
            <span>
              <strong>Natural events</strong>
              <small>
                {p.events.loading
                  ? "Connecting to EONET…"
                  : p.events.error
                    ? p.events.data.length
                      ? "Feed unavailable · cached events"
                      : "NASA feed unavailable"
                    : `${p.events.data.length} tracked open events worldwide`}
              </small>
            </span>
            <input
              type="checkbox"
              checked={p.layers.events}
              onChange={() => toggle("events")}
            />
          </label>
          <label className="layer-row">
            <span className="layer-symbol imagery-symbol">
              <Icon name="layers" />
            </span>
            <span>
              <strong>Satellite imagery</strong>
              <small>VIIRS NOAA-20 · regional imagery</small>
            </span>
            <input
              type="checkbox"
              checked={p.layers.imagery}
              disabled={!p.imagery.data}
              onChange={() => toggle("imagery")}
            />
          </label>
          {p.layers.imagery && (
            <label className="imagery-date">
              <span>Imagery date (UTC)</span>
              <input
                aria-label="Satellite imagery date"
                type="date"
                value={p.date}
                max={p.imagery.data ?? undefined}
                min="2018-01-05"
                onChange={(e) => {
                  if (e.target.value) p.setDate(e.target.value);
                }}
              />
              <small>
                Cloud cover and gaps may be present. Not a live camera.
              </small>
            </label>
          )}
          {p.fires.meta && (
            <div className="fire-coverage">
              <span>FIRMS query · {p.fires.meta.windowHours / 24} day</span>
              <small>
                {p.fires.meta.bbox
                  ? p.fires.meta.bbox
                      .map((value) => value.toFixed(1))
                      .join(", ") + " (W,S,E,N)"
                  : "Regional coverage requires a closer map view"}
              </small>
              {p.fires.meta.fetchedAt && (
                <small>
                  Retrieved {ageLabel(p.fires.meta.fetchedAt, p.now)} ·{" "}
                  {p.fires.meta.resolutionMeters} m pixels
                </small>
              )}
              {p.fires.meta.state === "stale" && (
                <strong>Cached observations. The latest request failed.</strong>
              )}
              {p.fires.meta.state === "ready" && !p.fires.data.length && (
                <small>
                  No detections does not establish that the area is safe.
                </small>
              )}
            </div>
          )}
          {p.imagery.error && (
            <p className="feed-note">
              Satellite metadata unavailable. Retry happens automatically.
            </p>
          )}
          <button
            className="browse-events"
            onClick={() => setBrowse(!browse)}
            aria-expanded={browse}
          >
            Explore active events <span>{p.events.data.length}</span>
            <Icon name="chevron" size={14} />
          </button>
          {browse && (
            <div className="event-list">
              {p.events.data.length ? (
                p.events.data.map((event) => (
                  <button key={event.id} onClick={() => p.onEvent(event)}>
                    <span className="event-dot" />
                    <span>
                      <strong>{event.title}</strong>
                      <small>
                        {event.category} · observed{" "}
                        {ageLabel(event.date, p.now)}
                      </small>
                    </span>
                    <Icon name="arrow" size={13} />
                  </button>
                ))
              ) : (
                <p className="feed-note">
                  {p.events.loading
                    ? "Loading NASA events…"
                    : p.events.error
                      ? "Events unavailable. The feed will retry automatically."
                      : "No open events returned."}
                </p>
              )}
            </div>
          )}
          <details className="data-provenance">
            <summary>Dataset details & sources</summary>
            <dl>
              <div>
                <dt>Fire detections</dt>
                <dd>
                  NASA FIRMS · VIIRS NOAA-20 NRT · nominal 375 m pixels ·
                  one-day query.
                </dd>
              </div>
              <div>
                <dt>Satellite imagery</dt>
                <dd>
                  NASA GIBS · NOAA-20 corrected reflectance (true color). VIIRS
                  sensor bands are 375–750 m; zooming in does not add building
                  detail.
                </dd>
              </div>
              <div>
                <dt>Event locations</dt>
                <dd>
                  NASA EONET v3 · event observation dates are shown separately
                  from retrieval time.
                </dd>
              </div>
            </dl>
            <p>
              Clouds, nighttime, and coverage gaps can obscure the scene.
              Thermal anomalies may include sources other than wildfires. A
              satellite pixel is not a fire boundary.
            </p>
            {p.bounds && p.date && (
              <a
                href={worldviewURL(p.bounds, p.date)}
                target="_blank"
                rel="noreferrer"
              >
                Compare this area in NASA Worldview ↗
              </a>
            )}
            <a
              href="https://firms.modaps.eosdis.nasa.gov/api/area/"
              target="_blank"
              rel="noreferrer"
            >
              FIRMS dataset and API ↗
            </a>
            <a
              href="https://nasa-gibs.github.io/gibs-api-docs/access-basics/"
              target="_blank"
              rel="noreferrer"
            >
              GIBS imagery documentation ↗
            </a>
            <p className="track-credit">
              Supported by the Michigan Space Grant Consortium, NASA grant
              80NSSC20M0124.
            </p>
          </details>
          <button
            className="refresh-nasa"
            disabled={p.events.loading || p.fires.loading}
            onClick={() => {
              p.events.refresh?.();
              p.fires.refresh?.();
              p.imagery.refresh?.();
            }}
          >
            ↻ Refresh NASA feeds
          </button>
          <div className="layer-footnote">
            <span
              className={`status-dot${p.events.error || !p.events.fetchedAt ? " muted-dot" : ""}`}
            />
            {p.events.fetchedAt
              ? `EONET checked ${ageLabel(p.events.fetchedAt, p.now)}`
              : "Waiting for EONET"}
            <a
              href="https://eonet.gsfc.nasa.gov/docs/v3"
              target="_blank"
              rel="noreferrer"
              aria-label="NASA EONET data documentation"
            >
              Source ↗
            </a>
          </div>
        </section>
      )}
      {p.selectedEvent && (
        <section className="event-selection glass">
          <button
            className="icon-button"
            onClick={p.onCloseEvent}
            aria-label="Close NASA event"
          >
            <Icon name="close" size={14} />
          </button>
          <span className="section-eyebrow">NASA EONET EVENT</span>
          <h3>{p.selectedEvent.title}</h3>
          <p>
            {p.selectedEvent.category} · observed{" "}
            {ageLabel(p.selectedEvent.date, p.now)}
          </p>
          {p.date && (
            <SnapshotPreview
              key={`${p.selectedEvent.id}:${p.date}`}
              event={p.selectedEvent}
              date={p.date}
            />
          )}
          <small>
            Event location supplied by NASA. A marker does not represent a
            hazard boundary.
          </small>
          <a
            href={`https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(p.selectedEvent.id)}`}
            target="_blank"
            rel="noreferrer"
          >
            View source record ↗
          </a>
        </section>
      )}
    </div>
  );
}

function SnapshotPreview({
  event,
  date,
}: {
  event: NaturalEvent;
  date: string;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const bounds = eventBounds(event.center);
  return (
    <div className="nasa-snapshot">
      {status !== "error" && (
        <img
          src={snapshotURL(bounds, date)}
          alt={`NASA VIIRS regional imagery around ${event.title} on ${date}`}
          width="560"
          height="360"
          loading="lazy"
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
        />
      )}
      {status !== "ready" && (
        <small>
          {status === "loading"
            ? "Loading NASA snapshot…"
            : "Snapshot unavailable. Open Worldview to inspect this date."}
        </small>
      )}
      <small>
        VIIRS NOAA-20 · imagery {date} UTC. Clouds and gaps may be present.
      </small>
      <a href={worldviewURL(bounds, date)} target="_blank" rel="noreferrer">
        Inspect this scene in NASA Worldview ↗
      </a>
    </div>
  );
}
