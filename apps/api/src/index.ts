import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Server } from "node:http";
import { config } from "./config.js";
import { tools } from "./routes/tools.js";
import { incidents } from "./routes/incidents.js";
import { dispatcherRoutes } from "./routes/dispatchers.js";
import { webhooks } from "./routes/webhooks.js";
import { hazards } from "./routes/hazards.js";
import { attachWebSocket } from "./ws.js";
import { refreshFires } from "./hazards/firms.js";
import { geminiEnabled } from "./ai/gemini.js";

const app = new Hono();
app.use("*", logger());
app.use("*", cors());

app.get("/health", (c) => c.json({ ok: true, ai_triage: geminiEnabled() }));
app.route("/tools", tools);
app.route("/incidents", incidents);
app.route("/dispatchers", dispatcherRoutes);
app.route("/webhooks", webhooks);
app.route("/hazards", hazards);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Surge API on http://localhost:${info.port} (ws: /ws)`);
});
attachWebSocket(server as Server);

void refreshFires();
setInterval(refreshFires, 5 * 60 * 1000);
