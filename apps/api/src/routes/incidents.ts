import { Hono } from "hono";
import { z } from "zod";
import { store } from "../store/memory.js";
import { dispatchers } from "./dispatchers.js";

export const incidents = new Hono();

incidents.get("/", (c) => c.json(c.req.query("status") === "all" ? store.all() : store.open()));

incidents.post("/:id/take", async (c) => {
  const inc = store.get(c.req.param("id"));
  if (!inc) return c.json({ error: "not found" }, 404);
  const { dispatcher_id } = z.object({ dispatcher_id: z.string() }).parse(await c.req.json());
  const d = dispatchers.find((x) => x.id === dispatcher_id);
  inc.status = "taken";
  inc.taken_by = dispatcher_id;
  inc.call_state.stage = "transferred";
  store.save(inc, ["status", "taken_by"]);
  // TODO: tell the ElevenLabs agent to transfer the live call to d.phone (transfer_to_number).
  // Fallback: dispatcher calls back inc.caller.phone.
  return c.json({ ok: true, transfer_to: d?.phone ?? null });
});

incidents.post("/:id/status", async (c) => {
  const inc = store.get(c.req.param("id"));
  if (!inc) return c.json({ error: "not found" }, 404);
  const { status } = z.object({ status: z.enum(["dispatched", "closed"]) }).parse(await c.req.json());
  inc.status = status;
  store.save(inc, ["status"]);
  return c.json({ ok: true });
});
