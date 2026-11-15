// OpenStreetMap Overpass queries, with mirrors: the main server often answers 502/429 under load.
const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

export async function overpass<T = { elements: any[] }>(query: string, timeoutMs = 10000): Promise<T | null> {
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: { "User-Agent": "Surge-hackathon/0.1" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      /* try the next mirror */
    }
  }
  return null;
}
