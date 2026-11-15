# Dashboard integration

Dashboard changes live in `apps/web`. Backend and shared-schema changes remain owned by the backend workstream.

## Run

`pnpm dev:web` starts Vite with hot reload. Open `/` for the live call feed or `/?demo=1` for explicitly labeled synthetic callers. Demo mode never opens a call WebSocket and never sends transfer or status requests. NASA feeds are real in both modes. No automatic mock fallback is used.

`VITE_API_URL` selects the API (default `http://localhost:8787`). Vite reads the repo-root `.env`. Restart Vite when changing environment variables.

## Map

MapLibre renders the map. With `VITE_MAPBOX_TOKEN`, the basemap uses Mapbox satellite-streets raster tiles. Without it, the development fallback uses OpenStreetMap raster tiles with a dark treatment. Preserve visible attribution. NASA imagery is independent of the basemap token.

Caller pins use backend-provided `location.lat` and `location.lng`; the browser does not geocode or request phone GPS. Low and medium confidence locations use dashed markers. Callers without coordinates stay in the queue. Clicking a card or pin focuses the same incident. `Follow P1` is opt-in; selection takes precedence over automatic movement.

## Existing backend contracts consumed

- `/ws`: initial `{type:"snapshot", incidents: Incident[], seq}`; then `incident.upsert`, `call.transcript`, and `call.ended`, matching `packages/shared/src/events.ts`. Incident payloads are validated with the shared Zod schema. Older sequence numbers are ignored. Reconnect replaces state from a new snapshot and accepts a restarted server's sequence counter. Transcript lines are session-local; history replay is not currently in the API contract.
- `GET /dispatchers`: array of `{id,name,phone,status}`. The panel selects a dispatcher with a configured phone. Missing destinations are disabled.
- `POST /incidents/:call_id/take`: `{dispatcher_id}`; response `{ok,transferred,error,callback}`. A failed transfer stays visibly unconfirmed and offers retry and callback. A successful response confirms the redirect request, not that a human answered.
- `POST /incidents/:call_id/status`: `{status:"dispatched"|"closed"}`; response `{ok:true}`.
- `GET /hazards/fires`: flat-array compatibility remains available. The dashboard uses `?metadata=1&bbox=west,south,east,north` for `{fires,meta}` with region coverage, source, acquisition freshness and retrieval status. The real FIRMS adapter is implemented; set the server-side `FIRMS_MAP_KEY` to enable authenticated fetching. Missing credentials, valid empty coverage, stale cache and upstream errors are distinct states. See [NASA integration](NASA-DATA.md).

Transfer and status actions are disabled while disconnected. Only the backend determines incident priority; map overlays do not modify triage locally.

## Browser-direct NASA feeds

- EONET v3 open-event GeoJSON, refreshed every ten minutes. Latest geometry per event ID is shown with the event observation date. Markers and storm tracks are not fabricated hazard perimeters. Event browser can move the map away from Michigan to an active event.
- GIBS VIIRS NOAA-20 corrected-reflectance true color, EPSG:3857 / GoogleMapsCompatible_Level9. The browser reads WMTS capabilities for the advertised date. Default imagery is the earlier of the advertised date and yesterday (UTC); user can choose an earlier date. Tile errors are surfaced. Imagery is explicitly dated and is not described as a live camera.
- Last successful data remains visible with a cached-data notice if polling fails. No FIRMS keys are exposed to the browser.

## Verification performed

Production build and browser checks cover pin selection, NASA event navigation, satellite toggle/date, desktop/mobile layouts, and explicit demo mode. An isolated synthetic HTTP/WebSocket backend exercised initial snapshot, live P2-to-P1 updates, rejection of a stale update, transcript delivery, transfer failure/callback, retry success, and dispatched/closed status. No real phone calls were initiated by those checks.
