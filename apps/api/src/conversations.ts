// Read-only sync with ElevenLabs for calls that don't come through the caller page (phone, talk-to link):
// - live transcript lines on the dashboard while the call is going
// - when the call is over: mark it ended, fill facts the agent missed from the post-call analysis,
//   and run the final Gemini triage. No webhook (and no workspace setting) needed.
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { emit, nextSeq, note, store } from "./store/memory.js";
import { rescore } from "./pipeline.js";
import { backfill } from "./routes/webhooks.js";
import { translateToEnglish, triageAtCallEnd } from "./ai/gemini.js";

const POLL_MS = 5000;
const seen = new Map<string, number>(); // transcript entries already shown, per call
let client: ElevenLabsClient | null = null;
let busy = false;

export function startConversationSync() {
  if (!process.env.ELEVENLABS_API_KEY) return;
  client = new ElevenLabsClient();
  setInterval(() => void tick(), POLL_MS);
}

async function tick() {
  if (busy || !client) return;
  busy = true;
  try {
    const active = store
      .open()
      .filter((i) => i.call_id.startsWith("conv_") && i.call_state.stage !== "ended" && i.call_state.stage !== "transferred" && i.status === "ai_on_call");
    for (const inc of active) await syncOne(inc.call_id);
  } finally {
    busy = false;
  }
}

async function syncOne(callId: string) {
  let conv;
  try {
    conv = await client!.conversationalAi.conversations.get(callId);
  } catch {
    return; // not found yet, or the API is busy: try next tick
  }
  const inc = store.get(callId);
  if (!inc) return;

  // Caller-page calls send their own transcript; only fill it for phone and talk-to calls.
  if (inc.channel !== "app_voice" && inc.channel !== "app_text") {
    const lines = (conv.transcript ?? []).filter((t) => (t.role === "user" || t.role === "agent") && t.message?.trim());
    // After a restart the transcript comes back from disk: continue after what is already shown.
    const from = seen.get(callId) ?? store.transcripts()[callId]?.length ?? 0;
    for (const t of lines.slice(from)) {
      const role = t.role === "user" ? "caller" : "agent";
      const lang = inc.caller.language ?? "en";
      const en = lang.startsWith("en") ? null : await translateToEnglish(t.message!);
      store.addLine(callId, { role, text: t.message!, at: new Date().toISOString(), ...(en && en !== t.message ? { en } : {}) });
    }
    seen.set(callId, lines.length);
  }

  if (conv.status === "done" || conv.status === "failed") {
    const current = store.get(callId);
    if (!current || current.call_state.stage === "ended") return;
    current.call_state.stage = "ended";
    if (current.status === "ai_on_call") current.status = "waiting";
    const changed = ["call_state.stage", "status"];
    const results = (conv.analysis as { dataCollectionResults?: Record<string, { value?: unknown }> } | undefined)?.dataCollectionResults ?? {};
    const filled = backfill(current, results);
    note(current, "system", `Caller hung up${filled.length ? `. Filled from post-call analysis: ${filled.join(", ")}` : ""}`);
    rescore(current);
    store.save(current, [...changed, ...filled]);
    emit({ type: "call.ended", call_id: callId, seq: nextSeq() });
    triageAtCallEnd(callId);
    seen.delete(callId);
  }
}
