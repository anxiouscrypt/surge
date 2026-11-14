import { Hono } from "hono";
import { emit, nextSeq, store } from "../store/memory.js";

export const webhooks = new Hono();

webhooks.post("/elevenlabs/post-call", async (c) => {
  // TODO: verify the ElevenLabs signature (ELEVENLABS_WEBHOOK_SECRET).
  // TODO: backfill still-null fields from Data Collection; never overwrite confirmed ones. Then final LLM triage.
  const body = (await c.req.json().catch(() => ({}))) as any;
  const call_id: string | undefined = body?.data?.conversation_id;
  const inc = call_id ? store.get(call_id) : undefined;
  if (inc && inc.call_state.stage !== "transferred") {
    inc.call_state.stage = "ended";
    store.save(inc, ["call_state.stage"]);
  }
  if (call_id) emit({ type: "call.ended", call_id, seq: nextSeq() });
  return c.json({ ok: true });
});
