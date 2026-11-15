// Who may see dispatcher data (calls, transcripts, photos, live feed).
// The demo laptop (localhost) always may. Through the public tunnel, only with the dashboard key:
// judges scanning the QR code reach the caller page, never other callers' data.
import { timingSafeEqual } from "node:crypto";

/** Requests through the public tunnel carry Cloudflare headers; the laptop's own requests do not. */
export const viaTunnel = (h: Headers) => h.has("cf-connecting-ip") || h.has("cf-ray");

const key = () => process.env.DASHBOARD_KEY?.trim() ?? "";

export function dispatcherAllowed(h: Headers, url: URL): boolean {
  if (!viaTunnel(h)) return true;
  const expected = key();
  if (!expected) return false; // no key set: dispatcher views only on the laptop
  const given = h.get("x-dashboard-key") ?? url.searchParams.get("key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Node request headers -> Headers. */
export function toHeaders(raw: Record<string, string | string[] | undefined>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(raw)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(", ") : v);
  return h;
}
