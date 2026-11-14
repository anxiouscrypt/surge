// In-memory incident store + event bus. Swap persistence for Mongo in db/mongo.ts.
import { EventEmitter } from "node:events";
import { emptyIncident, type Incident, type ServerEvent } from "@surge/shared";

const incidents = new Map<string, Incident>();
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
