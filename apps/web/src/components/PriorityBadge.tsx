import type { Priority } from "@surge/shared";

export const PRIORITY_LABEL: Record<Priority, string> = { 1: "Immediate", 2: "Urgent", 3: "Standard", 4: "Low" };
export const PRIORITY_COLOR: Record<Priority, string> = { 1: "#ef4444", 2: "#f97316", 3: "#eab308", 4: "#9ca3af" };

export function PriorityBadge({ p }: { p: Priority }) {
  return (
    <span className="badge" style={{ background: PRIORITY_COLOR[p] }}>
      P{p} · {PRIORITY_LABEL[p]}
    </span>
  );
}
