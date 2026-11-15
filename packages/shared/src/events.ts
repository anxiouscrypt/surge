import type { Incident } from "./schema";

export type ServerEvent =
  | { type: "incident.upsert"; incident: Incident; changed: string[]; seq: number }
  | ({ type: "call.transcript"; call_id: string; seq: number } & TranscriptLine)
  | { type: "call.ended"; call_id: string; seq: number }
  | { type: "snapshot"; incidents: Incident[]; transcripts?: Record<string, TranscriptLine[]>; seq: number }
  | { type: "rtc"; call_id: string; from: "dispatcher" | "caller"; data: unknown; seq: number };

export type TranscriptLine = { role: "agent" | "caller" | "dispatcher"; text: string; at: string; en?: string };
