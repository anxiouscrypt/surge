import type { Incident } from "./schema";

export type ServerEvent =
  | { type: "incident.upsert"; incident: Incident; changed: string[]; seq: number }
  | { type: "call.transcript"; call_id: string; role: "agent" | "caller"; text: string; at: string; seq: number }
  | { type: "call.ended"; call_id: string; seq: number }
  | { type: "snapshot"; incidents: Incident[]; seq: number };
