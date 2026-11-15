import { useState } from "react";
import {
  ageLabel,
  type Feed,
  type FirePoint,
  type NaturalEvent,
  type Layers,
} from "../lib/nasa";
import { Icon } from "./Icon";

type Props = {
  events: Feed<NaturalEvent[]>;
  fires: Feed<FirePoint[]>;
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
                  ? "Connecting to backend…"
                  : p.fires.error
                    ? p.fires.data.length
                      ? "Feed unavailable · cached detections"
                      : "Backend feed unavailable"
                    : p.fires.data.length
                      ? `${p.fires.data.length} detections · latest ${ageLabel(observed, p.now)}`
                      : "No detections reported by backend"}
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
                    : `${p.events.data.length} open events worldwide`}
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
              <small>VIIRS NOAA-20 · dated observation</small>
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
