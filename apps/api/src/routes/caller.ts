// Caller companion page (apps/web /c): starts the call in the browser, then shares live GPS,
// device context, scene photos and the transcript for that one call.
import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Incident } from "@surge/shared";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { store, note } from "../store/memory.js";
import { bindTicket, callForTicket, issueTicket } from "../caller/tickets.js";
import { placed, rescore } from "../pipeline.js";
import { reverseGeocode } from "../geo/geocode.js";
import { haversineKm } from "../hazards/firms.js";
import { limiter, clientIp } from "../limit.js";
import { describePhoto, scheduleLlmTriage, translateToEnglish } from "../ai/gemini.js";

export const caller = new Hono();
// Each session starts a paid voice conversation: a few per person is plenty, even for retries.
const sessionLimit = limiter(Number(process.env.CALLER_SESSIONS_PER_10MIN ?? 8), 10 * 60000);
const mediaLimit = limiter(20, 30 * 60000); // per call
const lineLimit = limiter(600, 60 * 60000); // transcript lines per call
const mediaDir = fileURLToPath(new URL("../../data/media/", import.meta.url));
let eleven: ElevenLabsClient | null = null;

caller.post("/session", async (c) => {
  if (!sessionLimit(clientIp(c.req.raw.headers))) return c.json({ error: "Too many calls from this device. Wait a few minutes, or call 911." }, 429);
  const agentId = process.env.ELEVENLABS_AGENT_ID?.trim();
  if (!agentId || !process.env.ELEVENLABS_API_KEY) return c.json({ error: "Voice agent is not configured" }, 503);
  try {
    eleven ??= new ElevenLabsClient();
    const { signedUrl } = await eleven.conversationalAi.conversations.getSignedUrl({ agentId });
    return c.json({ ticket: issueTicket(), signed_url: signedUrl, agent_id: agentId });
  } catch (err) {
    console.warn("signed url failed", String(err).slice(0, 160));
    return c.json({ error: "Could not reach the voice agent" }, 502);
  }
});

/** A link texted by the agent: the ticket is already bound to the phone call. */
caller.get("/link/:ticket", (c) => {
  const callId = callForTicket(c.req.param("ticket"));
  return callId ? c.json({ call_id: callId }) : c.json({ error: "This link has expired" }, 404);
});

const Device = z.object({
  battery: z.number().min(0).max(1).nullable().optional(),
  charging: z.boolean().nullable().optional(),
  language: z.string().max(20).nullable().optional(),
  platform: z.string().max(60).nullable().optional(),
});

caller.post("/bind", async (c) => {
  const body = z
    .object({ ticket: z.string(), call_id: z.string().min(1), channel: z.enum(["app_voice", "app_text"]).nullable(), device: Device, unsafe: z.boolean().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "bad request" }, 400);
  const { ticket, call_id, channel, device, unsafe } = body.data;
  if (!bindTicket(ticket, call_id)) return c.json({ error: "unknown ticket" }, 403);
  const inc = store.getOrCreate(call_id);
  if (channel) inc.channel = channel;
  inc.device = { battery: device.battery ?? null, charging: device.charging ?? null, language: device.language ?? null, platform: device.platform ?? null, online: true, last_seen: new Date().toISOString() };
  note(inc, "system", channel === "app_text" ? "Caller is texting from the Surge caller page" : channel ? "Caller connected from the Surge caller page" : "Caller opened the texted link");
  if (unsafe) {
    inc.call_state.covert = true;
    inc.call_state.covert_cue = "Silent text mode: caller says it is not safe to talk";
    note(inc, "fact", "Covert call: caller says it is not safe to talk");
  }
  lowBattery(inc);
  rescore(inc);
  store.save(inc, ["channel", "device", "call_state.covert"]);
  return c.json({ ok: true });
});

// Everything below is for one call only, proven by the ticket.
caller.use("/:id/*", async (c, next) => {
  if (callForTicket(c.req.header("x-caller-ticket") ?? "") !== c.req.param("id")) return c.json({ error: "forbidden" }, 403);
  await next();
});

/** Caller pressed "It's getting worse": raise the call in the queue, re-run triage, alert the dispatcher. */
caller.post("/:id/worse", async (c) => {
  const inc = store.get(c.req.param("id"));
  if (!inc) return c.json({ ok: false }, 404);
  inc.call_state.worse = (inc.call_state.worse ?? 0) + 1;
  note(inc, "priority", "Caller pressed: it's getting worse");
  rescore(inc);
  store.save(inc, ["call_state.worse"]);
  scheduleLlmTriage(inc);
  return c.json({ ok: true });
});

caller.post("/:id/device", async (c) => {
  const body = Device.safeParse(await c.req.json().catch(() => null));
  const inc = store.get(c.req.param("id"));
  if (!body.success || !inc?.device) return c.json({ ok: false }, 400);
  if (body.data.battery != null) inc.device.battery = body.data.battery;
  if (body.data.charging != null) inc.device.charging = body.data.charging;
  inc.device.last_seen = new Date().toISOString();
  lowBattery(inc);
  store.save(inc, ["device"]);
  return c.json({ ok: true });
});

function lowBattery(inc: NonNullable<ReturnType<typeof store.get>>) {
  const b = inc.device?.battery;
  if (b != null && b <= 0.15 && !inc.device?.charging && !inc.timeline.some((t) => t.text.startsWith("Caller's phone battery")))
    note(inc, "system", `Caller's phone battery is at ${Math.round(b * 100)}%: the call may drop`);
}

export const Fix = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy_m: z.number().min(0).max(100000),
  heading: z.number().nullable().optional(),
  speed_mps: z.number().nullable().optional(),
});

caller.post("/:id/location", async (c) => {
  const body = Fix.safeParse(await c.req.json().catch(() => null));
  const inc = store.get(c.req.param("id"));
  if (!body.success || !inc) return c.json({ ok: false }, 400);
  await applyFix(inc, body.data);
  return c.json({ ok: true, address: inc.location.gps_address, accuracy_m: inc.location.gps!.accuracy_m, missing: inc.call_state.missing });
});

/** Apply one GPS fix from the caller's phone. */
export async function applyFix(inc: Incident, fix: z.infer<typeof Fix>) {
  const prev = inc.location.gps;
  inc.location.gps = { lat: fix.lat, lng: fix.lng, accuracy_m: Math.round(fix.accuracy_m), heading: fix.heading ?? null, speed_mps: fix.speed_mps ?? null, at: new Date().toISOString() };
  const moved = prev ? haversineKm(prev, fix) : Infinity;

  // Use the phone's position for the pin, unless the caller reported an emergency somewhere else.
  const pin = inc.location.lat != null && inc.location.lng != null ? { lat: inc.location.lat, lng: inc.location.lng } : null;
  const reportedElsewhere = inc.location.source === "spoken" && pin && haversineKm(pin, fix) > 0.5;
  if (fix.accuracy_m <= 500 && !reportedElsewhere) {
    inc.location.lat = fix.lat;
    inc.location.lng = fix.lng;
    inc.location.source = "gps";
  }
  if (moved > 0.03) {
    const address = await reverseGeocode(fix.lat, fix.lng);
    if (address) inc.location.gps_address = address;
    if (!prev) note(inc, "location", `Phone shared GPS (±${Math.round(fix.accuracy_m)} m)${address ? `: near ${address}` : ""}`);
    else if (moved > 0.1) note(inc, "location", `Caller is moving${address ? `: now near ${address}` : ""}`);
  }
  if (!prev || moved > 0.05) await placed(inc, ["location.gps", "location.lat", "location.lng"]);
  else {
    rescore(inc);
    store.save(inc, ["location.gps"]);
  }
}

caller.post("/:id/transcript", async (c) => {
  const body = z.object({ role: z.enum(["agent", "caller"]), text: z.string().min(1).max(2000) }).safeParse(await c.req.json().catch(() => null));
  const inc = store.get(c.req.param("id"));
  if (!body.success || !inc) return c.json({ ok: false }, 400);
  if (!lineLimit(inc.call_id)) return c.json({ ok: false }, 429);
  const lang = inc.caller.language ?? inc.device?.language ?? "en";
  const en = lang.toLowerCase().startsWith("en") ? null : await translateToEnglish(body.data.text);
  store.addLine(inc.call_id, { ...body.data, at: new Date().toISOString(), ...(en && en !== body.data.text ? { en } : {}) });
  return c.json({ ok: true });
});

const MAX_MEDIA = 15 * 1024 * 1024;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

caller.post("/:id/media", async (c) => {
  const inc = store.get(c.req.param("id"));
  const type = (c.req.header("content-type") ?? "").split(";")[0].trim();
  if (!inc || !EXT[type]) return c.json({ error: "Send a photo or video" }, 400);
  if (!mediaLimit(inc.call_id)) return c.json({ error: "That's the most photos one call can send" }, 429);
  if (Number(c.req.header("content-length") ?? 0) > MAX_MEDIA) return c.json({ error: "File too large" }, 413);
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (buf.length > MAX_MEDIA) return c.json({ error: "File too large" }, 413);
  const id = randomBytes(12).toString("base64url");
  const file = `${id}.${EXT[type]}`;
  mkdirSync(mediaDir, { recursive: true });
  writeFileSync(mediaDir + file, buf);
  const kind = type.startsWith("video") ? "video" : "photo";
  inc.media.push({ id, kind, url: `/media/${file}`, at: new Date().toISOString(), caption: null });
  note(inc, "media", `Caller sent a ${kind}`);
  store.save(inc, ["media"]);
  if (kind === "photo" && type !== "image/heic") void caption(inc.call_id, id, buf, type);
  return c.json({ ok: true, id });
});

async function caption(callId: string, mediaId: string, buf: Buffer, type: string) {
  const text = await describePhoto(buf, type);
  const inc = store.get(callId);
  const m = inc?.media.find((x) => x.id === mediaId);
  if (!inc || !m || !text) return;
  m.caption = text;
  note(inc, "media", `Photo: ${text}`);
  store.save(inc, ["media"]);
  scheduleLlmTriage(inc); // what the photo shows can raise the priority
}

/** Photos and videos are served by unguessable id only. */
export const media = new Hono();
media.get("/:file", (c) => {
  const file = c.req.param("file");
  if (!/^[\w-]+\.(jpg|png|webp|heic|mp4|mov|webm)$/.test(file) || !existsSync(mediaDir + file)) return c.notFound();
  const ext = file.split(".").pop()!;
  const type = Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
  return c.body(readFileSync(mediaDir + file), 200, { "content-type": type, "cache-control": "private, max-age=3600" });
});
