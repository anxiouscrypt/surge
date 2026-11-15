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
import { caller, media } from "./routes/caller.js";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadPlaces } from "./geo/places.js";
import { smsEnabled } from "./telephony/twilio.js";
import { startReplay } from "./demo/replay.js";
import { viaTunnel } from "./routes/incidents.js";
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
app.route("/caller", caller);
app.route("/media", media);
app.post("/demo/replay", (c) => {
  if (viaTunnel(c.req.raw.headers)) return c.json({ error: "Run demo controls from the dashboard on the demo laptop (localhost)." }, 403);
  return startReplay() ? c.json({ ok: true }) : c.json({ error: "A replay is already running" }, 409);
});

/** What the dashboard needs to show the caller QR code and feature status. */
app.get("/config", (c) =>
  c.json({
    public_url: (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "") || null,
    sms: smsEnabled(),
    phone_number: process.env.TWILIO_PHONE_NUMBER || null,
    voice: !!(process.env.ELEVENLABS_AGENT_ID && process.env.ELEVENLABS_API_KEY),
    ai_triage: geminiEnabled(),
  }),
);

// Serve the built dashboard and caller page from the API, so one tunnel URL serves everything (pnpm demo).
const webDist = fileURLToPath(new URL("../../web/dist/", import.meta.url));
if (existsSync(webDist + "index.html")) {
  const root = webDist;
  app.use("/assets/*", serveStatic({ root }));
  app.use("/*", serveStatic({ root }));
  app.get("*", (c) => c.html(readFileSync(root + "index.html", "utf8")));
}

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Surge API on http://localhost:${info.port} (ws: /ws)`);
});
attachWebSocket(server as Server);

void refreshFires();
void loadPlaces();
setInterval(refreshFires, 5 * 60 * 1000);
