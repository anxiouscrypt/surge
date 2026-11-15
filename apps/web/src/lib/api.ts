export const API_URL = (
  import.meta.env.VITE_API_URL ?? "http://localhost:8787"
).replace(/\/$/, "");
export const WS_URL = API_URL.replace(/^http/, "ws") + "/ws";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    signal: AbortSignal.timeout(12000),
    ...init,
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
