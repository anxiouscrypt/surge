// In-memory incident store + event bus. Swap persistence for Mongo in db/mongo.ts.
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// Snapshot to disk (debounced) so an API restart in the middle of a demo keeps every call.
// Set SURGE_PERSIST=0 to keep everything in memory only (tests do).
const dataDir = fileURLToPath(new URL("../../data/", import.meta.url));
const snapshotFile = dataDir + "incidents.json";
const persist = process.env.SURGE_PERSIST !== "0" && !process.env.VITEST;
let saveTimer: NodeJS.Timeout | null = null;
function scheduleSnapshot() {
  if (!persist || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dataDir, { recursive: true });
      const tmp = snapshotFile + ".tmp";
      writeFileSync(tmp, JSON.stringify({ incidents: [...incidents.values()], transcripts: Object.fromEntries(transcripts) }));
      renameSync(tmp, snapshotFile); // atomic: never a half-written file
    } catch (err) {
      console.warn("could not save incidents", String(err).slice(0, 120));
    }
  }, 1000);
}

/** Load the last snapshot (called once at startup). Calls older than 12 hours are dropped. */
export function restoreSnapshot(): number {
  if (!persist || !existsSync(snapshotFile)) return 0;
  try {
    const data = JSON.parse(readFileSync(snapshotFile, "utf8")) as { incidents: Incident[]; transcripts: Record<string, TranscriptLine[]> };
    const cutoff = Date.now() - 12 * 3600000;
    for (const i of data.incidents ?? []) {
      if (Date.parse(i.updated_at) < cutoff) continue;
      const fresh = emptyIncident(i.call_id);
      const merged = { ...fresh, ...i }; // fields added since the snapshot get their defaults
      if (merged.device) merged.device.online = false; // no caller page is connected after a restart
      incidents.set(i.call_id, merged);
      if (data.transcripts?.[i.call_id]) transcripts.set(i.call_id, data.transcripts[i.call_id]);
    }
    return incidents.size;
  } catch (err) {
    console.warn("could not restore incidents", String(err).slice(0, 120));
    return 0;
  }
}

export function emit(e: ServerEvent) {
  scheduleSnapshot();
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
