// Server tools called by the ElevenLabs agent during the call.
import { Hono } from "hono";
import { AgentUpdate } from "@surge/shared";
import { config } from "../config.js";
import { handleAgentUpdate } from "../pipeline.js";
import { store } from "../store/memory.js";

export const tools = new Hono();

tools.use("*", async (c, next) => {
  if (config.toolSecret && c.req.header("x-surge-secret") !== config.toolSecret) return c.json({ ok: false }, 401);
  await next();
});

tools.post("/update_incident", async (c) => {
  const parsed = AgentUpdate.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    // Logged and ignored, never shown. Keep the agent talking.
    console.warn("update_incident rejected", parsed.error.flatten());
    return c.json({ ok: false, missing: [], say: null, escalate: false });
  }
  return c.json(await handleAgentUpdate(parsed.data));
});

tools.post("/get_status", async (c) => {
  const { call_id } = (await c.req.json().catch(() => ({}))) as { call_id?: string };
  const inc = call_id ? store.get(call_id) : undefined;
  // One honest sentence. Never an ETA.
  const text = !inc
    ? "A dispatcher has been alerted and will take your call as soon as one is free."
    : inc.final_priority === 1
      ? "A dispatcher can see your location and your call is marked highest priority."
      : "A dispatcher can see your call and will take it as soon as one is free.";
  return c.json({ text });
});
