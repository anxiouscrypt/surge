import { Hono } from "hono";
import { z } from "zod";
import { store } from "../store/memory.js";
import { dispatchers } from "./dispatchers.js";
import { callSids } from "../pipeline.js";
import { transferCall } from "../telephony/twilio.js";
import { callerOnline, sendToCaller } from "../ws.js";
import { note } from "../store/memory.js";

export const incidents = new Hono();

incidents.get("/", (c) => c.json(c.req.query("status") === "all" ? store.all() : store.open()));

incidents.post("/:id/take", async (c) => {
  const inc = store.get(c.req.param("id"));
  if (!inc) return c.json({ error: "not found" }, 404);
  const { dispatcher_id } = z.object({ dispatcher_id: z.string() }).parse(await c.req.json());
  const d = dispatchers.find((x) => x.id === dispatcher_id);
  // Caller on the Surge caller page: hand over in the browser (WebRTC), no phone system needed.
  if (callerOnline(inc.call_id)) {
    inc.status = "taken";
    inc.taken_by = dispatcher_id;
    inc.takeover = { mode: "web", state: "connecting", error: null };
    note(inc, "dispatcher", `${d?.name ?? "A dispatcher"} is taking over the call`);
    sendToCaller(inc.call_id, { type: "takeover", dispatcher: d?.name ?? "A dispatcher" });
    store.save(inc, ["status", "taken_by", "takeover"]);
    return c.json({ ok: true, transferred: false, web: true, error: null, callback: inc.caller.phone });
  }
  const callSid = callSids.get(inc.call_id);
  const transfer =
    callSid && d?.phone ? await transferCall(callSid, d.phone) : { ok: false, error: !callSid ? "No live phone call to transfer" : "Dispatcher has no phone set" };
  inc.status = "taken";
  inc.taken_by = dispatcher_id;
  if (transfer.ok) inc.call_state.stage = "transferred";
  inc.takeover = callSid ? { mode: "phone", state: transfer.ok ? "connected" : "failed", error: transfer.ok ? null : transfer.error ?? null } : null;
  note(inc, "dispatcher", transfer.ok ? `Call transferred to ${d?.name ?? "a dispatcher"}` : `${d?.name ?? "A dispatcher"} took the call (no live transfer: call back)`);
  store.save(inc, ["status", "taken_by", "takeover"]);
  if (!transfer.ok) console.warn("transfer failed:", transfer.error);
  // Fallback when transfer fails: dispatcher calls back inc.caller.phone.
  return c.json({ ok: true, transferred: transfer.ok, error: transfer.error ?? null, callback: inc.caller.phone });
});

incidents.post("/:id/status", async (c) => {
  const inc = store.get(c.req.param("id"));
  if (!inc) return c.json({ error: "not found" }, 404);
  const { status } = z.object({ status: z.enum(["dispatched", "closed"]) }).parse(await c.req.json());
  inc.status = status;
  store.save(inc, ["status"]);
  return c.json({ ok: true });
});

/** Browser takeover progress, reported by the dashboard. */
incidents.post("/:id/takeover", async (c) => {
  const inc = store.get(c.req.param("id"));
  if (!inc) return c.json({ error: "not found" }, 404);
  const { state, error } = z.object({ state: z.enum(["connected", "failed", "ended"]), error: z.string().max(200).optional() }).parse(await c.req.json());
  inc.takeover = { mode: "web", state, error: error ?? null };
  if (state === "connected") {
    inc.call_state.stage = "transferred";
    note(inc, "dispatcher", "Dispatcher is talking to the caller");
  } else note(inc, "dispatcher", state === "failed" ? `Live audio failed${error ? `: ${error}` : ""}. Call back.` : "Dispatcher ended the call");
  if (state === "ended") sendToCaller(inc.call_id, { type: "ended" });
  store.save(inc, ["takeover", "call_state.stage"]);
  return c.json({ ok: true });
});

incidents.post("/:id/note", async (c) => {
  const inc = store.get(c.req.param("id"));
  if (!inc) return c.json({ error: "not found" }, 404);
  const { text } = z.object({ text: z.string().min(1).max(300) }).parse(await c.req.json());
  note(inc, "dispatcher", text);
  store.save(inc, ["timeline"]);
  return c.json({ ok: true });
});

/** Requests through the public tunnel carry Cloudflare headers; the demo laptop's own requests do not. */
export const viaTunnel = (h: Headers) => h.has("cf-connecting-ip") || h.has("cf-ray");

/** Clear every call (before a demo). Only from the demo laptop, never through the public link. */
incidents.post("/reset", (c) => {
  if (viaTunnel(c.req.raw.headers)) return c.json({ error: "Run demo controls from the dashboard on the demo laptop (localhost)." }, 403);
  store.clear();
  return c.json({ ok: true });
});
