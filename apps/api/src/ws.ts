import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ServerEvent } from "@surge/shared";
import { bus, emit, nextSeq, note, store } from "./store/memory.js";
import { callForTicket } from "./caller/tickets.js";

/** Open caller pages, by call id. Used for live takeover (WebRTC signaling) and "caller online". */
const callerSockets = new Map<string, Set<WebSocket>>();

export const callerOnline = (callId: string) => (callerSockets.get(callId)?.size ?? 0) > 0;

export function sendToCaller(callId: string, msg: unknown): boolean {
  const set = callerSockets.get(callId);
  if (!set?.size) return false;
  const text = JSON.stringify(msg);
  for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(text);
  return true;
}

function setOnline(callId: string, online: boolean) {
  const inc = store.get(callId);
  if (!inc?.device || inc.device.online === online) return;
  inc.device.online = online;
  inc.device.last_seen = new Date().toISOString();
  if (!online) note(inc, "system", "Caller's phone page disconnected");
  store.save(inc, ["device.online"]);
}

export function attachWebSocket(server: Server) {
  // Dispatcher dashboards: full incident feed. Callers never connect here.
  const wss = new WebSocketServer({ noServer: true });
  // Caller pages: only signaling for their own call.
  const cws = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/ws") wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    else if (url.pathname === "/caller-ws") cws.handleUpgrade(req, socket, head, (ws) => cws.emit("connection", ws, req));
    else socket.destroy();
  });

  wss.on("connection", (ws) => {
    const snap: ServerEvent = { type: "snapshot", incidents: store.open(), transcripts: store.transcripts(), seq: nextSeq() };
    ws.send(JSON.stringify(snap));
    ws.on("message", (raw) => {
      try {
        const m = JSON.parse(String(raw));
        if (m?.type === "rtc" && typeof m.call_id === "string") sendToCaller(m.call_id, { type: "rtc", data: m.data });
        // Dispatcher texting a caller who cannot talk (after takeover of a text call).
        if (m?.type === "chat" && typeof m.call_id === "string" && typeof m.text === "string" && m.text.trim()) {
          const text = m.text.trim().slice(0, 1000);
          store.addLine(m.call_id, { role: "dispatcher", text, at: new Date().toISOString() });
          sendToCaller(m.call_id, { type: "chat", text });
        }
      } catch {
        /* ignore */
      }
    });
  });
  bus.on("event", (e: ServerEvent) => {
    const msg = JSON.stringify(e);
    for (const client of wss.clients) if (client.readyState === client.OPEN) client.send(msg);
  });

  cws.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://x");
    const callId = callForTicket(url.searchParams.get("ticket") ?? "");
    if (!callId) return ws.close(4001, "unknown ticket");
    const set = callerSockets.get(callId) ?? new Set();
    set.add(ws);
    callerSockets.set(callId, set);
    setOnline(callId, true);
    ws.on("message", (raw) => {
      try {
        const m = JSON.parse(String(raw));
        if (m?.type === "rtc") emit({ type: "rtc", call_id: callId, from: "caller", data: m.data, seq: nextSeq() });
        if (m?.type === "chat" && typeof m.text === "string" && m.text.trim())
          store.addLine(callId, { role: "caller", text: m.text.trim().slice(0, 1000), at: new Date().toISOString() });
      } catch {
        /* ignore */
      }
    });
    ws.on("close", () => {
      set.delete(ws);
      if (!set.size) setOnline(callId, false);
    });
    // Keep the tunnel from idling the socket out.
    const ping = setInterval(() => ws.readyState === ws.OPEN && ws.ping(), 20000);
    ws.on("close", () => clearInterval(ping));
  });
}
