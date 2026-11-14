export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
export const WS_URL = API_URL.replace(/^http/, "ws") + "/ws";

export async function post(path: string, body: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}
