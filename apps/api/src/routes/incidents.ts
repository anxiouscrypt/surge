import { Hono } from "hono";
import { z } from "zod";
import { store } from "../store/memory.js";
import { dispatchers } from "./dispatchers.js";
import { callSids } from "../pipeline.js";
import { transferCall } from "../telephony/twilio.js";

export const incidents = new Hono();

incidents.get("/", (c) => c.json(c.req.query("status") === "all" ? store.all() : store.open()));

incidents.post("/:id/take", async (c) => {
  const inc = store.get(c.req.param("id"));
  if (!inc) return c.json({ error: "not found" }, 404);
  const { dispatcher_id } = z.object({ dispatcher_id: z.string() }).parse(await c.req.json());
  const d = dispatchers.find((x) => x.id === dispatcher_id);
  const callSid = callSids.get(inc.call_id);
  const transfer =
    callSid && d?.phone ? await transferCall(callSid, d.phone) : { ok: false, error: !callSid ? "No live phone call to transfer" : "Dispatcher has no phone set" };
  inc.status = "taken";
  inc.taken_by = dispatcher_id;
  if (transfer.ok) inc.call_state.stage = "transferred";
  store.save(inc, ["status", "taken_by"]);
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
