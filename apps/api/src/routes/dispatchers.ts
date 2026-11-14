import { Hono } from "hono";
import { z } from "zod";

export type Dispatcher = { id: string; name: string; phone: string; status: "available" | "on_call" | "offline" };

// MVP: simulated routing. In the demo every dispatcher shows "On call".
export const dispatchers: Dispatcher[] = [
  { id: "d1", name: "Dispatcher 1", phone: process.env.DISPATCHER_PHONE ?? "", status: "on_call" },
  { id: "d2", name: "Dispatcher 2", phone: "", status: "on_call" },
  { id: "d3", name: "Dispatcher 3", phone: "", status: "on_call" },
];

export const dispatcherRoutes = new Hono();
dispatcherRoutes.get("/", (c) => c.json(dispatchers));
dispatcherRoutes.post("/:id/status", async (c) => {
  const d = dispatchers.find((x) => x.id === c.req.param("id"));
  if (!d) return c.json({ error: "not found" }, 404);
  d.status = z.object({ status: z.enum(["available", "on_call", "offline"]) }).parse(await c.req.json()).status;
  return c.json(d);
});
