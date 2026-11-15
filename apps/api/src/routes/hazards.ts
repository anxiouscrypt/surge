import { Hono } from "hono";
import { firms, parseBbox, readFires } from "../hazards/firms.js";
import { syncHazardContext } from "../hazards/context.js";

export const hazards = new Hono();
firms.subscribe(syncHazardContext);

// Preserve the existing flat-array response; opt into provenance with ?metadata=1.
hazards.get("/fires", async (c) => {
  let bbox;
  try {
    bbox = parseBbox(c.req.query("bbox"));
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
  const result = await readFires(bbox);
  c.header("Cache-Control", "no-store");
  if (c.req.query("metadata") === "1") return c.json(result);
  if (result.meta.state === "unconfigured" || result.meta.state === "error")
    return c.json({ error: result.meta.warning }, 503);
  return c.json(result.fires);
});
