import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import type { ServerEvent } from "@surge/shared";
import { bus, nextSeq, store } from "./store/memory.js";

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    const snap: ServerEvent = { type: "snapshot", incidents: store.open(), seq: nextSeq() };
    ws.send(JSON.stringify(snap));
  });
  bus.on("event", (e: ServerEvent) => {
    const msg = JSON.stringify(e);
    for (const client of wss.clients) if (client.readyState === client.OPEN) client.send(msg);
  });
}
