import type { Priority } from "@surge/shared";
import { PRIORITY_LABEL } from "../lib/presentation";
export function PriorityBadge({
  p,
  collecting = false,
}: {
  p: Priority;
  collecting?: boolean;
}) {
  return (
    <span className={`badge p${p}`}>
      <span>P{p}</span>
      {collecting ? "Unassessed" : PRIORITY_LABEL[p]}
    </span>
  );
}
