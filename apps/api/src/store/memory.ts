// In-memory incident store + event bus. Swap persistence for Mongo in db/mongo.ts.
import { EventEmitter } from "node:events";
import { emptyIncident, type Incident, type ServerEvent, type TimelineEntry, type TranscriptLine } from "@surge/shared";

const incidents = new Map<string, Incident>();
const transcripts = new Map<string, TranscriptLine[]>();
export const bus = new EventEmitter();
let seq = 0;
export const nextSeq = () => ++seq;

export const store = {
  get: (id: string) => incidents.get(id),
  all: () => [...incidents.values()],
  open: () => [...incidents.values()].filter((i) => i.status !== "closed"),
  getOrCreate(id: string): Incident {
    let i = incidents.get(id);
    if (!i) {
      i = emptyIncident(id);
      incidents.set(id, i);
    }
    return i;
  },
  transcripts: () => Object.fromEntries([...transcripts].filter(([id]) => incidents.get(id)?.status !== "closed")),
  addLine(callId: string, line: TranscriptLine) {
    const list = transcripts.get(callId) ?? [];
    list.push(line);
    transcripts.set(callId, list.slice(-300));
    emit({ type: "call.transcript", call_id: callId, ...line, seq: nextSeq() });
  },
  /** Remove every incident (demo reset). */
  clear() {
    incidents.clear();
    transcripts.clear();
    emit({ type: "snapshot", incidents: [], transcripts: {}, seq: nextSeq() });
  },
  save(i: Incident, changed: string[]) {
    i.updated_at = new Date().toISOString();
    incidents.set(i.call_id, i);
    emit({ type: "incident.upsert", incident: i, changed, seq: nextSeq() });
  },
};

export function emit(e: ServerEvent) {
  bus.emit("event", e);
}

/** Deep-merge a partial update. Only non-null values overwrite. Returns changed field paths. */
export function mergeInto(target: Record<string, any>, patch: Record<string, any>, prefix = ""): string[] {
  const changed: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) {
      const cur: unknown[] = Array.isArray(target[k]) ? target[k] : [];
      const next = [...new Set([...cur, ...v])];
      if (next.length !== cur.length) {
        target[k] = next;
        changed.push(path);
      }
    } else if (typeof v === "object") {
      target[k] ??= {};
      changed.push(...mergeInto(target[k], v, path));
    } else if (target[k] !== v) {
      target[k] = v;
      changed.push(path);
    }
  }
  return changed;
}

/** Add a line to the incident's timeline (what happened, in the dispatcher's words). */
export function note(i: Incident, kind: TimelineEntry["kind"], text: string) {
  i.timeline.push({ at: new Date().toISOString(), kind, text });
  if (i.timeline.length > 80) i.timeline.splice(1, i.timeline.length - 80);
}
