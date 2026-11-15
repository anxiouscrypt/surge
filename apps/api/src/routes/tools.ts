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
  const body = await c.req.json().catch(() => null);
  console.log("update_incident", JSON.stringify(body));
  const { data, dropped } = salvage(body);
  if (!data) {
    // Logged and ignored, never shown. Keep the agent talking.
    return c.json({ ok: false, missing: [], say: null, escalate: false, error: "Update not saved. Send the facts again." });
  }
  const reply = await handleAgentUpdate(data);
  return c.json(dropped.length ? { ...reply, not_saved: dropped } : reply);
});

/** Parse an agent update, dropping only the invalid fields so one bad value never loses the whole update. */
export function salvage(body: unknown): { data: AgentUpdate | null; dropped: string[] } {
  const dropped: string[] = [];
  let input = structuredClone(body);
  for (let attempt = 0; attempt < 5; attempt++) {
    const parsed = AgentUpdate.safeParse(input);
    if (parsed.success) return { data: parsed.data, dropped };
    if (!input || typeof input !== "object") break;
    for (const issue of parsed.error.issues) {
      const keys = issue.code === "unrecognized_keys" ? issue.keys.map((k) => [...issue.path, k]) : [issue.path];
      for (const path of keys) {
        if (!path.length || path[0] === "call_id") return { data: null, dropped };
        let parent: any = input;
        for (const p of path.slice(0, -1)) parent = parent?.[p];
        if (parent && typeof parent === "object") delete parent[path[path.length - 1]];
        dropped.push(path.join("."));
      }
    }
    console.warn("update_incident dropped invalid fields", dropped);
  }
  return { data: null, dropped };
}

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
