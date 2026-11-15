// Built and served by the API (pnpm demo): same origin. Dev: the API on :8787.
export const API_URL = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "http://localhost:8787" : location.origin)
).replace(/\/$/, "");

// Dashboard key for opening the dashboard through the public link (pnpm demo prints the link with ?key=).
// Kept for this tab only; the laptop (localhost) needs none.
function readKey(): string {
  try {
    const fromUrl = new URLSearchParams(location.search).get("key");
    if (fromUrl) {
      sessionStorage.setItem("surge.key", fromUrl);
      const url = new URL(location.href);
      url.searchParams.delete("key");
      history.replaceState(null, "", url); // keep the key out of screenshots
      return fromUrl;
    }
    return sessionStorage.getItem("surge.key") ?? "";
  } catch {
    return "";
  }
}
export const DASHBOARD_KEY = typeof location !== "undefined" ? readKey() : "";
const keyQuery = DASHBOARD_KEY ? `?key=${encodeURIComponent(DASHBOARD_KEY)}` : "";
export const WS_URL = API_URL.replace(/^http/, "ws") + "/ws" + keyQuery;
/** URL for a dispatcher-only file (photos) that an <img> can load. */
export const mediaUrl = (path: string) => `${API_URL}${path}${keyQuery}`;

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (DASHBOARD_KEY) headers.set("x-dashboard-key", DASHBOARD_KEY);
  const res = await fetch(`${API_URL}${path}`, {
    signal: AbortSignal.timeout(12000),
    ...init,
    headers,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  if (body === null)
    throw new Error("The server returned an unreadable response.");
  return body as T;
}
export function post<T = unknown>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
export type TakeResult = {
  ok: boolean;
  transferred: boolean;
  error: string | null;
  callback: string | null;
};
export type Dispatcher = {
  id: string;
  name: string;
  phone: string;
  status: "available" | "on_call" | "offline";
};
