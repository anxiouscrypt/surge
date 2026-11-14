import { Hono } from "hono";
import { getFires } from "../hazards/firms.js";

export const hazards = new Hono();
hazards.get("/fires", (c) => c.json(getFires()));
