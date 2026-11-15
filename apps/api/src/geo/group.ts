// Same-incident grouping: calls close together in space and time, about the same kind of emergency,
// are probably one incident reported by several callers (docs/04: "grouping").
import type { Incident } from "@surge/shared";
import { haversineKm } from "../hazards/firms.js";

export const GROUP_RADIUS_KM = 0.3;
export const GROUP_WINDOW_MIN = 30;

const compatible = (a: Incident, b: Incident) =>
  !a.incident.type || !b.incident.type || a.incident.type === b.incident.type || a.incident.type === "other" || b.incident.type === "other";

export function sameIncident(a: Incident, b: Incident): boolean {
  if (a.location.lat == null || a.location.lng == null || b.location.lat == null || b.location.lng == null) return false;
  if (Math.abs(Date.parse(a.received_at) - Date.parse(b.received_at)) > GROUP_WINDOW_MIN * 60000) return false;
  if (!compatible(a, b)) return false;
  return haversineKm({ lat: a.location.lat, lng: a.location.lng }, { lat: b.location.lat, lng: b.location.lng }) <= GROUP_RADIUS_KM;
}

/**
 * Recompute groups for all open incidents. Returns the incidents whose group changed.
 * Group id = the earliest call in the group, so it stays stable as callers join.
 */
export function computeGroups(open: Incident[]): Incident[] {
  const parent = new Map(open.map((i) => [i.call_id, i.call_id]));
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
  for (let a = 0; a < open.length; a++)
    for (let b = a + 1; b < open.length; b++)
      if (sameIncident(open[a], open[b])) parent.set(find(open[a].call_id), find(open[b].call_id));

  const members = new Map<string, Incident[]>();
  for (const i of open) members.set(find(i.call_id), [...(members.get(find(i.call_id)) ?? []), i]);

  const changed: Incident[] = [];
  for (const list of members.values()) {
    list.sort((x, y) => x.received_at.localeCompare(y.received_at));
    const next = list.length > 1 ? { id: list[0].call_id, size: list.length, call_ids: list.map((i) => i.call_id) } : null;
    for (const i of list) {
      if (JSON.stringify(i.group) !== JSON.stringify(next)) {
        i.group = next;
        changed.push(i);
      }
    }
  }
  return changed;
}
