export type MapBounds = [number, number, number, number]; // west, south, east, north
export const IMAGERY_DATASET = "VIIRS_NOAA20_CorrectedReflectance_TrueColor";

export function regionalBounds(
  w: number,
  s: number,
  e: number,
  n: number,
): MapBounds | null {
  if (
    ![w, s, e, n].every(Number.isFinite) ||
    w >= e ||
    s >= n ||
    e - w > 29.8 ||
    n - s > 19.8 ||
    w < -180 ||
    e > 180
  )
    return null;
  return [
    Math.floor(w * 10) / 10,
    Math.max(-85, Math.floor(s * 10) / 10),
    Math.ceil(e * 10) / 10,
    Math.min(85, Math.ceil(n * 10) / 10),
  ];
}
export function eventBounds(center: [number, number]): MapBounds {
  return [
    Math.max(-180, center[0] - 0.7),
    Math.max(-85, center[1] - 0.45),
    Math.min(180, center[0] + 0.7),
    Math.min(85, center[1] + 0.45),
  ];
}
export function worldviewURL(bounds: MapBounds, date: string) {
  const url = new URL("https://worldview.earthdata.nasa.gov/");
  url.searchParams.set("p", "geographic");
  url.searchParams.set("v", bounds.map((v) => v.toFixed(4)).join(","));
  url.searchParams.set(
    "l",
    `Reference_Labels_15m,Coastlines_15m,${IMAGERY_DATASET}`,
  );
  url.searchParams.set("t", date);
  return url.toString();
}
export function snapshotURL(bounds: MapBounds, date: string) {
  const [w, s, e, n] = bounds;
  const url = new URL("https://wvs.earthdata.nasa.gov/api/v1/snapshot");
  url.search = new URLSearchParams({
    REQUEST: "GetSnapshot",
    TIME: date,
    BBOX: [s, w, n, e].map((v) => v.toFixed(4)).join(","),
    CRS: "EPSG:4326",
    LAYERS: IMAGERY_DATASET,
    FORMAT: "image/jpeg",
    WIDTH: "560",
    HEIGHT: "360",
  }).toString();
  return url.toString();
}
