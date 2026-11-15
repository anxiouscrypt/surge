# NASA data in Surge

This integration follows the Hack The Nest 2026 Beyond the Horizon guide's emphasis on useful NASA data, traceable sources and dates, correct spatial interpretation, and visible limitations.

## What each source does

| Source | Dataset | Purpose | Access |
| --- | --- | --- | --- |
| NASA EONET v3 | Open natural events, latest geometry per event | Locate and explore event observations; retain observation dates | No key |
| NASA GIBS / Worldview Snapshots | VIIRS NOAA-20 corrected reflectance, true color | Regional visual context, dated tiles and event snapshots | No key |
| NASA FIRMS | `VIIRS_NOAA20_NRT` | Thermal-anomaly detection points, acquisition times, and caller proximity | Separate server-side FIRMS MAP_KEY |
| OpenStreetMap / optional Mapbox | Street or satellite-streets basemap | Navigation and caller positioning | OSM fallback; optional Mapbox token |

The street basemap and caller coordinates are not NASA data. Caller coordinates come from the existing backend geocoder. NASA imagery is a visualization; it is not used to measure burned acreage or infer building-level hazards.

## FIRMS implementation

Set `FIRMS_MAP_KEY` in the root `.env`, then restart the API. Get the free, separate key at https://firms.modaps.eosdis.nasa.gov/api/map_key/. A generic api.nasa.gov key does not substitute for it. The key is never included in browser responses, URLs, or logs.

- NASA endpoint: `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/VIIRS_NOAA20_NRT/{west,south,east,north}/1`.
- Queries follow the visible map region, rounded outward to tenths of a degree. Wide views ask the user to zoom in instead of downloading the world.
- Cache lifetime is five minutes per area; identical in-flight requests are shared. Retained cache is bounded to 24 regions.
- Responses distinguish ready, stale, unconfigured, and failed states. A missing key is not reported as a successful empty area. Cached observations expire after 30 minutes if refreshing fails.
- CSV acquisition date/time is parsed explicitly in UTC. Malformed error pages and impossible coordinates/times cannot become valid empty datasets.
- FIRMS points represent nominal 375 m thermal-anomaly pixels, not precise flame coordinates, building fires, or fire perimeters. Industrial heat sources and prescribed burns may appear.
- Caller context uses cached detections at most three hours old, excluding low-confidence detections. The existing rules engine handles proximity-based priority; this integration does not add a new priority policy.
- Per-caller observation requests are asynchronous so they do not block pin placement. When data arrives, open incidents receive refreshed NASA context and are re-scored through the existing backend pipeline.
- EONET point/track observations never produce an invented `inside_event` polygon.

`GET /hazards/fires?bbox=west,south,east,north` preserves the flat array contract. Add `metadata=1` for `{fires, meta}` including coverage, source, nominal resolution, acquisition freshness, retrieval time, and failure state. Invalid regions return 400. The legacy array route returns 503 when data is unavailable; metadata responses describe the state explicitly.

## Imagery and source comparison

- Tiles: GIBS EPSG:3857, `GoogleMapsCompatible_Level9`, using the latest advertised date from capabilities. The initial date is at most yesterday UTC.
- Event snapshots: NASA Worldview Snapshots, the same VIIRS product and explicitly labeled date. Snapshot bounding boxes use **south,west,north,east**, unlike the FIRMS bounding box order.
- Worldview links include the chosen area, date and layer, allowing comparison against NASA's own viewer.
- VIIRS sensor bands used for true color have different resolutions (375 m and 750 m). Resampling and zooming do not reveal additional building detail.
- Clouds, nighttime, swath gaps and missing tiles can obscure the scene. Snapshot failures offer the source viewer instead of silently fabricating an image.
- Observation date, imagery date and retrieval time are different and remain separately labeled. An event marked open by EONET is not evidence of a newly observed or continuously monitored hazard.

## Verification and limits

Automated tests cover UTC parsing, duplicate detections, valid empty versus invalid responses, request bounds, cache coalescing, missing-key behavior, stale/expired observations, and filtering stale or low-confidence points from caller context. Live EONET, GIBS and snapshot responses were checked. A live authenticated FIRMS fetch still requires a configured MAP_KEY.

No Prithvi model is used. A normal RGB screenshot would not satisfy the guide's described multispectral flood-model input requirements.

## Sources and credit

- [FIRMS Area API](https://firms.modaps.eosdis.nasa.gov/api/area/)
- [VIIRS NOAA-20 375 m active fire product](https://data.nasa.gov/dataset/viirs-jpss1-active-fires-6-min-l2-swath-375m-nrt-b8e6c)
- [NASA EONET v3](https://eonet.gsfc.nasa.gov/docs/v3)
- [GIBS access documentation](https://nasa-gibs.github.io/gibs-api-docs/access-basics/)
- [NASA Worldview URL parameters](https://github.com/nasa-gibs/worldview/blob/main/doc/url_parameters.md)
- [VIIRS true-color processing and sensor bands](https://directreadout.sci.gsfc.nasa.gov/publications_documents/VIIRS_True_Color_Tutorial_v1.0.pdf)

Supported by the Michigan Space Grant Consortium, NASA grant 80NSSC20M0124.

NASA data and imagery are credited by dataset. No NASA logo or NASA endorsement is implied.
